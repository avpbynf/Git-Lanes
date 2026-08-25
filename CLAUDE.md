# Working on GitLanes

The README says what this tool is and how to run it. This file says how it is built, what
holds it together, and what has already cost time here. Nothing below repeats the README.

## The shape of it

Three pieces, and the first rule follows from there being two of the second:

```
web/        a React front end, bundled by Bun. It never knows which backend answers.
server/     one backend, Python, over HTTP. What a browser talks to.
src-tauri/  the other backend, Rust, in process. What the desktop window talks to.
```

**Both backends answer the same shapes, and a change to one is a change to both.** The front
end picks between them once, in `web/src/api.ts`, by looking for `window.__TAURI__`. Everything
above that file is written as if there were one backend. Break the symmetry and the tool works
in the browser and not in the window, or the reverse, and nothing says so until someone opens
the other one.

The one exception is a thing a browser genuinely cannot do, and `pick_folder` is the only one
so far: there is no native folder dialog in a page. Such a command lives in Rust alone, and
`api.ts` says so out loud with a flag the front end can ask about, the way `canPickFolder`
does, so the page has somewhere else to go rather than a call that fails.

There are no Tauri JS packages. The window is driven through `window.__TAURI__` globals and
commands this repository declares itself, in `src-tauri/src/main.rs`. Adding a Tauri plugin
would mean adding its JS package and its capability file; adding a plain crate and one command
does not. That is why the folder picker is `rfd` in a `pick_folder` command rather than
`tauri-plugin-dialog`.

## Building it

```
cd web && bun install && bun run build     the page, into web/dist
cd src-tauri && cargo build                the window, which embeds web/dist
cargo tauri icon icons/source.png          the icons, once
```

`bun run build` runs `tsc -b` first, so it is also the type check. `bunx oxlint --deny-warnings src`
is the lint, and it must be silent.

**A fresh clone or worktree cannot build the window until the page and the icons exist.** Both
`web/dist` and `src-tauri/icons/*` are ignored by git, and `cargo build` fails on each in turn
with an error that does not name the cause. In a worktree, copying `src-tauri/icons` from the
main checkout is quicker than regenerating them.

`cargo check` from a worktree can borrow the main checkout's build cache with
`CARGO_TARGET_DIR`, which turns minutes into seconds. `cargo build` cannot, or it would write
over the binary the main checkout is running.

## Checking the work

**The Python backend is the fast way to see a change.** It serves `web/dist`, so a rebuilt page
is one reload away, with no Rust involved:

```
py -3 server/gitlanes.py --repo <a repository> --port 7420
```

Drive the page and measure it rather than guessing. Widths, row counts and timings are all
readable from the page, and every layout claim in this repository was settled that way.

**Then check the Rust before merging, always, even when the change looks like front end only.**
That rule was written the day a lot was merged on the strength of a browser pass alone and did
not compile.

A webview that is not on screen keeps running scripts but stops compositing. CSS transitions
then never advance and scroll events are never delivered, so a panel reads as stuck and a
virtualised list as frozen. Neither is a bug. Check `document.hidden` before believing either,
disable the transition to measure a final position, and dispatch a synthetic `scroll` by hand.

## What holds the front end together

**An answer carries the question it answers.** `useGraph`, `CommitPanel` and `Sidebar` all store
what they were asked for beside what they got, and show the answer only if the question still
matches. That is what stops a repository's graph from appearing under another one's name for a
frame. `useGraph` goes further and numbers its reads, so a slow one landing after a newer one is
dropped rather than putting back what it replaced.

**The graph is read whole, once per repository.** Measured on six thousand commits, reading
everything cost eighty milliseconds more than reading four hundred: what a read costs is
spawning git, not walking history. Paging was therefore paying that cost over and over for
nothing, and it is gone. Nothing is fetched while scrolling.

**Nothing reloads on a timer.** A cheap fingerprint of the refs, of HEAD and of the working tree
is polled every two and a half seconds, and the graph is read again only when it moves. A blind
reload would move two megabytes per repository per tick. A hidden tab polls nothing.

**Every row of the graph is a grid of its own**, so the browser cannot line the columns up: an
automatic width would land differently on each row. The author and date columns are therefore
measured in JavaScript, over the loaded commits, with a canvas and the font they are drawn in,
and passed down as `--who` and `--when`. Do not be tempted by `ch`: it answers for the digit
zero of the font the *element* inherits, which is not the font the column is drawn in, and it
was eighteen percent wrong here.

**The text filter dims, the others remove.** Author, date and paths are given to git, which does
not return what it leaves out. The text field stays in the browser and fades what does not match,
because that is what keeps the shape of the graph readable while looking for one commit in it.
Two behaviours, on purpose.

**A scope is a ref spelled in full**: `ref:refs/heads/dev`, `ref:refs/tags/v0.7.5`. Git reads a
tag as a starting point exactly as it reads a branch, so nothing distinguishes them here. The
long spelling is also what tells a tag `dev` from a branch `dev`, and what keeps a ref named
like an option from being read as one. A scope that does not spell `refs/...` is no scope.

**The two side panels are the same thing mirrored.** Both are columns, both are dragged by their
inner edge through `usePanelWidth`, both are turned off in the menu. What the menu holds is what
someone decides once; what a panel header holds is what someone decides while looking at it. The
commit panel has a third state, opened by a click and closed by its cross, and that is the one
the window starts on.

## Traps already paid for

- **`git for-each-ref` shortens `refs/remotes/origin/HEAD` to `origin`**, so filtering remote
  refs by a name ending in `/HEAD` misses it and a bare `origin` appears among the branches.
  Filter on `%(symref)` being non-empty instead, which is what that ref actually is.
- **A grid item with `justify-self: end` and no `min-width: 0` will not go under its content.**
  In a track squeezed to zero it keeps its full width and hangs leftwards, over its neighbour.
  That is what printed ref labels on top of commit subjects.
- **`%(committerdate)` is empty for an annotated tag**, which is an object of its own.
  `%(creatordate)` answers for both kinds, and `%(*objectname)` is the commit an annotated tag
  points at, empty for a lightweight one.
- **PowerShell's `Set-Content` and `Out-File -Encoding utf8` write a BOM.** Use
  `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` for anything this repository reads.

## Writing here

Commit messages are lower case, prefixed by the piece they touch: `feat(web)`, `fix(app)` for
the Rust window, `feat(server)` for Python, `docs` for prose. One line saying what the change
does, not what was wrong. A body when the why is not obvious from the diff, wrapped at seventy
odd columns.

A feature that lands in both backends is two commits, `server` first and `app` after, in the
shape the history already shows.

Comments explain why, never what. Most of this codebase has none, and the ones it has are there
because someone would otherwise undo the reason.

Prose here and in the README uses plain ASCII punctuation and no dash between two spaces.
