//! Running a project's own commands on a commit, in a worktree made for the occasion.
//!
//! Nothing here decides what a command is: it is a line the user wrote in a file of their own,
//! run in a folder this makes and removes. What the folder buys is the whole point. Building the
//! state of a commit that is not the one checked out would otherwise mean checking it out, and a
//! checkout disturbs the very work the window is open beside.
//!
//! It lives in the window and not in the Python backend, and that is not an oversight. That
//! backend answers on 127.0.0.1, where any page open in any browser can post to it without ever
//! reading the answer: a route that runs a command there would be a build any website could
//! start. Here the same code sits behind a command of the window's own, which nothing outside it
//! can reach.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::git;

/// One command a project can be asked to run, as the file spells it.
#[derive(Serialize, Deserialize, Clone)]
pub struct Action {
    pub name: String,
    /// The command line, handed to the system's shell. `{worktree}`, `{repo}`, `{sha}`,
    /// `{short}` and `{ref}` are replaced before it runs.
    pub run: String,
    /// Where it runs, `{worktree}` when it says nothing, which is the folder made for the commit.
    #[serde(default)]
    pub cwd: String,
}

/// What a line of output carries to the page, and what says the run is over.
#[derive(Serialize, Clone)]
pub struct Line {
    pub text: String,
    /// True for what the command wrote to its error stream, which is where a build says why.
    pub bad: bool,
}

#[derive(Serialize, Clone)]
pub struct Ended {
    pub code: i32,
    pub message: String,
}

/// The one command running, if any. Two at once would fight over the same worktree name and,
/// worse, over the build cache of whatever they are building.
static RUNNING: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<u32>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Beside the list of opened repositories, since both are the user's own and neither belongs to
/// a repository.
pub fn actions_file() -> PathBuf {
    let base = std::env::var("APPDATA")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("gitlanes").join("actions.json")
}

/// The file is a repository path to a list of commands, and paths are matched the way Windows
/// matches them, which is without regard to case.
fn all_actions() -> HashMap<String, Vec<Action>> {
    let Ok(text) = std::fs::read_to_string(actions_file()) else { return HashMap::new() };
    serde_json::from_str::<HashMap<String, Vec<Action>>>(&text).unwrap_or_default()
}

pub fn actions_for(repo: &str) -> Vec<Action> {
    let wanted = repo.to_lowercase().replace('/', "\\");
    for (path, held) in all_actions() {
        if path.to_lowercase().replace('/', "\\") == wanted {
            return held;
        }
    }
    Vec::new()
}

/// The file, made to be edited rather than described: the first open writes an example for this
/// repository, so the shape is in front of whoever opens it.
pub fn open_actions(repo: &str) -> Result<String, String> {
    let file = actions_file();
    if !file.exists() {
        if let Some(folder) = file.parent() {
            std::fs::create_dir_all(folder).map_err(|err| err.to_string())?;
        }
        let example: HashMap<String, Vec<Action>> = HashMap::from([(
            repo.to_string(),
            vec![Action {
                name: "an example, for the shape".to_string(),
                run: "git -C {worktree} log -1 --stat".to_string(),
                cwd: String::new(),
            }],
        )]);
        let text = serde_json::to_string_pretty(&example).map_err(|err| err.to_string())?;
        std::fs::write(&file, text).map_err(|err| err.to_string())?;
    }

    let path = file.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        // start with an empty title, or the first quoted argument is taken for the window's name
        Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|err| format!("the file could not be opened: {err}"))?;
    }
    Ok(path)
}

fn shell(line: &str, cwd: &Path) -> std::io::Result<Child> {
    let mut command;
    #[cfg(windows)]
    {
        command = Command::new("cmd");
        command.args(["/c", line]);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        command = Command::new("sh");
        command.args(["-c", line]);
    }
    command.current_dir(cwd).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    command.spawn()
}

fn say(app: &AppHandle, text: impl Into<String>, bad: bool) {
    let _ = app.emit("action-line", Line { text: text.into(), bad });
}

fn ended(app: &AppHandle, code: i32, message: impl Into<String>) {
    let _ = running().lock().map(|mut held| *held = None);
    let _ = app.emit("action-ended", Ended { code, message: message.into() });
}

/// Start one action on one commit. It answers as soon as the command is running; what it does
/// after that reaches the page as events, line by line, which is the only way a build that takes
/// minutes is worth watching.
pub fn start(
    app: AppHandle,
    repo: String,
    index: usize,
    sha: String,
    refname: String,
) -> Result<(), String> {
    let held = actions_for(&repo);
    let action = held.get(index).cloned().ok_or("no action at that place in the file")?;

    {
        let mut current = running().lock().map_err(|_| "the runner is in a bad way")?;
        if current.is_some() {
            return Err("something is already running".into());
        }
        *current = Some(0); // taken, and replaced by the real one once it is spawned
    }

    std::thread::spawn(move || {
        let short = sha.chars().take(7).collect::<String>();
        let folder = std::env::temp_dir().join("gitlanes-run").join(format!(
            "{}-{}",
            Path::new(&repo).file_name().map(|it| it.to_string_lossy().to_string()).unwrap_or_default(),
            short
        ));
        let worktree = folder.to_string_lossy().to_string();

        // a folder left by a run that died holds an old state, and git refuses to add over it
        let _ = std::fs::remove_dir_all(&folder);
        let _ = git::git(&repo, &["worktree", "prune"]);

        say(&app, format!("git worktree add --detach {worktree} {short}"), false);
        if let Err(err) = git::git(&repo, &["worktree", "add", "--detach", &worktree, &sha]) {
            ended(&app, -1, format!("the worktree could not be made: {err}"));
            return;
        }

        let line = action
            .run
            .replace("{worktree}", &worktree)
            .replace("{repo}", &repo)
            .replace("{sha}", &sha)
            .replace("{short}", &short)
            .replace("{ref}", &refname);
        let where_ = action
            .cwd
            .replace("{worktree}", &worktree)
            .replace("{repo}", &repo);
        let where_ = if where_.trim().is_empty() { worktree.clone() } else { where_ };

        say(&app, format!("{line}    (in {where_})"), false);

        let child = match shell(&line, Path::new(&where_)) {
            Ok(child) => child,
            Err(err) => {
                let _ = git::git(&repo, &["worktree", "remove", "--force", &worktree]);
                ended(&app, -1, format!("the command could not start: {err}"));
                return;
            }
        };

        let code = watch(&app, child);

        // the folder goes whether the command worked or not: what it built is wherever the
        // command put it, and a worktree left behind is a worktree nobody remembers making
        say(&app, format!("git worktree remove --force {worktree}"), false);
        if let Err(err) = git::git(&repo, &["worktree", "remove", "--force", &worktree]) {
            say(&app, format!("the worktree stayed behind: {err}"), true);
            let _ = std::fs::remove_dir_all(&folder);
            let _ = git::git(&repo, &["worktree", "prune"]);
        }

        let message = match code {
            0 => "done".to_string(),
            other => format!("the command ended with {other}"),
        };
        ended(&app, code, message);
    });

    Ok(())
}

/// Read both streams to their end, saying each line as it lands, and answer with the exit code.
fn watch(app: &AppHandle, mut child: Child) -> i32 {
    let _ = running().lock().map(|mut held| *held = Some(child.id()));

    let out = child.stdout.take();
    let err = child.stderr.take();
    let here = app.clone();
    let errors = std::thread::spawn(move || {
        if let Some(stream) = err {
            for line in BufReader::new(stream).split(b'\n') {
                let Ok(raw) = line else { break };
                say(&here, text_of(raw), true);
            }
        }
    });

    if let Some(stream) = out {
        for line in BufReader::new(stream).split(b'\n') {
            let Ok(raw) = line else { break };
            say(app, text_of(raw), false);
        }
    }
    let _ = errors.join();

    child.wait().ok().and_then(|status| status.code()).unwrap_or(-1)
}

/// A build writes whatever its tools write, in no encoding in particular, so nothing here refuses
/// a line for not being UTF-8.
fn text_of(raw: Vec<u8>) -> String {
    String::from_utf8_lossy(&raw).trim_end_matches('\r').to_string()
}

/// Stop what is running, and its children with it: killing the shell alone would leave the build
/// it started running with nothing left to report it.
pub fn stop() -> Result<(), String> {
    let held = running().lock().map_err(|_| "the runner is in a bad way")?.take();
    let Some(pid) = held.filter(|pid| *pid != 0) else { return Err("nothing is running".into()) };

    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
        command.output().map_err(|err| err.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("kill").args(["-TERM", &pid.to_string()]).output().map_err(|err| err.to_string())?;
    }
    Ok(())
}
