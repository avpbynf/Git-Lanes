// A release build must not open a console behind the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod git;

use git::{BranchList, CommitDetail, Filters, Graph, RepoEntry, WorkingDetail};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The list of opened repositories, in the same file the Python backend uses,
/// so both ways into this tool remember the same thing.
fn registry_file() -> PathBuf {
    let base = std::env::var("APPDATA")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("gitlanes").join("repos.json")
}

#[derive(Serialize, Deserialize, Default)]
struct Registry {
    repos: Vec<String>,
}

fn load_registry() -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(registry_file()) else { return Vec::new() };
    serde_json::from_str::<Registry>(&text).map(|held| held.repos).unwrap_or_default()
}

fn save_registry(repos: &[String]) {
    let file = registry_file();
    if let Some(folder) = file.parent() {
        let _ = std::fs::create_dir_all(folder);
    }
    if let Ok(text) = serde_json::to_string_pretty(&Registry { repos: repos.to_vec() }) {
        let _ = std::fs::write(file, text);
    }
}

fn same_path(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

/// The repository a call speaks about: the one it names, else the last opened.
fn which_repo(asked: Option<String>) -> Result<String, String> {
    if let Some(path) = asked.filter(|path| !path.is_empty()) {
        return git::toplevel(&path);
    }
    match load_registry().first() {
        Some(path) => git::toplevel(path),
        None => Err("no repository opened yet".into()),
    }
}

#[derive(Serialize)]
struct RepoList {
    repos: Vec<RepoEntry>,
    default: Option<String>,
    /// Taken from the manifest at compile time, so it cannot drift from the build.
    version: &'static str,
}

/// Read git off the main thread.
///
/// A synchronous command runs on the thread that pumps the window messages, so
/// spawning git there freezes the window: it stops repainting while Windows
/// moves it, and a move loop started from the page dies on the spot. The page
/// asks for a fingerprint every two and a half seconds, so this is not an edge
/// case, it is the normal traffic.
async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| format!("the reader thread gave up: {err}"))?
}

#[tauri::command]
async fn repos() -> Result<RepoList, String> {
    off_thread(|| {
        let held = load_registry();
        Ok(RepoList {
            default: held.first().cloned(),
            repos: held.iter().map(|path| git::describe(path)).collect(),
            version: env!("CARGO_PKG_VERSION"),
        })
    })
    .await
}

/// A folder chosen in a window of the system's own, or nothing if it was dismissed.
///
/// It is not told which window owns it, so it opens beside the app rather than
/// on top of it. Owning it means handing rfd a raw window handle, which is more
/// plumbing than the difference is worth for now.
#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    off_thread(|| {
        Ok(rfd::FileDialog::new()
            .set_title("A repository, or a folder holding some")
            .pick_folder()
            .map(|folder| folder.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
async fn open_repo(path: String) -> Result<RepoEntry, String> {
    off_thread(move || {
        let top = git::toplevel(&path)?;
        let mut held = load_registry();
        held.retain(|known| !same_path(known, &top));
        held.insert(0, top.clone());
        held.truncate(40);
        save_registry(&held);
        Ok(git::describe(&top))
    })
    .await
}

#[tauri::command]
async fn close_repo(path: String) -> Result<Vec<RepoEntry>, String> {
    off_thread(move || {
        let mut held = load_registry();
        held.retain(|known| !same_path(known, &path));
        save_registry(&held);
        Ok(held.iter().map(|known| git::describe(known)).collect())
    })
    .await
}

#[tauri::command]
async fn discover(root: String) -> Result<Vec<RepoEntry>, String> {
    off_thread(move || {
        Ok(git::discover(&root, 2)?.iter().map(|path| git::describe(path)).collect())
    })
    .await
}

#[tauri::command]
async fn graph(
    repo: Option<String>,
    scope: String,
    limit: usize,
    order: String,
    filters: Filters,
) -> Result<Graph, String> {
    off_thread(move || git::graph(&which_repo(repo)?, &scope, limit, &order, &filters)).await
}

#[tauri::command]
async fn branches(repo: Option<String>) -> Result<BranchList, String> {
    off_thread(move || git::branches(&which_repo(repo)?)).await
}

#[tauri::command]
async fn fingerprint(repo: Option<String>) -> Result<String, String> {
    off_thread(move || git::fingerprint(&which_repo(repo)?)).await
}

#[tauri::command]
async fn commit_detail(repo: Option<String>, hash: String) -> Result<CommitDetail, String> {
    off_thread(move || git::commit_detail(&which_repo(repo)?, &hash)).await
}

#[tauri::command]
async fn working(repo: Option<String>, path: String) -> Result<WorkingDetail, String> {
    off_thread(move || git::working_detail(&which_repo(repo)?, &path)).await
}

#[tauri::command]
async fn project_actions(repo: Option<String>) -> Result<Vec<actions::Action>, String> {
    off_thread(move || Ok(actions::actions_for(&which_repo(repo)?))).await
}

/// Answers once the command is running. What it does after that arrives as events, since a build
/// worth watching is a build too long to wait for in one answer.
#[tauri::command]
async fn run_action(
    app: tauri::AppHandle,
    repo: Option<String>,
    index: usize,
    sha: String,
    refname: String,
) -> Result<(), String> {
    let repo = which_repo(repo)?;
    actions::start(app, repo, index, sha, refname)
}

#[tauri::command]
async fn stop_action() -> Result<(), String> {
    actions::stop()
}

/// Whether the user's own file says what opens a diff. Nothing does when it does not, and the
/// page needs to know that before it makes a row look like something to click.
#[tauri::command]
async fn diff_ready() -> Result<bool, String> {
    off_thread(|| Ok(!actions::diff_command().trim().is_empty())).await
}

/// Show one file's two sides. `folder` names a worktree instead of a commit, in which case the
/// right-hand side is the file itself rather than a copy of it.
#[tauri::command]
async fn open_diff(
    repo: Option<String>,
    sha: String,
    path: String,
    folder: String,
) -> Result<(), String> {
    off_thread(move || actions::open_diff(&which_repo(repo)?, &sha, &path, &folder)).await
}

/// Opens the file in whatever the system opens JSON with, writing an example first if there is
/// nothing there yet, and answers where it is.
#[tauri::command]
async fn edit_actions(repo: Option<String>) -> Result<String, String> {
    off_thread(move || actions::open_actions(&which_repo(repo)?)).await
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            repos,
            pick_folder,
            open_repo,
            close_repo,
            discover,
            graph,
            branches,
            fingerprint,
            commit_detail,
            working,
            project_actions,
            run_action,
            stop_action,
            edit_actions,
            diff_ready,
            open_diff
        ])
        .run(tauri::generate_context!())
        .expect("GitLanes could not start its window");
}
