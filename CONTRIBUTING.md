# Contributing

How work enters this repository and how a version leaves it. What the tool is and how to run it is
in the README; how it is built and what has already cost time here is in CLAUDE.md.

## Branches

Two long-lived branches, and the difference between them is one question: has this been released?

- `dev` is where work lands. It stays buildable, and it is what a topic branch is opened from and
  rebased onto.
- `main` is what is out there. Every commit on it has been released under some tag, and nothing
  reaches it except by a fast-forward from `dev` at the moment of a release.

So `main` is always an exact prefix of `dev`, which is what makes the two readable side by side:
whatever `dev` holds beyond `main` is precisely what is written and not yet released. A workflow
says so out loud when it stops being true, because no setting on GitHub can prevent the merge
button that breaks it.

Every other branch is a topic branch, named for what it does:

    <type>/what-the-branch-does

The type is one of the ones a commit subject uses, below, and it is whatever the branch mostly is.
After the slash come two to five words in lower case joined by dashes, saying what the branch does
rather than which file it opens.

    feat/arrows-walk-the-graph
    fix/lane-colour-reuse
    ci/release-on-a-tag

`release/0.5.0` is the one shape that departs from it, and the version is the whole of the name:
such a branch carries the version bump and nothing else, so there is nothing else to say about it.

Nothing in a name records who wrote the branch, when, or which issue it closes. That last is a
choice rather than an absence: the commit that does the work names the issue, and a name carrying
the number would say it in the one place nothing reads it back from.

**The history is linear and carries no merge commit.** A topic branch is rebased onto `dev` and
enters by a pull request merged with the rebase button. If that button refuses, the rebase was not
done, and the answer is to rebase rather than to merge.

**Rebase a topic branch as soon as `dev` moves under it**, and after the rebase read the whole of
`git diff dev..HEAD` rather than only the hunks git marked. Git follows a file that moved; what it
does not follow is code that moved between files, which comes back as a conflict whose two sides
are about different places. And a fact may change on one side while the other side's prose still
describes the old one, far from anything git touched: that compiles, reads well, and is false.
This repository states the same fact in `CLAUDE.md`, in `README.md` and in a comment often enough
for that to be the ordinary case rather than the unlucky one.

### A pull request merges one way

**"Rebase and merge", and neither of the other two buttons.** A merge commit forks a history the
line above says never forks. A squash collapses a branch into one commit and throws away the
bodies, which is where the reasoning for each step lives: a branch is a sequence of logical
changes here rather than a unit of work, and the sequence is the part worth keeping.

None of that is left to memory, and it takes two settings because each lets through what the other
stops. The repository allows the rebase merge alone, so the other two buttons do not exist; and a
ruleset requires a linear history on `main` and `dev`, which refuses a merge commit arriving by a
direct push. **The second does not imply the first**: a squash is linear, so the ruleset would take
it happily, and it is the button setting that rules it out.

**Every batch enters that way, including one written by whoever owns the repository.** Folding a
branch in locally skips the one thing the request is for: `build.yml` runs on `pull_request`, so a
batch that goes in by hand is built only once it is already in `dev`.

## Commits

One logical change per commit, and a subject in the form the wider ecosystem calls a conventional
commit:

    <type>(<scope>)!: what the commit does

That form is worth more here than it is in most repositories, because of how a branch lands. The
rebase button replays every subject verbatim into the public history instead of collapsing them
into the request's title, so a subject is not a note to a reviewer: it is the line somebody reads
two years later, in a log where `git log --oneline` is the only thing they will look at.

| type | what it carries |
| --- | --- |
| `feat` | something the tool did not do |
| `fix` | a defect corrected |
| `perf` | the same behaviour for less |
| `refactor` | no change of behaviour at all, dead code removed included |
| `docs` | the readme, the changelog, this file, a comment on its own |
| `test` | the harness and what it runs over |
| `build` | the toolchain, the dependencies, what the build refuses, the version bump |
| `ci` | `.github/workflows` |
| `chore` | whatever none of the others is |

The scope is the piece it touches: `web` for the front end, `app` for the Rust window, `server`
for the Python backend, and no scope at all for a change that spans them, which `docs` and `ci`
usually do.

    feat(web): the arrows walk the graph
    fix(app): a lane takes a colour no live lane carries
    fix(server): read the log whole
    docs: the readme catches up with what the page does
    build: raise the version to 0.5.0

The subject is imperative and starts on a verb, in lower case, and carries no full stop. The whole
line is 72 columns or fewer with the prefix counted in, and the prefix is not free: `feat(web): `
is eleven of them. A body is for the reason, when the reason is not in the diff, wrapped at
seventy odd columns and separated from the subject by a blank line.

A `!` before the colon marks a change that breaks a setting or a file that used to work. What
breaks is written in the body, and there is no `BREAKING CHANGE:` footer: the changelog is written
by hand and the version typed by a human, so nothing here would read one.

**An issue is closed from the COMMIT that closes it and never from the pull request**, on a line of
its own at the foot of the body:

    Closes #30

A closing keyword fires when the request it is written in merges into the DEFAULT branch, which
here is `main`, and every request here merges into `dev`: written in a request's body it links the
issue and then leaves it open for good. Written on the commit it travels with the commit, and it
lands on `main` the day `dev` does. Check the issue really closed once `dev` has landed.

**A feature that lands in both backends is two commits, `server` first and `app` after.** They
answer the same shapes, and the history shows the pair every time.

**None of this is retroactive.** A subject already in `dev` or `main` is history and stays as it
is: the log holds `release: 0.4.2` and its predecessors, from before the version bump moved under
`build`. Rewriting a public history to tidy the shape of its subjects would cost every reference
anybody holds to it and buy a uniformity nobody reads for.

### Both ends of the rule are one file

`.githooks/commit-msg` refuses a subject or a branch name that is not in the form above. Install it
once per clone, worktrees sharing the same config:

    git config core.hooksPath .githooks

`.github/workflows/commits.yml` runs that same file over every commit of a pull request, for
whoever never ran that command and for anything arriving from a fork. It is deliberately the same
file: a workflow rewriting the same expression would be a second home for the rule, and the two
would agree only until one of them changed.

`.githooks/prepare-commit-msg` sits one step earlier and takes a `Co-authored-by`, `Made-with` or
`Generated-by` line out of the message before it is stored. What the log keeps is the reasoning for
a change, and a trailer naming a tool is not that.

Catch it at the commit rather than at the request. A subject is amended in one gesture while it is
still the last one, and rebuilt by hand once nine commits stand on top of it.

## Labels

Everything carries one, requests and issues alike: a list of a dozen open things has to say what
each one is before any of them is opened.

**A pull request carries the type of its branch, and only that.** Not a second opinion about the
change: the word already in the branch name and at the head of every subject the branch carries. A
branch whose commits are mostly `fix` with a `refactor` among them is labelled `fix`, the same way
its name was settled. **The repository poses it itself**, off the branch name at the moment the
request opens (`.github/workflows/label.yml`), because a label derived rather than decided has no
reason to be asked of anybody, and one that is asked holds only for as long as it is remembered.

That workflow refuses nothing. A branch opening on a word this convention does not know is already
answered by the hook and by `commits.yml` running it.

**A release request carries `release` and no type.** Two carry it: `release/<version>` into `dev`,
which lands the bump, and `dev` into `main`, which records the fast-forward.

**An issue carries what it is about instead**, being a report rather than a change:

| label | what it marks |
| --- | --- |
| `known limitation` | a gap this already knows about, opened here rather than waited for |
| `upstream` | the cause is in git, in a webview or in another project, and nothing here closes it |

beside GitHub's own `bug`, `enhancement` and `question`, which the issue forms set themselves. The
two sets do not overlap and are not meant to: a type says what a change does, and these say what a
report is about.

## Issues

They are opened through the forms in `.github/ISSUE_TEMPLATE`, which is what makes a report
answerable rather than a sentence. What those forms ask beyond the trouble itself is which of the
two backends you were in, and what is peculiar about the repository it happened on: a graph draws
what a repository is, so the number of branches, several worktrees, several remotes and a shallow
clone are each the whole of an answer.

A known gap is opened as an issue rather than living in a file somewhere, so a branch can point at
one and a reader can see that somebody is on it.

## Changelog

Work in progress is written under `## Unreleased` in CHANGELOG.md, in the words of somebody who
runs the tool. At a release that heading is renamed to the version, which is what makes it the
body of the release: the workflow reads the entry under `## <version>` and refuses to publish
without one.

## Before pushing

The three gates, which are the same three the build workflow runs:

    cd web && bun install && bunx oxlint --deny-warnings src
    cd web && bun run build      also the type check, since it runs tsc -b first
    cd src-tauri && cargo check

**And drive the page rather than reading the diff twice.** The Python backend serves what
`web/dist` holds, so a rebuilt page is one reload away:

    py -3 server/gitlanes.py --repo <a repository> --port 7420

A change that looks like front end only still has to compile in Rust. That rule was written the
day a change was merged on the strength of a browser pass alone and did not build.

## Releasing

The version lives in one place, the `version` line of `src-tauri/Cargo.toml`. Rust reads it at
compile time, the Python backend parses that same file, and the installer is named after it.

A version is three numbers, and after them either `-alpha`, or `-beta`, or nothing at all. Those
three are one version reached in order: `0.5.0-alpha`, then `0.5.0-beta`, then `0.5.0`. Nothing
follows the word, and a counter least of all, so `0.5.0-beta.1` is not a version here. What that
costs is the whole of the rule: there is no second beta of a version. A beta that needs a fix is a
new version and the patch number moves, `0.5.1-beta`, which is what a reader of the two numbers
would have assumed anyway. The hook refuses a release branch named otherwise, and the release
workflow refuses such a tag before it builds anything.

One commit, on a branch named `release/<version>` and carrying nothing else, entering `dev` by a
pull request like every other:

1. Bump that version line, under the subject `build: raise the version to <version>`.
2. Rename `## Unreleased` in CHANGELOG.md to the new version.

It is no exception to the rule above, and it could not be one: `dev` requires `build`, and a
commit pushed straight there carries no run of it. What is refused names the check rather than
the rule, so the refusal reads as a broken workflow when it is the workflow working.

Then, once `dev` is green, open a pull request from `dev` to `main`, with the template written for
that one request:

    gh pr create --base main --head dev --template release.md

Not to press anything: it is what makes `main-from-dev` run, and a check from a `pull_request`
workflow lands on the head commit of the request, which is the very commit the fast-forward below
pushes. Without that request, `main` refuses the push for a check that never ran. That template
asks what no command can: whether the range about to be published carries a batch that changed
what somebody sees and left no changelog line.

    git push origin origin/dev:main      a fast-forward, never a merge button
    git tag v0.5.0 origin/main
    git push origin v0.5.0

**Nothing on GitHub can refuse the wrong press**, since the buttons a repository offers are a
repository-wide setting and the rebase button forbidden here is the one every topic branch needs.
So `prefix.yml` checks after the fact, on every push to `main`, that `main` is still contained in
`dev`, and fails within a minute when it is not. Recovering is a reset of `main` back onto `dev`,
and it is cheap for exactly as long as nothing has been built on top.

The request closes itself as merged once its commits are there. The tag is what publishes. The release workflow refuses a tag that disagrees with the manifest or
a version CHANGELOG.md has no entry for, builds the page, derives the icons, bundles the
installer, and creates the release with that installer attached and the changelog entry as its
body. A version carrying `-alpha` or `-beta` is marked as a pre-release by the version itself.

## Encoding and text

Everything is UTF-8 without a byte order mark, and every line ends with LF, in the repository and
in the working tree alike. On Windows, `Set-Content` and `Out-File -Encoding utf8` both write a
BOM: use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` for anything here.

Prose uses plain ASCII punctuation, and no dash between two spaces.
