//! Reading a repository, and turning its commits into lanes.
//!
//! This is the same reading the Python backend does, and it answers the same
//! shapes, because the front end cannot tell which one it is talking to.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::SystemTime;
use std::sync::{Mutex, OnceLock};

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';
/// What the front end prefixes a scope with to name one ref.
const REF: &str = "ref:";

/// `--author=<value>` and the like, or nothing at all when the value is empty.
fn some_arg(flag: &str, value: &str) -> Option<String> {
    (!value.is_empty()).then(|| format!("{flag}{value}"))
}

/// What narrows the read beyond the refs it starts from. Empty means no narrowing.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Filters {
    pub author: String,
    /// Anything git reads as a date, so `7 days ago` as much as `2026-08-01`.
    pub since: String,
    /// Comma separated, and each one is a path git matches from the root.
    pub paths: String,
}

/// Run git in a repository. On Windows the child must not open a console, or
/// every call would flash a black window over the app.
/// One place where git is spawned, so nothing started here ever flashes a console of its own.
fn git_command(repo: &str, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut command = git_command(repo, args);
    let output = command.output().map_err(|err| format!("git could not start: {err}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { "git failed".into() } else { message });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Same, but an expected failure answers empty instead of raising.
fn git_soft(repo: &str, args: &[&str]) -> String {
    git(repo, args).unwrap_or_default()
}

/// Absolute root of the repository holding a path.
pub fn toplevel(path: &str) -> Result<String, String> {
    if path.is_empty() || !Path::new(path).is_dir() {
        return Err(format!("no such directory: {path}"));
    }
    let top = git(path, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    // git answers forward slashes everywhere. On Windows the rest of the tool,
    // the stored list included, speaks backslashes, and the two spellings of
    // one repository would not compare equal.
    #[cfg(windows)]
    let top = top.replace('/', "\\");
    Ok(top)
}

#[derive(Serialize, Clone)]
pub struct GitRef {
    pub n: String,
    pub k: &'static str,
    /// Whether a trunk already holds this branch, under these hashes or under others.
    #[serde(skip_serializing_if = "not")]
    pub m: bool,
}

fn not(held: &bool) -> bool {
    !*held
}

/// What one worktree holds that no commit does, as the graph carries it.
#[derive(Serialize, Clone)]
pub struct Working {
    pub path: String,
    pub branch: String,
    /// Whether this is the worktree being read, rather than another folder of the same history.
    pub here: bool,
    pub staged: usize,
    pub changed: usize,
    pub untracked: usize,
}

/// The same, with the files it comes to when asked.
#[derive(Serialize)]
pub struct WorkingDetail {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub here: bool,
    pub staged: usize,
    pub changed: usize,
    pub untracked: usize,
    pub files: Vec<WorkingFile>,
}

#[derive(Serialize)]
pub struct WorkingFile {
    pub a: Option<u32>,
    pub d: Option<u32>,
    pub path: String,
    pub st: &'static str,
}

#[derive(Serialize)]
pub struct Commit {
    pub h: String,
    pub p: Vec<String>,
    pub an: String,
    pub t: String,
    pub s: String,
    pub refs: Vec<GitRef>,
    pub lane: usize,
    pub row: usize,
    pub c: usize,
    /// The commit carrying this very change somewhere else, a replay of it or its original.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tw: Option<String>,
    /// Set on a row that is no commit at all: the uncommitted work of one worktree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wt: Option<Working>,
}

#[derive(Serialize)]
pub struct Edge {
    pub fr: usize,
    pub fl: usize,
    pub rl: usize,
    pub c: usize,
    pub tr: Option<usize>,
    pub tl: usize,
}

#[derive(Serialize)]
pub struct Graph {
    pub repo: String,
    pub path: String,
    pub branch: String,
    pub dirty: bool,
    pub commits: Vec<Commit>,
    pub edges: Vec<Edge>,
    pub lanes: usize,
    pub truncated: bool,
    pub fingerprint: String,
}

#[derive(Serialize)]
pub struct CommitFile {
    pub a: Option<u32>,
    pub d: Option<u32>,
    pub path: String,
}

#[derive(Serialize)]
pub struct CommitDetail {
    pub h: String,
    pub an: String,
    pub ae: String,
    pub at: String,
    pub cn: String,
    pub ct: String,
    pub body: String,
    pub files: Vec<CommitFile>,
    pub merge: bool,
}

#[derive(Clone, Copy)]
struct Divergence {
    behind: usize,
    ahead: usize,
}

#[derive(Serialize)]
pub struct Upstream {
    pub name: String,
    pub behind: usize,
    pub ahead: usize,
    pub gone: bool,
}

#[derive(Serialize)]
pub struct Branch {
    pub name: String,
    pub head: String,
    pub t: String,
    pub current: bool,
    pub base: Option<String>,
    pub behind: usize,
    pub ahead: usize,
    pub upstream: Option<Upstream>,
}

/// A ref with nothing measured against it: a remote branch, or a tag.
#[derive(Serialize)]
pub struct PlainRef {
    pub name: String,
    pub head: String,
    pub t: String,
}

#[derive(Serialize)]
pub struct BranchList {
    pub base: Option<String>,
    pub branches: Vec<Branch>,
    pub remotes: Vec<PlainRef>,
    pub tags: Vec<PlainRef>,
}

#[derive(Serialize)]
pub struct RepoEntry {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn parse_refs(decoration: &str, remotes: &[String]) -> Vec<GitRef> {
    let mut refs = Vec::new();
    for part in decoration.split(',') {
        let mut raw = part.trim();
        if raw.is_empty() {
            continue;
        }
        if let Some(rest) = raw.strip_prefix("HEAD -> ") {
            refs.push(GitRef { n: "HEAD".into(), k: "head", m: false });
            raw = rest.trim();
        }
        if raw == "HEAD" {
            refs.push(GitRef { n: "HEAD".into(), k: "head", m: false });
            continue;
        }
        if let Some(tag) = raw.strip_prefix("tag: ") {
            refs.push(GitRef { n: tag.trim().into(), k: "tag", m: false });
            continue;
        }
        // git slips these in among the refs, and neither one is a ref: taken for
        // branches they showed as a branch named grafted on every shallow tip
        if raw == "grafted" || raw == "replaced" {
            continue;
        }
        let kind = if remotes.iter().any(|remote| raw.starts_with(&format!("{remote}/"))) {
            "remote"
        } else {
            "local"
        };
        refs.push(GitRef { n: raw.into(), k: kind, m: false });
    }
    refs
}

struct Raw {
    h: String,
    p: Vec<String>,
    an: String,
    t: String,
    s: String,
    refs: Vec<GitRef>,
    wt: Option<Working>,
}

/// The commits a shallow clone was cut at, empty when the clone is whole.
///
/// Read from the file rather than asked of git, which costs an open instead of
/// a process. A worktree keeps its shallow list in the repository it belongs
/// to, and that is not chased here: a worktree of a shallow clone says nothing.
fn shallow_of(repo: &str) -> std::collections::HashSet<String> {
    std::fs::read_to_string(Path::new(repo).join(".git").join("shallow"))
        .map(|text| text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect())
        .unwrap_or_default()
}

/// The names a branch is measured against. Anything else is a topic branch, and a topic branch
/// is what can be finished with rather than what work is aimed at.
const TRUNKS: [&str; 4] = ["dev", "main", "master", "trunk"];
/// How far back a replay is looked for on the trunk side. What normally bounds it is where the
/// oldest branch left the trunk, tens of commits; this is for the branch abandoned a year ago,
/// whose diffs would otherwise be seconds of work.
const CHERRY_CAP: usize = 1000;
/// Commits per pipeline. Both pipes stay under what the system buffers, so nothing has to be
/// read while something else is still being written.
const CHERRY_BATCH: usize = 400;

/// The branches a trunk already holds, and the hash each of their commits is held under.
type InTrunk = (HashSet<String>, HashMap<String, String>);

/// repo -> (the refs it was read from, the answer). What a replay costs is diffs, and the
/// answer only moves when a ref does, so a working tree being typed in does not pay for it.
static IN_TRUNK: OnceLock<Mutex<HashMap<String, (String, InTrunk)>>> = OnceLock::new();

/// Every commit named, filed under the patch it carries.
///
/// The diffs never come back into this process: diff-tree writes them straight into patch-id,
/// which answers one short line per commit. Reading them here would be megabytes of bytes in no
/// encoding in particular, a diff carrying whatever the files carry.
fn patch_ids(repo: &str, revs: &[String]) -> HashMap<String, Vec<String>> {
    let mut filed: HashMap<String, Vec<String>> = HashMap::new();

    for batch in revs.chunks(CHERRY_BATCH) {
        let mut diffs = match git_command(repo, &["diff-tree", "--stdin", "-p"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return filed,
        };

        // the diffs go straight into patch-id, and this process keeps no handle on them, or
        // patch-id would wait on a pipe nothing is left to close
        let Some(pipe) = diffs.stdout.take() else { return filed };
        let ids = match git_command(repo, &["patch-id", "--stable"])
            .stdin(Stdio::from(pipe))
            .stdout(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return filed,
        };

        if let Some(mut stdin) = diffs.stdin.take() {
            let list = batch.join("\n") + "\n";
            let _ = stdin.write_all(list.as_bytes());
        }

        let answer = match ids.wait_with_output() {
            Ok(output) => String::from_utf8_lossy(&output.stdout).into_owned(),
            Err(_) => return filed,
        };
        let _ = diffs.wait();

        for line in answer.lines() {
            let mut parts = line.split_whitespace();
            if let (Some(patch), Some(commit)) = (parts.next(), parts.next()) {
                filed.entry(patch.to_string()).or_default().push(commit.to_string());
            }
        }
    }

    filed
}

/// Which branches a trunk already holds, and the hash it holds each of their commits under.
///
/// A branch is in a trunk in one of two ways. The trunk holds its very commits, which is what a
/// fast-forward leaves, and git says so. Or the trunk holds the same changes under other hashes,
/// which is what a rebase and a cherry-pick leave, and about that git says nothing at all: the
/// branch reads as work still waiting, forever, and the commits read as two pieces of work when
/// they are one done twice.
///
/// Both answers are the same question asked of the patch rather than of the hash.
pub fn already_in_trunk(repo: &str) -> InTrunk {
    let listing = git_soft(
        repo,
        &["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"],
    );
    let held = IN_TRUNK.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = held.lock() {
        if let Some((key, answer)) = cache.get(repo) {
            if *key == listing {
                return answer.clone();
            }
        }
    }

    let mut tips: Vec<(String, String)> = Vec::new();
    for line in listing.lines() {
        let mut parts = line.split_whitespace();
        if let (Some(name), Some(tip)) = (parts.next(), parts.next()) {
            tips.push((name.to_string(), tip.to_string()));
        }
    }

    let answer = read_in_trunk(repo, &tips);
    if let Ok(mut cache) = held.lock() {
        cache.insert(repo.to_string(), (listing, answer.clone()));
    }
    answer
}

fn read_in_trunk(repo: &str, tips: &[(String, String)]) -> InTrunk {
    let mut merged: HashSet<String> = HashSet::new();
    let mut twins: HashMap<String, String> = HashMap::new();

    let is_trunk = |name: &String| TRUNKS.contains(&name.as_str());
    let trunk_tips: Vec<&str> =
        tips.iter().filter(|(n, _)| is_trunk(n)).map(|(_, h)| h.as_str()).collect();
    let topics: Vec<&(String, String)> = tips.iter().filter(|(n, _)| !is_trunk(n)).collect();
    if trunk_tips.is_empty() || topics.is_empty() {
        return (merged, twins);
    }
    let topic_tips: Vec<&str> = topics.iter().map(|(_, h)| h.as_str()).collect();

    // every commit the topic branches hold and no trunk does, with its parents, so which branch
    // each one belongs to is walked here rather than asked of git one branch at a time
    let mut args: Vec<&str> = vec!["rev-list", "--parents"];
    args.extend(&topic_tips);
    args.push("--not");
    args.extend(&trunk_tips);
    let mut own: HashMap<String, Vec<String>> = HashMap::new();
    for line in git_soft(repo, &args).lines() {
        let mut parts = line.split_whitespace().map(str::to_string);
        if let Some(commit) = parts.next() {
            own.insert(commit, parts.collect());
        }
    }

    if own.is_empty() {
        for (name, _) in topics {
            merged.insert(name.clone());
        }
        return (merged, twins);
    }

    // Where the oldest of those branches left the trunk, which is as far back as a replay of
    // theirs can sit. Asking for the trunk --not the branches answers nothing at all for a
    // branch that is merely ahead of the trunk, the whole trunk being reachable from it.
    let mut args: Vec<&str> = vec!["merge-base", "--octopus"];
    args.extend(&trunk_tips);
    args.extend(&topic_tips);
    let base: Vec<String> = git_soft(repo, &args).split_whitespace().map(str::to_string).collect();

    let cap = CHERRY_CAP.to_string();
    let mut args: Vec<&str> = vec!["rev-list", "--no-merges"];
    args.extend(&trunk_tips);
    if base.is_empty() {
        args.extend(["-n", cap.as_str()]);
    } else {
        args.push("--not");
        args.extend(base.iter().map(String::as_str));
    }
    let theirs: Vec<String> = git_soft(repo, &args)
        .split_whitespace()
        .take(CHERRY_CAP)
        .map(str::to_string)
        .collect();

    // a merge commit carries no patch of its own, and a replay drops it, so it is never asked for
    let mine: Vec<String> =
        own.iter().filter(|(_, parents)| parents.len() < 2).map(|(h, _)| h.clone()).collect();

    if !theirs.is_empty() && !mine.is_empty() {
        let on_trunk: HashSet<&str> = theirs.iter().map(String::as_str).collect();
        let mut both = theirs.clone();
        both.extend(mine.iter().cloned());
        for group in patch_ids(repo, &both).values() {
            let Some(there) = group.iter().find(|h| on_trunk.contains(h.as_str())) else {
                continue;
            };
            for one in group {
                if !on_trunk.contains(one.as_str()) {
                    twins.insert(one.clone(), there.clone());
                    twins.insert(there.clone(), one.clone());
                }
            }
        }
    }

    for (name, tip) in topics {
        if !own.contains_key(tip) {
            merged.insert(name.clone()); // the trunk holds this branch under its own hashes
            continue;
        }
        let mut walked: HashSet<&str> = HashSet::new();
        let mut front: Vec<&str> = vec![tip.as_str()];
        while let Some(here) = front.pop() {
            if walked.contains(here) {
                continue;
            }
            let Some(parents) = own.get(here) else { continue };
            walked.insert(here);
            front.extend(parents.iter().map(String::as_str));
        }
        let all_replayed = walked.iter().all(|h| {
            own.get(*h).map(|parents| parents.len() >= 2).unwrap_or(false) || twins.contains_key(*h)
        });
        if all_replayed {
            merged.insert(name.clone());
        }
    }

    (merged, twins)
}

/// What a working row is called, in place of the hash a commit has. The path follows, since that
/// is what tells two worktrees of one repository apart.
pub const WORKING: &str = "wt:";
/// How many changed paths are stat'ed for the date a working row carries. A worktree with more
/// than this going on is not one whose exact minute anybody is reading.
const WORKING_STAT: usize = 200;

struct Tree {
    path: String,
    head: String,
    branch: String,
    bare: bool,
}

/// Every worktree of this repository, the one being read included.
///
/// A worktree is a second checkout of the same history, with its own HEAD and its own
/// uncommitted work. Git holds them all in one list, which is why the branch left half finished
/// in another folder is knowable from here at all.
fn worktrees_of(repo: &str) -> Vec<Tree> {
    let mut trees = Vec::new();
    let mut held: Option<Tree> = None;

    for line in git_soft(repo, &["worktree", "list", "--porcelain"]).lines() {
        let line = line.trim();
        if line.is_empty() {
            if let Some(tree) = held.take() {
                trees.push(tree);
            }
            continue;
        }
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "worktree" => {
                if let Some(tree) = held.take() {
                    trees.push(tree);
                }
                held = Some(Tree {
                    path: normal(value),
                    head: String::new(),
                    branch: String::new(),
                    bare: false,
                });
            }
            "HEAD" => {
                if let Some(tree) = held.as_mut() {
                    tree.head = value.to_string();
                }
            }
            // refs/heads/feat/one keeps its slashes: only the refs/heads/ in front comes off
            "branch" => {
                if let Some(tree) = held.as_mut() {
                    tree.branch = value.strip_prefix("refs/heads/").unwrap_or(value).to_string();
                }
            }
            "bare" => {
                if let Some(tree) = held.as_mut() {
                    tree.bare = true;
                }
            }
            _ => {}
        }
    }
    if let Some(tree) = held.take() {
        trees.push(tree);
    }
    trees
}

/// The one spelling of a path this tool compares, since git answers forward slashes everywhere.
fn normal(path: &str) -> String {
    #[cfg(windows)]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        path.to_string()
    }
}

/// What one worktree holds that no commit does: the counts, and when it was last touched.
fn status_of(tree: &str) -> (usize, usize, usize, Option<SystemTime>) {
    let (mut staged, mut changed, mut untracked) = (0, 0, 0);
    let mut newest: Option<SystemTime> = None;
    let mut stated = 0;

    for line in git_soft(tree, &["status", "--porcelain"]).lines() {
        if line.len() < 3 {
            continue;
        }
        let index = line.as_bytes()[0] as char;
        let work = line.as_bytes()[1] as char;
        let name = line[3..].trim().trim_matches('"');
        if index == '?' {
            untracked += 1;
        } else {
            if index != ' ' {
                staged += 1;
            }
            if work != ' ' {
                changed += 1;
            }
        }
        // the newest of them is what says how long ago this was left, which is the whole
        // question a worktree opened in another folder raises
        if stated < WORKING_STAT {
            stated += 1;
            // a rename is spelled "old -> new", and it is the new one that is on disk
            let name = name.rsplit(" -> ").next().unwrap_or(name);
            if let Ok(when) = std::fs::metadata(Path::new(tree).join(name)).and_then(|it| it.modified()) {
                newest = Some(match newest {
                    Some(held) if held > when => held,
                    _ => when,
                });
            }
        }
    }

    (staged, changed, untracked, newest)
}

/// The same date the log carries, so a row of one kind sorts and reads beside a row of the other.
fn stamp(when: SystemTime) -> String {
    let seconds = when
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|held| held.as_secs() as i64)
        .unwrap_or(0);
    // git's own spelling of an instant, and the browser reads it as one
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// Days since the epoch, as a date. Howard Hinnant's civil_from_days, which is the short way.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// One row per worktree holding uncommitted work, to hang above the commit it sits on.
///
/// It is not a commit and it says so: no hash, a dashed dot and a dashed line down to the commit
/// it was started from. What it answers is the question a repository of several worktrees raises
/// every time, which is where the work in progress was left.
fn working_rows(repo: &str) -> Vec<Raw> {
    let here = normal(repo);
    let mut rows = Vec::new();

    for tree in worktrees_of(repo) {
        if tree.bare || tree.head.is_empty() {
            continue;
        }
        let (staged, changed, untracked, newest) = status_of(&tree.path);
        if staged == 0 && changed == 0 && untracked == 0 {
            continue;
        }
        rows.push(Raw {
            h: format!("{WORKING}{}", tree.path),
            p: vec![tree.head.clone()],
            an: String::new(),
            t: stamp(newest.unwrap_or_else(SystemTime::now)),
            s: "uncommitted changes".to_string(),
            refs: Vec::new(),
            wt: Some(Working {
                here: tree.path == here,
                branch: if tree.branch.is_empty() { "detached".into() } else { tree.branch.clone() },
                path: tree.path,
                staged,
                changed,
                untracked,
            }),
        });
    }

    rows
}

/// Each row goes immediately above the commit its worktree sits on, or nowhere at all.
///
/// Nowhere is what a filtered read leaves: a worktree whose commit the filters removed has no
/// place to hang from, and a row hanging off nothing would draw a line into empty space.
fn hang_working_rows(commits: &mut Vec<Raw>, rows: Vec<Raw>) {
    for row in rows {
        let parent = row.p.first().cloned().unwrap_or_default();
        if let Some(at) = commits.iter().position(|commit| commit.h == parent) {
            commits.insert(at, row);
        }
    }
}

/// What one worktree holds that no commit does, file by file.
pub fn working_detail(repo: &str, path: &str) -> Result<WorkingDetail, String> {
    let wanted = normal(path);
    let tree = worktrees_of(repo)
        .into_iter()
        .find(|tree| tree.path == wanted)
        .ok_or_else(|| format!("no worktree of this repository at {path}"))?;

    let mut files = Vec::new();
    // against HEAD, so what is staged and what is not are one answer: both are work no commit
    // holds, and the panel is read to see what is going on rather than what git would commit
    for line in git_soft(&tree.path, &["diff", "--numstat", "HEAD"]).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() != 3 {
            continue;
        }
        files.push(WorkingFile {
            a: parts[0].parse().ok(),
            d: parts[1].parse().ok(),
            path: parts[2].to_string(),
            st: "changed",
        });
    }
    for line in git_soft(&tree.path, &["status", "--porcelain"]).lines() {
        if let Some(name) = line.strip_prefix("?? ") {
            files.push(WorkingFile {
                a: None,
                d: None,
                path: name.trim().trim_matches('"').to_string(),
                st: "untracked",
            });
        }
    }

    let (staged, changed, untracked, _) = status_of(&tree.path);
    Ok(WorkingDetail {
        here: tree.path == normal(repo),
        branch: if tree.branch.is_empty() { "detached".into() } else { tree.branch },
        head: tree.head,
        path: tree.path,
        staged,
        changed,
        untracked,
        files,
    })
}

fn read_commits(
    repo: &str,
    scope: &str,
    limit: usize,
    order: &str,
    filters: &Filters,
) -> Result<Vec<Raw>, String> {
    let format = format!(
        "--pretty=format:%H{f}%P{f}%an{f}%aI{f}%D{f}%s{r}",
        f = FIELD,
        r = RECORD
    );
    let limit_arg = limit.to_string();
    // a scope must spell refs/... in full, or it is no scope: that is what keeps a
    // ref called -f a ref and never an option. A tag starts a history as a branch does.
    let bound = scope
        .strip_prefix(REF)
        .filter(|name| name.starts_with("refs/"));
    let author_arg = some_arg("--author=", &filters.author);
    let since_arg = some_arg("--since=", &filters.since);
    let wanted: Vec<&str> = filters
        .paths
        .split(',')
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .collect();
    let sort = if order == "topo" { "--topo-order" } else { "--date-order" };
    let mut args = vec!["log", sort, format.as_str()];
    if let Some(reference) = bound {
        args.push(reference);
    } else {
        // not --all: that one drags in refs/stash and the note refs
        args.extend_from_slice(&["--branches", "--tags", "--remotes", "HEAD"]);
    }
    if let Some(arg) = author_arg.as_deref() {
        args.push(arg);
    }
    if let Some(arg) = since_arg.as_deref() {
        args.push(arg);
    }
    if limit > 0 {
        args.extend_from_slice(&["-n", limit_arg.as_str()]);
    }
    // the paths come last, behind the separator, or a branch named like a file wins
    if !wanted.is_empty() {
        args.push("--");
        args.extend_from_slice(&wanted);
    }

    let remotes: Vec<String> = git(repo, &["remote"])?
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    let cut = shallow_of(repo);

    let mut commits = Vec::new();
    for record in git(repo, &args)?.split(RECORD) {
        let record = record.trim_matches(|c| c == '\r' || c == '\n');
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(6, FIELD);
        let (h, parents, an, t, decoration, s) = match (
            fields.next(), fields.next(), fields.next(),
            fields.next(), fields.next(), fields.next(),
        ) {
            (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) => (a, b, c, d, e, f),
            _ => continue,
        };
        let mut refs = parse_refs(decoration, &remotes);
        if cut.contains(h) {
            refs.push(GitRef { n: "shallow".to_string(), k: "shallow", m: false });
        }
        commits.push(Raw {
            wt: None,
            h: h.to_string(),
            p: parents.split_whitespace().map(str::to_string).collect(),
            an: an.to_string(),
            t: t.to_string(),
            s: s.to_string(),
            refs,
        });
    }
    Ok(commits)
}

/// Give every commit a column and route one edge per parent link.
///
/// A lane holds the hash it is still waiting for. A commit takes the leftmost
/// lane waiting for it, and the other lanes waiting for it close there: that is
/// what draws a merge. Its first parent keeps the lane, the others open one,
/// which is what draws a branch.
fn build_graph(raw: Vec<Raw>) -> (Vec<Commit>, Vec<Edge>, usize) {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut colors: Vec<usize> = Vec::new();

    let open_lane = |lanes: &mut Vec<Option<String>>,
                     colors: &mut Vec<usize>,
                     wanted: &str| -> usize {
        let free = lanes.iter().position(|lane| lane.is_none());
        let index = match free {
            Some(found) => found,
            None => {
                lanes.push(None);
                colors.push(0);
                lanes.len() - 1
            }
        };
        // The colour is what tells two lanes apart, so a lane may not take one
        // another live lane is already carrying. Counting up instead handed the
        // same colour to two lanes drawn at once, on a fifth of the rows of a
        // repository eight lanes wide.
        let taken: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(other, lane)| *other != index && lane.is_some())
            .map(|(other, _)| colors[other])
            .collect();
        let mut colour = 0usize;
        while taken.contains(&colour) {
            colour += 1;
        }
        colors[index] = colour;
        lanes[index] = Some(wanted.to_string());
        index
    };

    struct Pending {
        from_row: usize,
        from_lane: usize,
        route: usize,
        color: usize,
        parent: String,
    }

    let mut commits: Vec<Commit> = Vec::with_capacity(raw.len());
    let mut pending: Vec<Pending> = Vec::new();

    for (row, item) in raw.into_iter().enumerate() {
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, lane)| lane.as_deref() == Some(item.h.as_str()))
            .map(|(index, _)| index)
            .collect();

        let lane = match waiting.first() {
            Some(&first) => {
                for &other in &waiting[1..] {
                    lanes[other] = None;
                }
                first
            }
            None => open_lane(&mut lanes, &mut colors, &item.h),
        };

        let color = colors[lane];
        lanes[lane] = None;

        for (rank, parent) in item.p.iter().enumerate() {
            let route = if rank == 0 {
                lanes[lane] = Some(parent.clone());
                lane
            } else {
                // bound first: a borrow taken in a match scrutinee lives until
                // the end of the match, and the arm below needs lanes mutably
                let existing = lanes.iter().position(|held| held.as_deref() == Some(parent.as_str()));
                match existing {
                    Some(found) => found,
                    None => open_lane(&mut lanes, &mut colors, parent),
                }
            };
            pending.push(Pending {
                from_row: row,
                from_lane: lane,
                route,
                color: colors[route],
                parent: parent.clone(),
            });
        }

        commits.push(Commit {
            h: item.h,
            p: item.p,
            an: item.an,
            t: item.t,
            s: item.s,
            refs: item.refs,
            lane,
            row,
            c: color,
            tw: None,
            wt: item.wt,
        });
    }

    let mut where_is = std::collections::HashMap::with_capacity(commits.len());
    for commit in &commits {
        where_is.insert(commit.h.clone(), (commit.row, commit.lane));
    }

    let edges = pending
        .into_iter()
        .map(|item| match where_is.get(&item.parent) {
            Some(&(row, lane)) => Edge {
                fr: item.from_row,
                fl: item.from_lane,
                rl: item.route,
                c: item.color,
                tr: Some(row),
                tl: lane,
            },
            None => Edge {
                fr: item.from_row,
                fl: item.from_lane,
                rl: item.route,
                c: item.color,
                tr: None,
                tl: item.route,
            },
        })
        .collect();

    let lane_count = lanes.len();
    (commits, edges, lane_count)
}

/// What moves when the repository does, cheaply enough to be asked every couple of seconds.
///
/// The working trees of the other worktrees are not in it, on purpose: a status run in each of
/// them on every tick is exactly the cost this question exists to avoid. Their rows therefore
/// catch up whenever anything else moves, rather than the moment they change.
pub fn fingerprint(repo: &str) -> Result<String, String> {
    let refs = git(repo, &["for-each-ref", "--format=%(objectname) %(refname)"])?;
    let head = git_soft(repo, &["rev-parse", "--verify", "-q", "HEAD"]);
    let dirty = git(repo, &["status", "--porcelain"])?;
    let mut hasher = DefaultHasher::new();
    refs.hash(&mut hasher);
    head.hash(&mut hasher);
    dirty.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

/// The branch and whether the tree is dirty.
///
/// `branch --show-current`, not `rev-parse`: it also names the branch of a
/// repository that has no commit yet, where rev-parse simply fails.
pub fn head_of(repo: &str) -> Result<(String, bool), String> {
    let mut branch = git(repo, &["branch", "--show-current"])?.trim().to_string();
    if branch.is_empty() {
        let short = git_soft(repo, &["rev-parse", "--short", "HEAD"]).trim().to_string();
        branch = if short.is_empty() { "no commit yet".into() } else { format!("detached {short}") };
    }
    let dirty = !git(repo, &["status", "--porcelain"])?.trim().is_empty();
    Ok((branch, dirty))
}

fn is_empty(repo: &str) -> bool {
    git_soft(repo, &["for-each-ref", "--count=1", "--format=%(objectname)"]).trim().is_empty()
}

pub fn graph(
    repo: &str,
    scope: &str,
    limit: usize,
    order: &str,
    filters: &Filters,
) -> Result<Graph, String> {
    let raw = if is_empty(repo) {
        Vec::new()
    } else {
        read_commits(repo, scope, limit, order, filters)?
    };
    let mut raw = raw;
    hang_working_rows(&mut raw, working_rows(repo));
    let (mut commits, edges, lanes) = build_graph(raw);
    let (branch, dirty) = head_of(repo)?;
    let (merged, twins) = already_in_trunk(repo);
    for commit in &mut commits {
        commit.tw = twins.get(&commit.h).cloned();
        for held in &mut commit.refs {
            if held.k == "local" && merged.contains(&held.n) {
                held.m = true;
            }
        }
    }
    Ok(Graph {
        repo: base_name(repo),
        path: repo.to_string(),
        branch,
        dirty,
        truncated: limit > 0 && commits.len() >= limit,
        fingerprint: fingerprint(repo)?,
        lanes,
        commits,
        edges,
    })
}

pub fn commit_detail(repo: &str, hash: &str) -> Result<CommitDetail, String> {
    if !hash.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("bad revision".into());
    }
    let format = format!(
        "--format=%H{f}%an{f}%ae{f}%aI{f}%cn{f}%cI{f}%P{f}%B",
        f = FIELD
    );
    let meta = git(repo, &["show", "-s", format.as_str(), hash])?;
    let parts: Vec<&str> = meta.trim_end_matches('\n').splitn(8, FIELD).collect();
    if parts.len() < 8 {
        return Err("git answered a shape this reader does not know".into());
    }
    let files = git(repo, &["show", "--numstat", "--format=", hash])?
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let added = columns.next()?;
            let removed = columns.next()?;
            let path = columns.next()?;
            Some(CommitFile {
                a: added.parse().ok(),
                d: removed.parse().ok(),
                path: path.to_string(),
            })
        })
        .collect();
    Ok(CommitDetail {
        h: parts[0].to_string(),
        an: parts[1].to_string(),
        ae: parts[2].to_string(),
        at: parts[3].to_string(),
        cn: parts[4].to_string(),
        ct: parts[5].to_string(),
        merge: parts[6].split_whitespace().count() > 1,
        body: parts[7].trim_matches('\n').to_string(),
        files,
    })
}

struct RawBranch {
    name: String,
    head: String,
    t: String,
    upstream: String,
    track: String,
}

/// Name, the commit it stands on, and when: enough to find it in the graph.
///
/// An annotated tag is an object of its own, so the peeled name is what points
/// at the commit; a lightweight one has none and points there itself.
///
/// A symbolic ref points at another of them and is not one: origin/HEAD is the
/// only one here, and it cannot be told by its name, which git shortens to the
/// remote alone.
fn read_plain_refs(repo: &str, where_: &str) -> Result<Vec<PlainRef>, String> {
    let format = format!(
        "--format=%(refname:short){f}%(objectname){f}%(*objectname){f}\
         %(creatordate:iso-strict){f}%(symref)",
        f = FIELD
    );
    let listing = git(
        repo,
        &["for-each-ref", "--sort=-creatordate", format.as_str(), where_],
    )?;
    let mut refs = Vec::new();
    for line in listing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut fields = line.splitn(5, FIELD);
        let (Some(name), Some(tip), Some(peeled), Some(t), Some(symref)) = (
            fields.next(), fields.next(), fields.next(), fields.next(), fields.next(),
        ) else {
            continue;
        };
        if !symref.is_empty() {
            continue;
        }
        refs.push(PlainRef {
            name: name.to_string(),
            head: if peeled.is_empty() { tip.to_string() } else { peeled.to_string() },
            t: t.to_string(),
        });
    }
    Ok(refs)
}

/// Local branches, most recently committed first, with their upstream.
fn read_branch_refs(repo: &str) -> Result<Vec<RawBranch>, String> {
    let format = format!(
        "--format=%(refname:short){f}%(objectname){f}%(committerdate:iso-strict){f}\
         %(upstream:short){f}%(upstream:track,nobracket)",
        f = FIELD
    );
    let listing = git(
        repo,
        &["for-each-ref", "--sort=-committerdate", format.as_str(), "refs/heads"],
    )?;
    let mut rows = Vec::new();
    for line in listing.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut fields = line.splitn(5, FIELD);
        let (Some(name), Some(head), Some(t), Some(upstream), Some(track)) = (
            fields.next(), fields.next(), fields.next(), fields.next(), fields.next(),
        ) else {
            continue;
        };
        rows.push(RawBranch {
            name: name.to_string(),
            head: head.to_string(),
            t: t.to_string(),
            upstream: upstream.to_string(),
            track: track.to_string(),
        });
    }
    Ok(rows)
}

/// The branch a divergence is measured against, None when there is no other one.
fn pick_base(names: &[String], head: &str, branch: Option<&str>) -> Option<String> {
    let first = names.first().map(String::as_str);
    [Some(head), Some("dev"), Some("main"), first]
        .into_iter()
        .flatten()
        .find(|candidate| {
            !candidate.is_empty()
                && Some(*candidate) != branch
                && names.iter().any(|known| known == candidate)
        })
        .map(str::to_string)
}

/// What each side holds that the other does not.
///
/// Answers None when the comparison cannot be made, which is what an upstream
/// whose remote branch was deleted does.
fn divergence(repo: &str, base: &str, branch: &str) -> Option<Divergence> {
    let range = format!("{base}...{branch}");
    let counted = git_soft(repo, &["rev-list", "--left-right", "--count", range.as_str()]);
    let mut counts = counted.split_whitespace();
    let behind = counts.next()?.parse().ok()?;
    let ahead = counts.next()?.parse().ok()?;
    Some(Divergence { behind, ahead })
}

pub fn branches(repo: &str) -> Result<BranchList, String> {
    let rows = read_branch_refs(repo)?;
    let names: Vec<String> = rows.iter().map(|row| row.name.clone()).collect();
    let head = git(repo, &["branch", "--show-current"])?.trim().to_string();

    let mut branches = Vec::with_capacity(rows.len());
    for row in rows {
        let base = pick_base(&names, &head, Some(&row.name));
        let against = base
            .as_deref()
            .and_then(|base| divergence(repo, base, &row.name))
            .unwrap_or(Divergence { behind: 0, ahead: 0 });
        let upstream = if row.upstream.is_empty() {
            None
        } else {
            let counts = if row.track == "gone" {
                None
            } else {
                divergence(repo, &row.upstream, &row.name)
            };
            Some(Upstream {
                name: row.upstream,
                behind: counts.map_or(0, |counts| counts.behind),
                ahead: counts.map_or(0, |counts| counts.ahead),
                gone: counts.is_none(),
            })
        };
        branches.push(Branch {
            current: row.name == head,
            name: row.name,
            head: row.head,
            t: row.t,
            base,
            behind: against.behind,
            ahead: against.ahead,
            upstream,
        });
    }
    Ok(BranchList {
        base: pick_base(&names, &head, None),
        branches,
        remotes: read_plain_refs(repo, "refs/remotes")?,
        tags: read_plain_refs(repo, "refs/tags")?,
    })
}

/// One line about a repository, tolerant: a moved folder must not break the list.
pub fn describe(path: &str) -> RepoEntry {
    let mut entry = RepoEntry {
        path: path.to_string(),
        name: base_name(path),
        branch: None,
        dirty: None,
        error: None,
    };
    match head_of(path) {
        Ok((branch, dirty)) => {
            entry.branch = Some(branch);
            entry.dirty = Some(dirty);
        }
        Err(err) => entry.error = Some(err.lines().next().unwrap_or("unreadable").to_string()),
    }
    entry
}

/// Repositories under a folder, without walking into their working trees.
pub fn discover(root: &str, depth: usize) -> Result<Vec<String>, String> {
    if !Path::new(root).is_dir() {
        return Err(format!("no such directory: {root}"));
    }
    let mut found = Vec::new();
    walk(Path::new(root), 1, depth, &mut found);
    Ok(found)
}

fn walk(folder: &Path, level: usize, depth: usize, found: &mut Vec<String>) {
    if level > depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    let mut names: Vec<_> = entries.flatten().collect();
    names.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for entry in names {
        if !entry.path().is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.path().join(".git").is_dir() {
            found.push(entry.path().to_string_lossy().into_owned());
            continue;
        }
        walk(&entry.path(), level + 1, depth, found);
    }
}
