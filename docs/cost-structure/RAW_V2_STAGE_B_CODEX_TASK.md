# Stage B / PR V2-01 — Isolated Raw SAP Cost Structure Engine Skeleton

Canonical repository: `mkhoirulhuda86/SIG-ACTIVA`

Mandatory source of truth: `docs/cost-structure/RAW_SAP_INPUT_CONTRACT_ENGINE1_V2.md`

This document captures the implementation scope for the isolated Raw V2 skeleton. It intentionally excludes actual raw parsing, financial calculation, generated Rincian/SI/GHoPO/DERIV, and export.

## Locked principles

- Existing Cost Structure Engine 1 remains operational and must not be behaviorally changed.
- Raw V2 UI may be labeled `Engine 1 V2 – Raw SAP`, but persisted ruleset IDs must remain distinct:
  - Company 2000: `ENGINE1_2000_RAW_V3`
  - Company 7000: `ENGINE1_7000_RAW_V3`
- Raw V2 mutable workflow state must be isolated from legacy `CostPeriod`, `CostUpload`, `CostCalculationRun`, and `CostPeriod.activeCalculationRunId`.
- Stage B capabilities stay disabled: upload, calculation, export.
- Migration must be additive only and must not be applied to production as part of Stage B.
- No private SAP raw workbook may be committed.

## Expected namespaces

- UI: `app/cost-structure/raw-v2/`
- API: `app/api/cost-structure/raw-v2/`
- Library: `lib/cost-structure/raw-v2/`

## Persistence skeleton

Dedicated Raw V2 models should cover period/workspace, upload, source row, validation issue, and calculation run. Existing master/reference data may later be reused, but no legacy workflow state may be reused as Raw V2 mutable state.

## Acceptance

- Raw V2 routes exist and inherit Cost Structure authorization.
- Raw V2 status endpoint is read-only.
- Stage B capability flags are disabled from one canonical definition.
- Raw V2 ruleset IDs are distinct from legacy ruleset IDs.
- Persistence is isolated under `cost_raw_v2_*` tables.
- Existing parser/calculation/export/upload behavior is untouched.
- Tests cover capability state, ruleset identity, navigation matching, and persistence isolation.
- Prisma validate/generate, tests, lint/typecheck/build are run and results are reported.
