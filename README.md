<p align="center">
  <img src="src-tauri/icons/source.png" width="128" alt="">
</p>

<h1 align="center">Git Lanes</h1>

<p align="center">
  The commit graph of a local repository, in a window of its own.
</p>

---

Reading where a branch stands should not cost opening an IDE. Git Lanes draws a history the way
IntelliJ draws it: one column per branch, an elbow where a branch opens and where it merges,
dates down the left margin, and branch and tag labels on the commits that carry them.

**It never writes to a repository.** It runs `git log`, `git show`, `git rev-list` and
`git for-each-ref`, reads what they print, and holds no lock, so it is safe to leave open beside
whatever else you are doing to the same folder.

## Why

Because reading a graph should not cost what an IDE costs. IntelliJ draws this graph better than
anything else does, and opening it to read one for ten seconds means a project indexed and a Java
daemon left running behind whatever you were actually doing. An editor that starts instantly, Zed
among them, answers the other half of the question instead: it shows you the files, and the
history is behind an extension when it is there at all. A forge answers it in a browser, a page
away from the folder you are working in.

So this is the graph and nothing else, and it takes from all three: the lanes and the labels are
IntelliJ's, several things a forge puts on a branch page are here too, and what neither of them
can be without is gone. No indexing, no language server, nothing left running afterwards. The
window is a Rust process of some thirty megabytes drawing in the web view Windows already ships,
what it costs beyond that is what that web view costs, and it opens about as fast as a folder
does.

You watch a repository rather than query it: the graph redraws as branches move, while you work
in the folder it is reading.

## Quick start

Windows: take `Git.Lanes_<version>_x64-setup.exe` from the
[releases](https://github.com/avpbynf/Git-Lanes/releases), run it, and open the window it installs.
It carries what it needs: the window reads git in Rust, so nothing has to be installed beside git
itself.

Then open a folder. `+ open a folder` at the top of the tree on the left takes a repository, and
takes a folder holding several just as well, offering what it finds under it. The projects opened
stay in that tree, and the one being read is the one lit.

## What it shows

**The graph, in the middle.** The whole history at once, so scrolling asks for nothing further.
The commit being read is ringed, the arrows walk from one commit to the next, and a click opens
its message and the files it touched.

**The columns are named in a strip above the rows**, and the line between two of them drags: the
dates on the left, the drawing itself, the author and the date on the right take whatever width
you give them, and the subject keeps what is left. Two of those are measured on what is loaded
rather than guessed, and a grip let go of twice hands that measurement back.

**A drawing wider than the room it was given scrolls inside it**, from the strip above it, and
nothing else moves: a history a hundred branches wide used to push the author and the date off
the side, so reading a name meant scrolling right and losing the graph to do it.

**The path a commit came by** lights while the rest of the wires step back: down its first
parents to the root, crossing the elbow where its branch left the trunk, and up the line that
carried on from it. The menu says when, since it is a matter of taste: on a click, which is how it starts and holds
it still until another commit is clicked, under the pointer, or never at all.

**The tree, on the left.** The projects, then the local branches, the remote ones and the tags,
each name filed under the folders it already spells, so `feat/custom-images` sits under `feat`. A
branch says how far ahead and behind it stands and whether it was ever pushed. One field at the
top hunts through all of it. Clicking a ref goes to its tip, or bounds the graph to it when the
menu says so, a tag as readily as a branch.

**What is not committed yet**, above the commit it was started from, drawn with a dashed dot
because it is not history yet: how many files are staged, changed and untracked, and when they
were last touched. Every worktree of the repository gets its own, on its own branch, so work left
in a folder nobody has open any more is visible from here.

**A branch a trunk already holds says so**, with a `merged` tag beside its name, whether the
trunk holds its very commits or the same changes replayed under other hashes by a rebase or a
cherry-pick. Git says nothing about the second, which is what makes a branch finished with months
ago read as work still waiting. Clicking either copy of a replayed change rings both.

The trunks are `dev`, `main`, `master` and `trunk` until a project says otherwise, which it does
in the same file its commands live in, below.

**Two ways of narrowing**, in the row above the graph, and the difference is on purpose. The text
field dims what does not match, so the shape of the graph stays readable while the eye looks for
one commit in it; `/` focuses it, and the two switches beside it read it as a regular expression
and tell upper case from lower. The author, the date and the paths after it are given to git,
which does not return what it leaves out.

**The commit last clicked, on the right.** Either side column can be dragged by its inner edge or
turned off in the menu, where the theme and what a click on a ref does also live. Escape clears
the commit, then the filter.

## Your own commands

A project usually has one thing you want done to a version of it, and it is never the same thing
twice: a mod built and dropped into a test instance, an application bundled from a branch, a
script run against the state of one commit. So the tool holds none of that and runs yours instead.

Commands live in `%APPDATA%\gitlanes\actions.json`, one list per repository, and the panel on the
right shows them as buttons on whatever commit is open. The pencil in that panel's header opens
that file, writing an example in it the first time.

One of the two lines that example carries is an editor on the commit itself, which is the command
every project wants and the one nothing here can write for you, since the tool knows no editor.
Name yours in it. The folder it opens is the worktree made for that commit, and it goes when you
close the editor.

```json
{
  "C:\\Users\\you\\code\\your-mod": [
    {
      "name": "build and drop in the test instance",
      "run": "gradlew.bat build && copy build\\libs\\*.jar C:\\mc\\test\\mods\\"
    }
  ]
}
```

A project with more to say than its commands writes an object instead of that list, and the two
are read alike, so a file written before there was anything else to say stays as it is:

```json
{
  "C:\\Users\\you\\code\\your-app": {
    "trunks": ["develop", "release"],
    "actions": [{ "name": "bundle it", "run": "cargo tauri build" }]
  }
}
```

`trunks` is what a `merged` tag is measured against: the branches this project's work lands on,
whatever they are called here.

**A command runs on the commit you clicked, in a worktree made for it and removed afterwards.**
That is the whole reason this is worth having: building the state of a commit that is not the one
checked out would otherwise mean checking it out, and that disturbs the work the window is open
beside. `{worktree}` is that folder, and `{repo}`, `{sha}`, `{short}` and `{ref}` are there too;
`cwd` says where to run, the worktree by default. The output belongs to the commit it was started
on and is shown there and nowhere else, line by line while it runs, and `stop` kills the command
and everything it started.

The line is given to the bash git itself brings, so `&&`, quotes and pipes mean what they mean
everywhere else, and the paths above are spelled the way that shell spells them, `/c/Users/...`
rather than `C:\Users\...`. It is found from `git --exec-path` and never from the name `bash` on
the PATH, which on Windows is as likely to be WSL's launcher, where a build would run in another
machine's file system entirely. Without it the line goes to `cmd` instead.

The file is yours and lives beside the list of repositories, never in a repository: a project you
cloned cannot bring its own commands with it. And a command runs in the window only, never through
the Python backend, which answers on a port any page in any browser can post to.

## Your own editor, on a file of a commit

Click a file in the panel and its two sides open where you read diffs. Which is a line in that
same file, written once for every project since an editor is nobody's project:

```json
{
  "diff": "zed --diff \"{old}\" \"{new}\"",
  "C:\\Users\\you\\code\\your-app": { "actions": [] }
}
```

`{old}` and `{new}` are the file before the commit and after it, written under a folder of their
own with the name they carry in the repository, so your editor colours them as what they are.
`{path}`, `{sha}` and `{repo}` are there too. Quote them: a temporary folder can hold a space.

Anything that takes two files works, which is the reason nothing is chosen for you:
`code --diff "{old}" "{new}"` for VS Code, `idea diff "{old}" "{new}"` for IntelliJ. Write no line
and no file is clickable, since a row that lights up under the pointer and then opens nothing is
worse than a row that never offered. Write a line naming something this machine does not have and
the panel says so, in the place a command's own trouble is said: the shell starts whatever the
line names, and what it says when it cannot find it is worth reading rather than swallowing.

On the row of uncommitted work the left side is HEAD and the right side is the file itself rather
than a copy, so what you are reading is what you can fix.

## How it reads a repository

The lane assignment is the whole trick, and it lives in `build_graph`. A lane holds the hash it is
still waiting for. A commit takes the leftmost lane waiting for it, and the other lanes waiting
for it close there, which is what draws a merge. Its first parent keeps the lane, the others open
one, which is what draws a branch.

A rebased history has no merge commit, so it has nothing to draw and it shows as one column. That
is the repository saying what it is, not the tool giving up.

A shallow clone holds no parent for the commits it was cut at, and those carry a dashed `shallow`
label rather than passing for the root of the history.

Nothing redraws on a timer. A cheap fingerprint of the refs, of HEAD and of the working tree is
asked for every two and a half seconds, the history is read again only when that moves, and a
window nobody is looking at asks nothing at all. The list of repositories you have opened is kept
in `%APPDATA%\gitlanes\repos.json`.

## Building it

Two pieces build, and the first is an input to the second:

```
cd web && bun install && bun run build      the page, into web/dist
cd src-tauri && cargo tauri build           the window, and its installer
```

`bun run build` runs `tsc -b` first, so it is also the type check, and `bunx oxlint src` is the
lint. A fresh clone cannot build the window until the page and the icons exist, both being derived
and neither being in git; the icons come back with `cargo tauri icon src-tauri/icons/source.png`.

There is a second backend, in Python, and it is the fast way to see a change: it serves the same
page over HTTP with no Rust involved, so a rebuilt page is one reload away.

```
.\gitlanes.ps1                     the repository in the current folder
.\gitlanes.ps1 -Repo C:\code\foo   any other one
```

It listens on `127.0.0.1` only and imports nothing outside the standard library. Both backends
answer the same shapes, so the page cannot tell which one it is talking to, and a change to one is
a change to both.

The bundler is Bun's own, not Vite. Vite 8 bundles through a native rolldown module, and an
application control policy can refuse to load an unsigned native module, which is enough to stop
it dead. Bun needs no such module, and the whole build takes under a tenth of a second.

## Read more

| If you want to | Read |
| --- | --- |
| See what changed from one version to the next | [CHANGELOG.md](CHANGELOG.md) |
| Know how work enters this repository and how a version leaves it | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Understand how it is built, and what has already cost time here | [CLAUDE.md](CLAUDE.md) |
