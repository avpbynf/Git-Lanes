# gitlanes

The commit graph of a local repository, in the browser, drawn the way GitLab draws it: one
column per branch, an elbow where a branch opens and where it merges, dates down the left
margin, branch and tag labels on the commits that carry them.

It exists because reading where a branch stands should not cost opening an IDE.

## Running it

```
.\gitlanes.ps1                     the repository in the current folder
.\gitlanes.ps1 -Repo C:\code\foo   any other one
.\gitlanes.ps1 -Port 7421          a second one, at the same time
```

The page redraws on its own whenever a ref moves, and every ten seconds in any case. It pauses
while its tab is hidden and catches up when you come back to it.

Click a commit for its message and the files it touched. `/` focuses the filter, which dims
what does not match instead of hiding it, so the shape of the graph stays readable. Escape
closes the panel, then clears the filter.

## What it needs

Git and Python 3. Nothing else, no package to install: the backend is standard library only.

## How it reads a repository

It runs `git log`, `git show` and `git for-each-ref` and parses their output. **It never writes
to a repository**, and it holds no lock, so it is safe to leave open while you work.

The lane assignment is the whole trick, and it lives in `build_graph`. A lane holds the hash it
is still waiting for. A commit takes the leftmost lane waiting for it, and the other lanes
waiting for it close there, which is what draws a merge. Its first parent keeps the lane, the
others open one, which is what draws a branch.

A rebased history has no merge commit, so it has nothing to draw and it shows as one column.
That is the repository saying what it is, not the tool giving up.

The backend listens on `127.0.0.1` only, and the list of repositories you have opened is kept
in `%APPDATA%\gitlanes\repos.json`.
