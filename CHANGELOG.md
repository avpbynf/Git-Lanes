# Changelog

What each version changed, written for somebody who runs GitLanes rather than builds it. Why a
change was made is in the commit that made it.

A version number here, the tag that releases it and the number the bar prints are one number: the
release workflow refuses a tag that disagrees with the version in `src-tauri/Cargo.toml` rather
than publishing an installer named after one thing and built from another.

Nothing here promises what the next version holds, and nothing under `1.0.0` promises to hold
still.

## Unreleased

- **The drawing has a column of its own, and scrolls inside it.** A history wide enough pushed the
  author and the date off the side, and reading a name meant scrolling right and losing the graph
  to do it. The drawing now takes the room its column is given, scrolls sideways from the strip
  above it when it needs more, and the rows beside it hold still.

- **The path a commit came by is lit on a click rather than under the pointer**, which is what it
  should have been: a graph that recolours itself as the pointer crosses it is a graph nobody
  asked to move. The other two ways are still in the menu.

- **A project says which branches its work lands on.** `merged` was measured against `dev`,
  `main`, `master` and `trunk`, and a repository whose trunk is called anything else was told
  nothing, silently. Those four are still what happens by default, and a project that says
  otherwise writes `trunks` beside its commands.

- **The columns drag.** A strip above the rows names them and the line between two of them is what
  it is dragged by, so the author, the date and the gutter of days take the width you want rather
  than the width their longest value asks for. Letting a grip go twice hands the measurement back.

- **The output of an action belongs to the commit it was started on.** It used to stay on screen
  whichever commit was clicked next, which read as though the new one had just been built.

- **A command is given to the bash git brings with it**, so `&&`, quotes and pipes behave, and the
  paths handed to it are spelled the way that shell spells them. Never the `bash` on the PATH,
  which on Windows is as likely to be WSL's launcher and would run the build inside another
  machine's file system. The output is drawn in a monospaced face, since what a command writes is
  written for a terminal.

- **Your own commands, on the commit you clicked.** A project's actions live in
  `%APPDATA%\gitlanes\actions.json` and show up as buttons in the panel on the right: a build, a
  deployment to a test instance, anything a command line can do. Each one runs in a worktree made
  for that commit and removed afterwards, so the state being built is never the one you have open,
  and the output arrives line by line while it runs. The window only, and never the Python
  backend, which answers on a port any page in any browser can post to.

- **The path a commit came by is lit whole, and only when you want it.** It used to light the run
  of lane the commit sits in, which stopped at the elbow: a branch of a single commit lit that one
  segment and nothing of where it came from. It now follows the first parents down to the root and
  the line that carried on upwards, so the whole way through is drawn. And the menu decides when it
  happens at all: under the pointer as before, on a click, which holds it until another commit is
  clicked, or never.

## 0.1.0

The first release, and an installer for it.

- **The commit graph of a local repository, drawn the way IntelliJ draws it.** One column per
  branch, an elbow where a branch opens and where it merges, dates down the left margin, and
  branch and tag labels on the commits that carry them. The whole history is read at once, so
  scrolling asks for nothing.

- **A tree of what the repository holds**, on the left: the projects already opened, then the
  local branches, the remote ones and the tags, each name filed under the folders it already
  spells. A branch says how far ahead and behind it stands and whether it was ever pushed.
  Clicking a ref goes to its tip, or bounds the graph to it when the menu says so.

- **Two ways of narrowing, on purpose.** The text field dims what does not match, so the shape of
  the graph stays readable while the eye looks for one commit in it; the author, the date and the
  paths are given to git, which does not return what it leaves out.

- **The commit last clicked**, on the right, with its message and the files it touched. The
  arrows walk from one commit to the next, the graph rings the one being read, and the row under
  the pointer lights the branch it belongs to.

- **What is not committed yet has a row of its own**, above the commit it was started from, drawn
  with a dashed dot and a dashed line down to it because it is not history yet. It says how many
  files are staged, changed and untracked, and when they were last touched; clicking it lists
  them, as clicking a commit lists its files. Every worktree of the repository gets one on its own
  branch, so the work left half done in a folder nobody has open any more is visible from here.

- **A branch a trunk already holds says so.** A branch whose commits are all in `dev` or `main`
  carries a `merged` tag beside its name on its last commit, whether the trunk holds those very
  commits or the same changes replayed under other hashes by a rebase or a cherry-pick. Git says
  nothing about the second, which is what makes a branch finished with months ago go on reading
  as work still waiting.

- **A change that was replayed lights both of its copies.** Clicking either one rings the pair,
  the one clicked solid and its twin dashed, so two rows carrying one piece of work read as one
  piece of work rather than two.

- **It never writes to a repository** and holds no lock, so it is safe to leave open while you
  work. The page redraws when a ref moves and not on a timer, and a hidden tab asks nothing at
  all.

- **A window and a page, answering alike.** The installer carries the desktop window, which reads
  git in Rust and needs nothing else installed. The same page runs in a browser over the Python
  backend, which imports nothing outside the standard library.
