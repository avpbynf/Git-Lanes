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

Click a commit for its message and the files it touched. The panel that opens is resized by
its left edge, and keeps that width. Escape closes it, then clears the filter. The repository
name on the left opens the picker, which switches between the repositories already opened and
scans a folder for new ones.

The row under the bar narrows the reading, and it does so in two different ways on purpose.
The text field dims what does not match instead of hiding it, so the shape of the graph stays
readable while the eye looks for one commit in it; `/` focuses it, and the two switches beside
it read it as a regular expression and tell upper case from lower. The three controls after it
are given to git, which does not return what it leaves out: the author, how far back to read,
and the paths a commit must have touched.

Next to it sits the branch HEAD is on. Its list holds every local branch: how far ahead and
behind it stands from the base branch, named at the top of the list, and what the remote knows
of it. A branch nobody has pushed says so, and so does one whose remote branch has since been
deleted. Clicking one scrolls the graph to its tip and opens it.

The graph reads four hundred commits and reads four hundred more each time the scrolling
reaches its end, so nothing has to be asked for in advance. The cog opens what is worth
choosing: the theme, whether a branch clicked goes to its tip or bounds the graph to it
instead, and whether the commit panel covers the graph or sits beside it for good.

## Building the front end

```
cd web
bun install
bun run build      writes web/dist, which the backend then serves
bun run dev        the same build, rebuilt on every save
```

A fresh clone or worktree builds the page before it can build the window: `web/dist` and the
derived icons are both ignored by git, and the Rust build embeds them. The icons come back with
`cargo tauri icon src-tauri/icons/source.png`.

The bundler is Bun's own, not Vite. Vite 8 bundles through a native rolldown module, and an
application control policy can refuse to load an unsigned native module, which is enough to stop
it dead. Bun needs no such module, and the whole build takes under a tenth of a second.

## What it needs

Git and Python 3 to serve, Bun to build the page. The backend imports nothing outside the
standard library.

## How it reads a repository

It runs `git log`, `git show`, `git rev-list` and `git for-each-ref` and parses their output.
**It never writes to a repository**, and it holds no lock, so it is safe to leave open while
you work.

The lane assignment is the whole trick, and it lives in `build_graph`. A lane holds the hash it
is still waiting for. A commit takes the leftmost lane waiting for it, and the other lanes
waiting for it close there, which is what draws a merge. Its first parent keeps the lane, the
others open one, which is what draws a branch.

A rebased history has no merge commit, so it has nothing to draw and it shows as one column.
That is the repository saying what it is, not the tool giving up.

The backend listens on `127.0.0.1` only, and the list of repositories you have opened is kept
in `%APPDATA%\gitlanes\repos.json`.
