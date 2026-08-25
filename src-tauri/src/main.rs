// A release build must not open a console behind the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;

use git::{CommitDetail, Graph, RepoEntry};
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
}

#[tauri::command]
fn repos() -> RepoList {
    let held = load_registry();
    RepoList {
        default: held.first().cloned(),
        repos: held.iter().map(|path| git::describe(path)).collect(),
    }
}

#[tauri::command]
fn open_repo(path: String) -> Result<RepoEntry, String> {
    let top = git::toplevel(&path)?;
    let mut held = load_registry();
    held.retain(|known| !same_path(known, &top));
    held.insert(0, top.clone());
    held.truncate(40);
    save_registry(&held);
    Ok(git::describe(&top))
}

#[tauri::command]
fn close_repo(path: String) -> Vec<RepoEntry> {
    let mut held = load_registry();
    held.retain(|known| !same_path(known, &path));
    save_registry(&held);
    held.iter().map(|known| git::describe(known)).collect()
}

#[tauri::command]
fn discover(root: String) -> Result<Vec<RepoEntry>, String> {
    Ok(git::discover(&root, 2)?.iter().map(|path| git::describe(path)).collect())
}

#[tauri::command]
fn graph(repo: Option<String>, scope: String, limit: usize) -> Result<Graph, String> {
    git::graph(&which_repo(repo)?, &scope, limit)
}

#[tauri::command]
fn fingerprint(repo: Option<String>) -> Result<String, String> {
    git::fingerprint(&which_repo(repo)?)
}

#[tauri::command]
fn commit_detail(repo: Option<String>, hash: String) -> Result<CommitDetail, String> {
    git::commit_detail(&which_repo(repo)?, &hash)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            repos,
            open_repo,
            close_repo,
            discover,
            graph,
            fingerprint,
            commit_detail
        ])
        .run(tauri::generate_context!())
        .expect("gitlanes could not start its window");
}
