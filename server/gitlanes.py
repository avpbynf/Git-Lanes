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
REF = "ref:"            # what the front end prefixes a scope with to name one ref


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
        # git slips these in among the refs, and neither one is a ref: taken for
        # branches they showed as a branch named grafted on every shallow tip
        if raw in ("grafted", "replaced"):
            continue
        kind = "local"
        for remote in remotes:
            if raw.startswith(remote + "/"):
                kind = "remote"
                break
        refs.append({"n": raw, "k": kind})
    return refs


def shallow_of(repo):
    """The commits a shallow clone was cut at, empty when the clone is whole.

    Read from the file rather than asked of git, which costs an open instead of
    a process. A worktree keeps its shallow list in the repository it belongs
    to, and that is not chased here: a worktree of a shallow clone says nothing.
    """
    try:
        with open(os.path.join(repo, ".git", "shallow"), encoding="utf-8") as handle:
            return {line.strip() for line in handle if line.strip()}
    except OSError:
        return set()


# The names a branch is measured against. Anything else is a topic branch, and a topic branch is
# what can be finished with rather than what work is aimed at.
TRUNKS = ("dev", "main", "master", "trunk")
# How far back a replay is looked for on the trunk side. What normally bounds it is where the
# oldest branch left the trunk, tens of commits; this is for the branch abandoned a year ago,
# whose diffs would otherwise be seconds of work.
CHERRY_CAP = 1000
# Commits per pipeline. Both pipes stay under what the system buffers, so nothing has to be read
# while something else is still being written.
CHERRY_BATCH = 400

# repo -> (the refs it was read from, the answer). What a replay costs is diffs, and the answer
# only moves when a ref does, so a working tree being typed in does not pay for it again.
_in_trunk = {}


def patch_ids(repo, revs):
    """Every commit named, filed under the patch it carries.

    The diffs never come back into this process: diff-tree writes them straight into patch-id,
    which answers one short line per commit. Reading them here would be megabytes of text in no
    encoding in particular, a diff carrying whatever the files carry.
    """
    filed = {}
    for start in range(0, len(revs), CHERRY_BATCH):
        batch = revs[start:start + CHERRY_BATCH]
        diffs = subprocess.Popen(["git", "-C", repo, "diff-tree", "--stdin", "-p"],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        ids = subprocess.Popen(["git", "-C", repo, "patch-id", "--stable"],
                               stdin=diffs.stdout, stdout=subprocess.PIPE)
        # this process keeps no handle on the diffs, or patch-id would wait on a pipe that
        # nothing is left to close
        diffs.stdout.close()
        diffs.stdin.write(("\n".join(batch) + "\n").encode("utf-8"))
        diffs.stdin.close()
        answer = ids.communicate()[0].decode("utf-8", "replace")
        diffs.wait()
        for line in answer.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                filed.setdefault(parts[0], []).append(parts[1])
    return filed


def already_in_trunk(repo):
    """Which branches a trunk already holds, and the hash it holds each of their commits under.

    A branch is in a trunk in one of two ways. The trunk holds its very commits, which is what a
    fast-forward leaves, and git says so. Or the trunk holds the same changes under other hashes,
    which is what a rebase and a cherry-pick leave, and about that git says nothing at all: the
    branch reads as work still waiting, forever, and the commits read as two pieces of work when
    they are one done twice.

    Both answers are the same question asked of the patch rather than of the hash.
    """
    rows = [line.split() for line in
            git(repo, "for-each-ref", "--format=%(refname:short) %(objectname)",
                "refs/heads").splitlines() if line.strip()]
    key = tuple(tuple(row) for row in rows)
    held = _in_trunk.get(repo)
    if held and held[0] == key:
        return held[1]

    answer = (set(), {})
    tips = {row[0]: row[1] for row in rows if len(row) == 2}
    trunks = [name for name in tips if name in TRUNKS]
    topics = [name for name in tips if name not in TRUNKS]
    if trunks and topics:
        answer = read_in_trunk(repo, tips, trunks, topics)
    _in_trunk[repo] = (key, answer)
    return answer


def read_in_trunk(repo, tips, trunks, topics):
    trunk_tips = [tips[name] for name in trunks]
    topic_tips = [tips[name] for name in topics]

    # every commit the topic branches hold and no trunk does, with its parents, so which branch
    # each one belongs to is walked here rather than asked of git one branch at a time
    own = {}
    for line in git(repo, "rev-list", "--parents", *topic_tips, "--not", *trunk_tips).splitlines():
        parts = line.split()
        if parts:
            own[parts[0]] = parts[1:]
    if not own:
        return set(topics), {}

    # Where the oldest of those branches left the trunk, which is as far back as a replay of
    # theirs can sit. Asking for the trunk --not the branches answers nothing at all for a branch
    # that is merely ahead of the trunk, the whole trunk being reachable from it.
    base = git_soft(repo, "merge-base", "--octopus", *trunk_tips, *topic_tips).split()
    span = (["--not"] + base) if base else ["-n", str(CHERRY_CAP)]
    theirs = git(repo, "rev-list", "--no-merges", *trunk_tips, *span).split()[:CHERRY_CAP]
    # a merge commit carries no patch of its own, and a replay drops it, so it is never asked for
    mine = [h for h, parents in own.items() if len(parents) < 2]

    twins = {}
    if theirs and mine:
        on_trunk = set(theirs)
        for group in patch_ids(repo, theirs + mine).values():
            here = [h for h in group if h in on_trunk]
            if not here:
                continue
            for one in group:
                if one not in on_trunk:
                    twins[one] = here[0]
                    twins[here[0]] = one

    merged = set()
    for name in topics:
        tip = tips[name]
        if tip not in own:
            merged.add(name)            # the trunk holds this branch under its own hashes
            continue
        walked, front = set(), [tip]
        while front:
            here = front.pop()
            if here in walked or here not in own:
                continue
            walked.add(here)
            front.extend(own[here])
        if all(twins.get(h) for h in walked if len(own[h]) < 2):
            merged.add(name)

    return merged, twins


def read_commits(repo, scope, limit, order, author="", since="", paths=""):
    fmt = FIELD.join(["%H", "%P", "%an", "%aI", "%D", "%s"]) + RECORD
    args = ["log", "--topo-order" if order == "topo" else "--date-order",
            "--pretty=format:" + fmt]
    # a scope must spell refs/... in full, or it is no scope: that is what keeps a
    # ref called -f a ref and never an option. A tag starts a history as a branch does.
    wanted = scope[len(REF):] if scope.startswith(REF) else ""
    if wanted.startswith("refs/"):
        args.append(wanted)
    else:
        # not --all: that one drags in refs/stash and the note refs
        args += ["--branches", "--tags", "--remotes", "HEAD"]
    if author:
        args.append("--author=" + author)
    if since:
        args.append("--since=" + since)
    if limit:
        args += ["-n", str(limit)]
    # the paths come last, behind the separator, or a branch named like a file wins
    wanted = [part.strip() for part in paths.split(",") if part.strip()]
    if wanted:
        args.append("--")
        args += wanted
    remotes = remote_names(repo)
    cut = shallow_of(repo)
    commits = []
    for record in git(repo, *args).split(RECORD):
        record = record.strip("\r\n")
        if not record:
            continue
        # `who`, not `author`: that name is the filter, read a few lines above
        h, parents, who, when, decoration, subject = record.split(FIELD, 5)
        refs = parse_refs(decoration, remotes)
        if h in cut:
            refs.append({"n": "shallow", "k": "shallow"})
        commits.append({
            "h": h,
            "p": parents.split() if parents else [],
            "an": who,
            "t": when,
            "s": subject,
            "refs": refs,
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

    def open_lane(wanted):
        try:
            i = lanes.index(None)
        except ValueError:
            i = len(lanes)
            lanes.append(None)
            colors.append(0)
        # The colour is what tells two lanes apart, so a lane may not take one
        # another live lane is already carrying. Counting up instead handed the
        # same colour to two lanes drawn at once, on a fifth of the rows of a
        # repository eight lanes wide.
        taken = {colors[j] for j, want in enumerate(lanes) if want is not None and j != i}
        colour = 0
        while colour in taken:
            colour += 1
        colors[i] = colour
        lanes[i] = wanted
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


def graph_payload(repo, scope, limit, order, author="", since="", paths=""):
    commits = [] if is_empty(repo) else read_commits(repo, scope, limit, order,
                                                     author, since, paths)
    edges, lane_count = build_graph(commits)
    branch, dirty = head_of(repo)
    merged, twins = already_in_trunk(repo)
    for commit in commits:
        twin = twins.get(commit["h"])
        if twin:
            commit["tw"] = twin
        for ref in commit["refs"]:
            if ref["k"] == "local" and ref["n"] in merged:
                ref["m"] = True
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


def read_branch_refs(repo):
    """Local branches, most recently committed first, with their upstream."""
    fmt = FIELD.join([
        "%(refname:short)", "%(objectname)", "%(committerdate:iso-strict)",
        "%(upstream:short)", "%(upstream:track,nobracket)",
    ])
    listing = git(repo, "for-each-ref", "--sort=-committerdate", "--format=" + fmt, "refs/heads")
    return [line.split(FIELD) for line in listing.splitlines() if line.strip()]


def read_plain_refs(repo, where):
    """Name, the commit it stands on, and when: enough to find it in the graph.

    An annotated tag is an object of its own, so the peeled name is what points
    at the commit; a lightweight one has none and points there itself.

    A symbolic ref points at another of them and is not one: origin/HEAD is the
    only one here, and it cannot be told by its name, which git shortens to the
    remote alone.
    """
    fmt = FIELD.join([
        "%(refname:short)", "%(objectname)", "%(*objectname)",
        "%(creatordate:iso-strict)", "%(symref)",
    ])
    listing = git(repo, "for-each-ref", "--sort=-creatordate", "--format=" + fmt, where)
    refs = []
    for line in listing.splitlines():
        if not line.strip():
            continue
        name, tip, peeled, when, symref = line.split(FIELD)
        if symref:
            continue
        refs.append({"name": name, "head": peeled or tip, "t": when})
    return refs


def pick_base(names, head, branch=None):
    """The branch a divergence is measured against, None when there is no other one."""
    for candidate in (head, "dev", "main", names[0] if names else None):
        if candidate and candidate != branch and candidate in names:
            return candidate
    return None


def divergence(repo, base, branch):
    """What each side holds that the other does not, base first.

    Answers None when the comparison cannot be made, which is what an upstream
    whose remote branch was deleted does.
    """
    counts = git_soft(repo, "rev-list", "--left-right", "--count", base + "..." + branch).split()
    if len(counts) != 2:
        return None
    return int(counts[0]), int(counts[1])


def branch_payload(repo):
    rows = read_branch_refs(repo)
    names = [row[0] for row in rows]
    head = git(repo, "branch", "--show-current").strip()
    branches = []
    for name, tip, when, upstream, track in rows:
        against = pick_base(names, head, name)
        behind, ahead = (divergence(repo, against, name) if against else None) or (0, 0)
        pushed = None
        if upstream:
            counts = None if track == "gone" else divergence(repo, upstream, name)
            pushed = {
                "name": upstream,
                "behind": counts[0] if counts else 0,
                "ahead": counts[1] if counts else 0,
                "gone": counts is None,
            }
        branches.append({
            "name": name,
            "head": tip,
            "t": when,
            "current": name == head,
            "base": against,
            "behind": behind,
            "ahead": ahead,
            "upstream": pushed,
        })
    return {
        "base": pick_base(names, head),
        "branches": branches,
        "remotes": read_plain_refs(repo, "refs/remotes"),
        "tags": read_plain_refs(repo, "refs/tags"),
    }


# --------------------------------------------------------- the list of repositories

def app_version():
    """The version, read where the only copy of it lives: the Rust manifest.

    The Rust side answers the same string from its own compile, so neither can
    drift from the other. The first `version` line of a manifest is the package
    one; a dependency writes its own inside braces, never at the start of a line.
    """
    try:
        with open(os.path.join(ROOT, "src-tauri", "Cargo.toml"), encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("version"):
                    return line.split("=", 1)[1].strip().strip('"')
    except (OSError, IndexError):
        pass
    return ""


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
                    "version": app_version(),
                })
            elif url.path == "/api/discover":
                root = query.get("root", [""])[0]
                self.send_json({"repos": [describe(p) for p in discover(unquote(root))]})
            elif url.path == "/api/graph":
                repo = self.which_repo(query)
                limit = int(query.get("limit", ["400"])[0])
                self.send_json(graph_payload(
                    repo,
                    query.get("scope", ["all"])[0],
                    max(limit, 0),
                    query.get("order", ["date"])[0],
                    author=query.get("author", [""])[0],
                    since=query.get("since", [""])[0],
                    paths=query.get("paths", [""])[0],
                ))
            elif url.path == "/api/branches":
                self.send_json(branch_payload(self.which_repo(query)))
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
