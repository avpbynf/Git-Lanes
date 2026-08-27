<!--
Merge with "Rebase and merge" and with nothing else. The other two buttons write a commit this
history does not carry: "Create a merge commit" forks the tree, "Squash and merge" throws away the
per-commit reasoning the bodies hold. If the rebase button is greyed out, this branch is behind
`dev`; rebase it locally and force-push rather than merging `dev` into it.
-->

## What changes

<!-- One paragraph. What the branch does to the tool, not how the diff is arranged. -->

## What the other backend answers

<!--
Both backends answer the same shapes, and a change to one is a change to both. Break the symmetry
and the tool works in the browser and not in the window, or the reverse, and nothing says so until
somebody opens the other one.

So: "nothing, this is the page alone", or which command and which route now answer alike. The two
exceptions are the ones CONTRIBUTING names, `pick_folder` and the action runner, and a third one
owes the reason it is a third.
-->

## What proves it

<!--
Say which of these the claim rests on. An unticked line is not a failure, it is a scope.

- The three gates, and which of them was run after the last change rather than before it.
- What was driven in the page rather than read in the diff: what was measured, and what it read.
- What was checked in the built window, which is the only place the action runner and the folder
  picker exist at all.
-->

## What it leaves owing

<!-- Known gaps, anything a later branch has to finish. Or "nothing". -->

---

- [ ] Rebased onto `dev`, so the merge is a fast-forward.
- [ ] `bunx oxlint --deny-warnings src` silent, `bun run build` green, `cargo check` green, after
      the rebase and not before it.
- [ ] The page was driven and measured, not read twice. A change that looks like front end only
      still has to compile in Rust.
- [ ] `CHANGELOG.md` carries an entry under `Unreleased`, or this changes nothing somebody running
      the tool would see.
- [ ] Every place that states a fact this branch changed now states the new one: `CLAUDE.md`,
      `README.md`, `CONTRIBUTING.md`, and the comments that gave a reason for what moved.
