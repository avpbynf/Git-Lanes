<!--
The template for the ONE pull request that targets `main`. Open it with

    gh pr create --base main --head dev --template release.md

or by adding `?template=release.md` to the compare URL. Every other pull request targets `dev` and
uses the default template, which asks what a batch changes; this one asks nothing of the sort,
because a release changes nothing. Everything in it has already entered `dev` through a pull
request of its own.

**DO NOT PRESS A MERGE BUTTON ON THIS ONE.** The rebase button rewrites, and `main` is already an
ancestor of `dev`, so replaying `dev` onto it hands `main` a second copy of every commit under a
fresh hash. What merges this is a fast-forward from a terminal,

    git push origin origin/dev:main

and the pull request closes itself as merged once its commits are on `main`. The tag goes on after
that and never before it, because the tag is what publishes.
-->

## What this publishes

<!--
One paragraph, for somebody reading the release later and not for the reviewer: what they get that
they did not have. Not a commit list, the changelog already is one.
-->

## The version

- Tag: `v`
- `version` in `src-tauri/Cargo.toml`:
- The changelog section is named after it, and `Unreleased` is gone or empty.

<!--
The tag and that line are one number written twice, and `release.yml` compares them before it
uploads anything. A disagreement stops the run, which is the one mistake that would otherwise ship
an installer under a version nothing inside it agrees with. The bar prints that same number.
-->

## What the release carries that no changelog entry names

<!--
The question this template exists for. Read `git log origin/main..origin/dev` against the section
you just named, batch by batch. A batch that changed what somebody sees and left no line here
ships mute. "Nothing" is the answer you want, and it is worth having checked.
-->

## What proves it

<!--
- The three gates green on `dev` at the commit being tagged, not on a branch before it.
- What was driven in the built window since the last release, and on which repository. The action
  runner, the folder picker and the diff opener exist nowhere else.
- Say plainly what has NOT been looked at. A pre-release is allowed to carry that; a silent one is
  not.
-->

---

- [ ] `main` is an ancestor of `dev`, so this merges by fast-forward.
- [ ] The three gates green locally on the commit being tagged.
- [ ] The changelog section is named after the tag, and the range was read against it.
- [ ] Merged by fast-forward from a terminal, and by no button.
- [ ] The tag is pushed only once its commits are on `main`, because the tag is what publishes.
