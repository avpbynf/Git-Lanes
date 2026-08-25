//! Reading a repository, and turning its commits into lanes.
//!
//! This is the same reading the Python backend does, and it answers the same
//! shapes, because the front end cannot tell which one it is talking to.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';
/// What the front end prefixes a scope with to name one branch.
const BRANCH: &str = "branch:";

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
pub fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
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
            refs.push(GitRef { n: "HEAD".into(), k: "head" });
            raw = rest.trim();
        }
        if raw == "HEAD" {
            refs.push(GitRef { n: "HEAD".into(), k: "head" });
            continue;
        }
        if let Some(tag) = raw.strip_prefix("tag: ") {
            refs.push(GitRef { n: tag.trim().into(), k: "tag" });
            continue;
        }
        let kind = if remotes.iter().any(|remote| raw.starts_with(&format!("{remote}/"))) {
            "remote"
        } else {
            "local"
        };
        refs.push(GitRef { n: raw.into(), k: kind });
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
    let branch_ref = scope.strip_prefix(BRANCH).map(|name| format!("refs/heads/{name}"));
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
    if scope == "all" {
        // not --all: that one drags in refs/stash and the note refs
        args.extend_from_slice(&["--branches", "--tags", "--remotes", "HEAD"]);
    } else if let Some(reference) = branch_ref.as_deref() {
        // spelled in full: a branch called -f stays a branch and never an option
        args.push(reference);
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
        commits.push(Raw {
            h: h.to_string(),
            p: parents.split_whitespace().map(str::to_string).collect(),
            an: an.to_string(),
            t: t.to_string(),
            s: s.to_string(),
            refs: parse_refs(decoration, &remotes),
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
    let mut next_color = 0usize;

    let mut open_lane = |lanes: &mut Vec<Option<String>>,
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
        lanes[index] = Some(wanted.to_string());
        colors[index] = next_color;
        next_color += 1;
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
    let (commits, edges, lanes) = build_graph(raw);
    let (branch, dirty) = head_of(repo)?;
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
fn read_plain_refs(repo: &str, where_: &str) -> Result<Vec<PlainRef>, String> {
    let format = format!(
        "--format=%(refname:short){f}%(objectname){f}%(*objectname){f}%(creatordate:iso-strict)",
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
        let mut fields = line.splitn(4, FIELD);
        let (Some(name), Some(tip), Some(peeled), Some(t)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
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
    // origin/HEAD is a pointer at another of them, never a branch of its own
    let remotes = read_plain_refs(repo, "refs/remotes")?
        .into_iter()
        .filter(|one| !one.name.ends_with("/HEAD"))
        .collect();

    Ok(BranchList {
        base: pick_base(&names, &head, None),
        branches,
        remotes,
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
