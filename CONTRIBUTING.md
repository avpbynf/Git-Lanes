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

**The history is linear and carries no merge commit.** A topic branch is rebased onto `dev` and
enters by a pull request merged with the rebase button. If that button refuses, the rebase was not
done, and the answer is to rebase rather than to merge.

## Commits

A subject in lower case, prefixed by the piece it touches, saying what the change does rather than
what was wrong:

    feat(web): the arrows walk the graph
    fix(app): a lane takes a colour no live lane carries
    fix(server): read the log whole
    docs: the readme catches up with what the page does
    ci: an installer on every tag
    release: 0.2.0

The pieces are `web` for the front end, `app` for the Rust window, `server` for the Python
backend, and no piece at all for a change that spans them. The types are `feat`, `fix`, `docs`,
`ci` for what runs on a runner, `chore` for the plumbing of the repository itself, and `release`
for the one commit that carries a version.

A body when the why is not obvious from the diff, wrapped at seventy odd columns, saying why
rather than restating the diff.

**A feature that lands in both backends is two commits, `server` first and `app` after.** They
answer the same shapes, and the history shows the pair every time.

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

On `dev`, in one commit:

1. Bump that version line.
2. Rename `## Unreleased` in CHANGELOG.md to the new version.

Then, once `dev` is green:

    git push origin origin/dev:main      a fast-forward, never a merge button
    git tag v0.2.0 main
    git push origin v0.2.0

The tag is what publishes. The release workflow refuses a tag that disagrees with the manifest or
a version CHANGELOG.md has no entry for, builds the page, derives the icons, bundles the
installer, and creates the release with that installer attached and the changelog entry as its
body. A version carrying `-alpha` or `-beta` is marked as a pre-release by the version itself.

## Encoding and text

Everything is UTF-8 without a byte order mark, and every line ends with LF, in the repository and
in the working tree alike. On Windows, `Set-Content` and `Out-File -Encoding utf8` both write a
BOM: use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` for anything here.

Prose uses plain ASCII punctuation, and no dash between two spaces.
