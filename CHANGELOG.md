# Changelog

What each version changed, written for somebody who runs Git Lanes rather than builds it. Why a
change was made is in the commit that made it.

A version number here, the tag that releases it and the number the bar prints are one number: the
release workflow refuses a tag that disagrees with the version in `src-tauri/Cargo.toml` rather
than publishing an installer named after one thing and built from another.

Nothing here promises what the next version holds, and nothing under `1.0.0` promises to hold
still.

## Unreleased

- **The labels on a row are read in one order**, whatever order git handed them over in: the tag
  first, then your own branches, then their copies on a remote. Two rows carrying a branch and
  its remote copy used to print them one way round on one and the other way round on the row
  above.

- **A remote branch drops the `origin/` in front of its name**, which the colour of the label was
  already saying. What the label stands for is spelled out under the cursor, `origin/dev` against
  `local/dev`, for whoever does not yet read the colours. A repository with two remotes keeps the
  prefix on all of them, since there the colour says `a remote` rather than which.

- **Both columns open at their narrowest, and stay where you put them.** What a column opened at
  was a guess about your screen and your reading, made before either was known. The window opens
  for the graph now, and a column widened by hand is remembered, so the guess is made once and
  never against you.

- **The projects drawer stops counting itself.** A count earns its place on a drawer that holds a
  hundred branches and is shut; on a list of three you can see, it says what you already read.

- **The way into a folder is a `+` beside the word projects**, rather than a line under the last
  one. It was the one thing in that drawer that moved every time a project was added, and it
  belongs to the drawer rather than to the list: it stays there with the drawer folded shut. An
  empty list asks for a folder in its own words instead of reporting that it is empty.

- **The projects are put in the order you want them in**, by taking a row and dropping it where
  it belongs. The list has always been most recently opened first, which is an order nobody
  chose; a new project still lands on top, and everything else stays where you left it. Nothing
  is added to the row to say so: it moves under the hand, and that is the saying. A list being
  hunted holds still, since an order set on the rows a search left is an order set on a list
  nobody has.

- **A row draws the labels it can draw whole, and counts the rest.** A release commit carries
  its tag, its branch, the remote copy of that branch and the remote's own HEAD, and all four
  used to give up their heads at once: `...v`, `...1-beta`, `...in/main`, five labels nobody
  could tell apart. What does not fit is a `+3` now, which names the missing ones under the
  cursor, and the subject keeps a floor of its own rather than being the only thing that gives
  way.

- **Clicking a commit lights every branch standing on it** in the tree, rather than the first of
  them. Where the row has no space to say which four refs it carries, the column beside it does.

- **The line between two columns is drawn in the strip that names them.** The columns have always
  been draggable from there and nothing said so, since a rule down every row would turn a graph
  into a table. It is drawn in the strip alone, faint until the pointer finds it.

- **The history's last column stops saying `ago`.** A column of durations under a heading that
  says when reads as a duration without the word, and those four characters were on every row.
  Where a sentence needs the word rather than a column, it still has it.

- **The panel says who, when, which and how much on one line**, centred under the subject: the
  author, how long ago, the hash and the count of what changed. The date is written the way the
  history writes it, with the whole of it under the cursor, the hash copies itself when you click
  it, and the count is the way down to the files it counts.

- **A file's path keeps its last four parts.** What tells two files apart is the end of a path
  rather than the folders they share, and the whole of it is still under the cursor.

- **What a command writes gets a tab of its own**, beside the commit's own facts rather than
  pushed under them. The second tab is named after the command and appears only once one has run;
  `clear` takes it away again.

## 0.4.2

- **The example written on the first open carries an editor.** Opening a commit in your own
  editor is the command every project wants, and it is one line: the worktree the command runs in
  is the commit itself, and it goes when you close the editor. Nothing here knows which editor is
  yours, so the line names one for the shape and asks you to put yours in its place.

## 0.4.1

- **The panel says why a file is not clickable**, under the list, instead of leaving you to
  wonder whether the rows were meant to be. A list of files that opens nothing looks exactly like
  a list nobody thought to make clickable, and the two are worth telling apart.

- **A project's commands sit centred** in the panel rather than against its left edge.

## 0.4.0

- **The name takes a space: Git Lanes.** What changed is what you read, in the window's title, in
  the bar and in the installer. What did not is where your things are kept: the commands, the
  trunks, the line that opens a diff and the list of repositories you have opened all stay in
  `%APPDATA%\gitlanes\`, and so do your settings and the widths you dragged, so this version finds
  everything the last one left.

  It does land beside the old one rather than over it, since the installer is named after the
  product and so is the folder it installs into. Uninstall `GitLanes` once and nothing of yours
  goes with it.

- **`merged` is said once on a row.** Two branches left on the same commit, which is what a pair
  of topic branches becomes once both have landed, each printed the word for themselves: the row
  read `perf/warmup merged feat/scale merged`. The badge answers of the commit rather than of the
  label, and two branches on one commit are given the same answer by construction, so the second
  one was the first repeated word for word.

## 0.3.0

- **A file in the panel opens its diff where you read diffs.** Both sides of it are written out
  under the name they carry in the repository, and handed to a line you write once in the same
  file the commands live in: `zed --diff`, `code --diff`, whatever takes two files. Nothing is
  chosen for you, and until that line is written no file is clickable. A line naming something
  the machine does not have is said out loud rather than swallowed. On the row of uncommitted
  work the right-hand side is the file itself, so what you read is what you can fix.

- **What a command writes no longer pushes the commit out of the way.** The output was between
  the buttons and the facts, so a build running meant the hash, the author, the date and the
  files went below the fold. It is last now.

- **A commit says what it totals**, how many files and the sum of the lines added and removed,
  the way the row of uncommitted work has always said its counts. The author's address moved to
  the hover of their name, which puts the date back on the same line.

- **The commit panel is a column from the first open**, at the width the other side opens at,
  rather than something a click has to fetch. The mode a click opens is still in the menu for
  whoever wants the graph to have the whole window, and so is turning the panel off.

- **The way into the file of actions is a pencil in the panel's header**, beside the cross, rather
  than a button among the commands themselves. It is there whether a project has written commands
  or not, which is what it was for in the first place.

## 0.2.1

- **Saving the file of actions is enough for the list to hold them.** A command added or renamed
  in it stayed unread until the window was reloaded by hand, and so did a change to the branches
  a project's work lands on. The file is now watched the way the repository is, so an edit lands
  within a couple of seconds of being saved.

## 0.2.0

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
