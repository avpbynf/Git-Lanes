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

/// What one project holds in that file: the commands it can be asked to run, and the branches
/// its work lands on.
///
/// A list is what the file held when commands were all there was to write, and it is still read
/// as one, so a file written before any of this is not a file to rewrite.
#[derive(Deserialize)]
#[serde(untagged)]
enum Held {
    Commands(Vec<Action>),
    Project {
        #[serde(default)]
        actions: Vec<Action>,
        #[serde(default)]
        trunks: Vec<String>,
    },
}

/// The file is a repository path to what that project holds, and paths are matched the way
/// Windows matches them, which is without regard to case.
fn all_projects() -> HashMap<String, Held> {
    let Ok(text) = std::fs::read_to_string(actions_file()) else { return HashMap::new() };
    serde_json::from_str::<HashMap<String, Held>>(&text).unwrap_or_default()
}

/// What moves when that file does, without opening it.
///
/// Nothing in git notices it, so a command added or a trunk renamed would otherwise sit there
/// unread until the page was reloaded by hand. It goes into the fingerprint the window already
/// asks for every couple of seconds, which is why this answers from the file's size and its date
/// rather than from its contents: it is asked on every tick and read on almost none of them.
pub fn stamp() -> String {
    let Ok(held) = std::fs::metadata(actions_file()) else { return String::new() };
    let when = held
        .modified()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    format!("{when}:{}", held.len())
}

fn held_for(repo: &str) -> Option<Held> {
    let wanted = repo.to_lowercase().replace('/', "\\");
    all_projects()
        .into_iter()
        .find(|(path, _)| path.to_lowercase().replace('/', "\\") == wanted)
        .map(|(_, held)| held)
}

pub fn actions_for(repo: &str) -> Vec<Action> {
    match held_for(repo) {
        Some(Held::Commands(actions)) => actions,
        Some(Held::Project { actions, .. }) => actions,
        None => Vec::new(),
    }
}

/// The branches this project's work lands on, as its own entry says. Empty when it says nothing,
/// which is what leaves the usual four in place.
pub fn trunks_for(repo: &str) -> Vec<String> {
    match held_for(repo) {
        Some(Held::Project { trunks, .. }) => trunks.into_iter().filter(|name| !name.is_empty()).collect(),
        _ => Vec::new(),
    }
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
                // what a project does to a version of itself, which is the only thing worth a
                // button: what a commit touched is already in the panel this sits in
                name: "build this version (edit me)".to_string(),
                run: "gradlew.bat build".to_string(),
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

/// What runs the line, which decides how a path has to be spelled in it.
enum Shell {
    /// The one git brings with it, where && and quotes mean what they mean everywhere else.
    Bash(PathBuf),
    /// What is left when that one is not there.
    Plain,
}

/// The bash git brings with it, and never whatever else answers to that name.
///
/// On Windows the PATH holds WSL's launcher under the same name, and a build started through it
/// would run in another machine's file system entirely: same word, nothing else in common. Git's
/// own sits beside the git this tool already runs, so it is found from there or not at all.
fn shell_of(repo: &str) -> Shell {
    if cfg!(windows) {
        if let Ok(exec) = git::git(repo, &["--exec-path"]) {
            // .../Git/mingw64/libexec/git-core, three above which is the install itself
            let mut root = PathBuf::from(exec.trim());
            for _ in 0..3 {
                match root.parent() {
                    Some(up) => root = up.to_path_buf(),
                    None => return Shell::Plain,
                }
            }
            let bash = root.join("bin").join("bash.exe");
            if bash.exists() {
                return Shell::Bash(bash);
            }
        }
    }
    Shell::Plain
}

/// C:\\Users\\x written the way that shell reads it, since a backslash there is an escape and
/// eats the letter behind it.
fn posix(path: &str) -> String {
    let held = path.replace('\\', "/");
    match held.as_bytes() {
        [drive, b':', ..] => format!("/{}{}", (*drive as char).to_lowercase(), &held[2..]),
        _ => held,
    }
}

fn spawn(shell: &Shell, line: &str, cwd: &Path) -> std::io::Result<Child> {
    let mut command = match shell {
        Shell::Bash(bash) => {
            let mut held = Command::new(bash);
            held.args(["-c", line]);
            held
        }
        Shell::Plain => {
            #[cfg(windows)]
            {
                let mut held = Command::new("cmd");
                held.args(["/c", line]);
                held
            }
            #[cfg(not(windows))]
            {
                let mut held = Command::new("sh");
                held.args(["-c", line]);
                held
            }
        }
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
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

        // the paths are spelled the way the shell about to read them spells paths
        let shell = shell_of(&repo);
        let (there, home) = match shell {
            Shell::Bash(_) => (posix(&worktree), posix(&repo)),
            Shell::Plain => (worktree.clone(), repo.clone()),
        };
        let line = action
            .run
            .replace("{worktree}", &there)
            .replace("{repo}", &home)
            .replace("{sha}", &sha)
            .replace("{short}", &short)
            .replace("{ref}", &refname);
        let where_ = action
            .cwd
            .replace("{worktree}", &worktree)
            .replace("{repo}", &repo);
        let where_ = if where_.trim().is_empty() { worktree.clone() } else { where_ };

        say(&app, format!("{line}    (in {where_})"), false);

        let child = match spawn(&shell, &line, Path::new(&where_)) {
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
