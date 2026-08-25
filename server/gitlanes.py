#!/usr/bin/env python3
"""Read local git repositories and serve their commit graph to the front end.

This is the development backend. It owns no state beyond the list of
repositories the user has opened, and every route answers for one repository
named in the query, so the page can switch without a restart.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIST = os.path.join(ROOT, "web", "dist")
FIELD = "\x1f"
RECORD = "\x1e"


# --------------------------------------------------------------------------- git

def git(repo, *args):
    proc = subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip() or "git failed")
    return proc.stdout


def git_soft(repo, *args):
    """Same, but an expected failure answers empty instead of raising."""
    try:
        return git(repo, *args)
    except RuntimeError:
        return ""


def toplevel(path):
    """Absolute root of the repository holding path, or a RuntimeError."""
    if not path or not os.path.isdir(path):
        raise RuntimeError("no such directory: %s" % path)
    return os.path.abspath(git(path, "rev-parse", "--show-toplevel").strip())


def remote_names(repo):
    return [line.strip() for line in git(repo, "remote").splitlines() if line.strip()]


def parse_refs(decoration, remotes):
    refs = []
    for raw in (part.strip() for part in decoration.split(",")):
        if not raw:
            continue
        if raw.startswith("HEAD -> "):
            refs.append({"n": "HEAD", "k": "head"})
            raw = raw[len("HEAD -> "):].strip()
        if raw == "HEAD":
            refs.append({"n": "HEAD", "k": "head"})
            continue
        if raw.startswith("tag: "):
            refs.append({"n": raw[5:].strip(), "k": "tag"})
            continue
        kind = "local"
        for remote in remotes:
            if raw.startswith(remote + "/"):
                kind = "remote"
                break
        refs.append({"n": raw, "k": kind})
    return refs


def read_commits(repo, scope, limit):
    fmt = FIELD.join(["%H", "%P", "%an", "%aI", "%D", "%s"]) + RECORD
    args = ["log", "--date-order", "--pretty=format:" + fmt]
    if scope == "all":
        # not --all: that one drags in refs/stash and the note refs
        args += ["--branches", "--tags", "--remotes", "HEAD"]
    if limit:
        args += ["-n", str(limit)]
    remotes = remote_names(repo)
    commits = []
    for record in git(repo, *args).split(RECORD):
        record = record.strip("\r\n")
        if not record:
            continue
        h, parents, author, when, decoration, subject = record.split(FIELD, 5)
        commits.append({
            "h": h,
            "p": parents.split() if parents else [],
            "an": author,
            "t": when,
            "s": subject,
            "refs": parse_refs(decoration, remotes),
        })
    return commits


def build_graph(commits):
    """Give every commit a column and route one edge per parent link.

    A lane holds the hash it is still waiting for. A commit takes the leftmost
    lane waiting for it, and the other lanes waiting for it close there: that is
    what draws a merge. Its first parent keeps the lane, the others open one,
    which is what draws a branch.
    """
    where = {c["h"]: i for i, c in enumerate(commits)}
    lanes = []            # hash awaited in each lane, None when the lane is free
    colors = []           # colour index carried by each lane
    edges = []
    next_color = 0

    def open_lane(wanted):
        nonlocal next_color
        try:
            i = lanes.index(None)
        except ValueError:
            i = len(lanes)
            lanes.append(None)
            colors.append(0)
        lanes[i] = wanted
        colors[i] = next_color
        next_color += 1
        return i

    for row, commit in enumerate(commits):
        h = commit["h"]
        waiting = [i for i, want in enumerate(lanes) if want == h]
        if waiting:
            lane = waiting[0]
            for i in waiting[1:]:
                lanes[i] = None
        else:
            lane = open_lane(h)
        commit["lane"] = lane
        commit["row"] = row
        commit["c"] = colors[lane]
        lanes[lane] = None

        for rank, parent in enumerate(commit["p"]):
            if rank == 0:
                route = lane
                lanes[route] = parent
            else:
                already = next((i for i, want in enumerate(lanes) if want == parent), None)
                route = already if already is not None else open_lane(parent)
            edges.append({"fr": row, "fl": lane, "rl": route, "c": colors[route], "p": parent})

    for edge in edges:
        target = where.get(edge.pop("p"))
        if target is None:
            edge["tr"] = None
            edge["tl"] = edge["rl"]
        else:
            edge["tr"] = commits[target]["row"]
            edge["tl"] = commits[target]["lane"]
    return edges, len(lanes)


def fingerprint(repo):
    refs = git(repo, "for-each-ref", "--format=%(objectname) %(refname)")
    head = git_soft(repo, "rev-parse", "--verify", "-q", "HEAD")
    dirty = git(repo, "status", "--porcelain")
    return hashlib.sha1((refs + head + dirty).encode("utf-8")).hexdigest()


def head_of(repo):
    # --show-current, not rev-parse: it also names the branch of a repository
    # that has no commit yet, where rev-parse simply fails.
    branch = git(repo, "branch", "--show-current").strip()
    if not branch:
        short = git_soft(repo, "rev-parse", "--short", "HEAD").strip()
        branch = ("detached " + short) if short else "no commit yet"
    return branch, bool(git(repo, "status", "--porcelain").strip())


def is_empty(repo):
    return not git_soft(repo, "for-each-ref", "--count=1", "--format=%(objectname)").strip()


def graph_payload(repo, scope, limit):
    commits = [] if is_empty(repo) else read_commits(repo, scope, limit)
    edges, lane_count = build_graph(commits)
    branch, dirty = head_of(repo)
    return {
        "repo": os.path.basename(repo) or repo,
        "path": repo,
        "branch": branch,
        "dirty": dirty,
        "commits": commits,
        "edges": edges,
        "lanes": lane_count,
        "truncated": bool(limit) and len(commits) >= limit,
        "fingerprint": fingerprint(repo),
    }


def commit_detail(repo, h):
    fmt = FIELD.join(["%H", "%an", "%ae", "%aI", "%cn", "%cI", "%P", "%B"])
    meta = git(repo, "show", "-s", "--format=" + fmt, h).rstrip("\n")
    full, author, email, authored, committer, committed, parents, body = meta.split(FIELD, 7)
    files = []
    for line in git(repo, "show", "--numstat", "--format=", h).splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, removed, path = parts
        files.append({
            "a": None if added == "-" else int(added),
            "d": None if removed == "-" else int(removed),
            "path": path,
        })
    return {
        "h": full, "an": author, "ae": email, "at": authored,
        "cn": committer, "ct": committed, "body": body.strip("\n"),
        "files": files, "merge": len(parents.split()) > 1,
    }


# --------------------------------------------------------- the list of repositories

def config_path():
    base = os.environ.get("APPDATA") or os.path.expanduser("~/.config")
    folder = os.path.join(base, "gitlanes")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "repos.json")


def load_repos():
    try:
        with open(config_path(), encoding="utf-8") as handle:
            stored = json.load(handle)
    except (OSError, ValueError):
        return []
    return [p for p in stored.get("repos", []) if isinstance(p, str)]


def save_repos(paths):
    with open(config_path(), "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"repos": paths}, handle, indent=1)


def remember(path):
    """Put a repository at the head of the list, most recent first."""
    top = toplevel(path)
    paths = [p for p in load_repos() if os.path.normcase(p) != os.path.normcase(top)]
    paths.insert(0, top)
    save_repos(paths[:40])
    return top


def forget(path):
    target = os.path.normcase(os.path.abspath(path))
    save_repos([p for p in load_repos() if os.path.normcase(p) != target])


def describe(path):
    """One line about a repository, tolerant: a moved folder must not break the list."""
    entry = {"path": path, "name": os.path.basename(path) or path}
    try:
        entry["branch"], entry["dirty"] = head_of(path)
    except RuntimeError as err:
        entry["error"] = str(err).splitlines()[0]
    return entry


def discover(root, depth=2):
    """Repositories under a folder, without walking into their working trees."""
    found = []
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise RuntimeError("no such directory: %s" % root)

    def walk(folder, level):
        if level > depth:
            return
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name.lower())
        except OSError:
            return
        for entry in entries:
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            if os.path.isdir(os.path.join(entry.path, ".git")):
                found.append(entry.path)
                continue
            walk(entry.path, level + 1)

    walk(root, 1)
    return found


# ------------------------------------------------------------------------- serving

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    default_repo = None

    def log_message(self, *args):
        pass

    def send_payload(self, body, content_type):
        raw = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def send_json(self, payload):
        self.send_payload(json.dumps(payload), "application/json; charset=utf-8")

    def fail(self, status, message):
        raw = json.dumps({"error": message}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    # the repository a request speaks about, the default one when it says nothing
    def which_repo(self, query):
        asked = query.get("repo", [None])[0]
        if asked:
            return toplevel(unquote(asked))
        if self.default_repo:
            return self.default_repo
        stored = load_repos()
        if stored:
            return toplevel(stored[0])
        raise RuntimeError("no repository opened yet")

    def serve_static(self, path):
        if os.path.isdir(DIST):
            relative = path.lstrip("/") or "index.html"
            target = os.path.normpath(os.path.join(DIST, relative))
            if not target.startswith(DIST):          # never climb out of dist
                self.fail(403, "outside the served folder")
                return
            if not os.path.isfile(target):
                target = os.path.join(DIST, "index.html")   # the router owns the path
            kind = mimetypes.guess_type(target)[0] or "application/octet-stream"
            with open(target, "rb") as handle:
                self.send_payload(handle.read(), kind)
            return
        self.fail(404, "no front end built: run bun install and bun run build in web/")

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == "/api/repos":
                self.send_json({
                    "repos": [describe(p) for p in load_repos()],
                    "default": self.default_repo,
                })
            elif url.path == "/api/discover":
                root = query.get("root", [""])[0]
                self.send_json({"repos": [describe(p) for p in discover(unquote(root))]})
            elif url.path == "/api/graph":
                repo = self.which_repo(query)
                limit = int(query.get("limit", ["400"])[0])
                self.send_json(graph_payload(repo, query.get("scope", ["all"])[0], max(limit, 0)))
            elif url.path == "/api/fingerprint":
                self.send_json({"fingerprint": fingerprint(self.which_repo(query))})
            elif url.path == "/api/commit":
                h = query.get("h", [""])[0]
                if not h.isalnum():
                    self.fail(400, "bad revision")
                    return
                self.send_json(commit_detail(self.which_repo(query), h))
            elif url.path.startswith("/api/"):
                self.fail(404, "no such endpoint")
            else:
                self.serve_static(url.path)
        except RuntimeError as err:
            self.fail(400, str(err))
        except Exception as err:      # a git oddity must not take the server down
            self.fail(500, "%s: %s" % (type(err).__name__, err))

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self.fail(400, "body is not json")
            return
        try:
            if url.path == "/api/repos/open":
                path = remember(body.get("path", ""))
                self.send_json({"repo": describe(path)})
            elif url.path == "/api/repos/close":
                forget(body.get("path", ""))
                self.send_json({"repos": [describe(p) for p in load_repos()]})
            else:
                self.fail(404, "no such endpoint")
        except RuntimeError as err:
            self.fail(400, str(err))
        except Exception as err:
            self.fail(500, "%s: %s" % (type(err).__name__, err))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=None, help="repository to open on start")
    parser.add_argument("--port", type=int, default=7420)
    parser.add_argument("--open", action="store_true", help="open a browser on start")
    options = parser.parse_args()

    if options.repo:
        try:
            Handler.default_repo = remember(options.repo)
        except RuntimeError as err:
            print("not a git repository: %s (%s)" % (options.repo, err), file=sys.stderr)
            return 2

    server = ThreadingHTTPServer(("127.0.0.1", options.port), Handler)
    url = "http://127.0.0.1:%d/" % options.port
    print("%s -> %s" % (Handler.default_repo or "no repository", url))
    if options.open:
        threading.Timer(0.4, webbrowser.open, args=[url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
