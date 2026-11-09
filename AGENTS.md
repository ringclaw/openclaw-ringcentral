# Agent notes — fork workflow

This repo is a **fork** of `ringclaw/openclaw-ringcentral` used for local secondary development. OpenClaw may load this checkout for daily use.

Cursor convention: prefer this file as `AGENTS.md` (project agent instructions).

## Default workflow

For any **new feature** or **bug fix**:

1. **Branch from up-to-date `main`**
   - `git fetch origin` (upstream) and update local `main` first when needed
   - `git checkout -b feat/…` or `fix/…` from `main`
2. **Develop and test on the branch**
3. **Merge the branch into your own `main`** so daily use / OpenClaw picks up the change
4. **Verify on `main`** (build / restart gateway / smoke as needed)
5. **Open a PR** from the feature branch on this fork → upstream `ringclaw/openclaw-ringcentral` `main`

Do **not** pile unrelated long-lived work only on a feature branch while claiming “production” runs elsewhere — keep **your fork `main`** as the runnable integration branch.

## Syncing upstream (upgrade) into fork `main`

When upstream has new commits and your PR is **not** merged yet, but your features are **already merged into your fork `main`**:

```bash
git checkout main
git fetch origin          # upstream remote (danbao / ringclaw clone)
git merge origin/main     # keep your commits; resolve conflicts if any
git push fork main        # publish your fork main
```

This is a **merge** (or rebase), **not** an overwrite. Commits already on your fork `main` are retained.

Avoid:

```bash
git reset --hard origin/main   # discards local-only features on main
```

You do **not** need to re-merge every feature branch after each upstream sync, as long as those features already landed on your fork `main`.

## Feature branches and PRs

- Keep the feature branch until the **upstream PR is merged** (so you can push review fixes to the same PR head).
- After upstream merge: you can delete the remote/local feature branch; future upgrades come from `origin/main`.
- If a feature is still only on a branch (not on your fork `main`) and you sync upstream, merge/rebase **that branch** (or merge it into your `main` first) so daily use does not lose it.

## Remotes (this clone)

- `origin` — upstream (`danbao` / project upstream)
- `fork` — your GitHub fork (`ee01/openclaw-ringcentral`)

Confirm with `git remote -v` if unsure.
