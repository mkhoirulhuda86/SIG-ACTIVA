# Update Cycle SAP — Working & Push Policy

## Purpose

SIG ACTIVA is connected to Vercel preview builds. Remote branch updates therefore consume project build quota and must be treated as a controlled resource.

## Required working pattern

For every Cycle task, including Codex parallel lanes:

```text
inspect/read
→ implement the whole assigned scope locally/in the working session
→ run applicable unit tests
→ run lint/build when the task scope requires it
→ review the complete diff
→ commit the coherent task package
→ push once
```

Do not use this pattern:

```text
edit one file → push
fix one typo → push
add one test → push
small refactor → push
```

## Parallel lane rule

Lanes A, B and C may work concurrently because their file ownership is separated. Each lane should normally make only one remote push when its assigned task is complete and checks have been run.

If a lane discovers a contract defect owned by foundation or another lane:

1. document the exact blocker;
2. continue all work that does not depend on that change;
3. do not push a speculative cross-lane fix;
4. coordinate the contract change in one consolidated integration update.

## Branch rule

Do not create extra remote branches for temporary experiments. Work locally where possible. A remote branch exists to hold a reviewable coherent work package, not each development step.

## Exceptions

An intermediate remote push is acceptable only when it is genuinely required to unblock a dependent remote task or to obtain a remote-only CI result that cannot be obtained otherwise. Such pushes should remain exceptional and explicitly documented.

## Vercel implication

A successful preview build is useful evidence, but repeated preview builds for tiny changes are not a substitute for local/unit validation. Prefer one meaningful preview build per completed work package.