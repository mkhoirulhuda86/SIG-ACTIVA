# Codex Task — Raw V2 Stage F Operational Readiness (Company 2000)

Implement Stage F exactly from:

```text
docs/cost-structure/RAW_V2_STAGE_F_OPERATIONAL_READINESS.md
```

Treat that document as the authoritative contract.

## Repository / branch

Repository:

```text
mkhoirulhuda86/SIG-ACTIVA
```

Work on the existing branch:

```text
feat/raw-v2-stage-f-operational-readiness
```

Base is latest `main`.

Do not merge the PR.

## Current validated production state

Company 2000 Stage E is already validated in production using:

```text
ENGINE1_2000_RAW_V3
```

The current validated 2026/08 acceptance evidence is:

```text
active upload 2
active Stage E run 5
SUCCESS / active
238 analytical rows
18 result rows
12 controls / 12 PASS

ADUM       147,739,449,743
PASAR       12,090,077,772
Company SI 159,829,527,515

Rincian ADUM Delta       +3,802
DERIV raw          3,460,258,896
DERIV INCLUDE      3,448,504,987
DERIV EXCLUDE         11,753,909
DERIV SI offset    -3,448,504,987
```

Per-Nature parity against active legacy `ENGINE1_2000_V2` is 15/15 exact with absolute difference zero.

These numbers are acceptance evidence only. Never hard-code them into runtime code.

## Important prior production incident

A prior Stage E run incorrectly produced SUCCESS with zero values because the Stage E service queried `coaCodeResolved` even though Stage C authoritative parsed COA values are stored in `coaCodeRaw` and `coaCodeResolved` is still null.

This has already been hotfixed on `main`:

- Stage E reads authoritative `coaCodeRaw`;
- Stage E has a source population-count fail-closed guard;
- the invalid zero-value run remains in history as FAILED/inactive.

Do not regress this behavior.

Stage F run history must show such failed/inactive/invalidated history, but never present it as current operational truth.

## Primary objective

Build an operational Company 2000 reporting workspace on top of persisted Raw V2 Stage D/E data.

Stage F must not change financial calculation semantics.

Implement:

1. coherent server-side reporting read model scoped to active upload + active Stage E SUCCESS;
2. finance-friendly operational dashboard and workflow state;
3. mapping coverage and control diagnostics;
4. Nature breakdown;
5. searchable/filterable analytical lineage drill-down;
6. selected-period Raw V2 run history;
7. server-side Excel export with fail-closed eligibility;
8. capability phase transition to `F_OPERATIONAL_READINESS` and `exportEnabled=true` only when export is fully wired and protected.

## Recommended API shape

Use isolated routes under Raw V2 namespace, for example:

```text
GET /api/cost-structure/raw-v2/report?fiscalYear=YYYY&fiscalPeriod=P
GET /api/cost-structure/raw-v2/report/export?fiscalYear=YYYY&fiscalPeriod=P
```

READ permission is required for both.

Do not require the client to join different Stage D/E/run/upload payloads itself.

The read model must prevent stale or superseded-upload SI from appearing as current truth.

## Operational selection rule

For the selected Company 2000 period:

```text
active Raw V2 upload
-> Stage D evidence for the same active upload
-> active Stage E SUCCESS for the same active upload
```

Current operational result must be an active Stage E SUCCESS for the current active upload.

Historical failed/inactive runs belong only to history/diagnostics.

## Dashboard

Refactor/extend the Raw V2 workspace into a finance-friendly monthly operational view.

Include:

- Company/year/period selector;
- upload version/status;
- period status and ruleset;
- workflow stepper:
  - Upload & Validation
  - Reconciliation
  - Mapped Cost Structure / SI
  - Result & Export
  - Run History
- final ADUM/PASAR/Company SI cards;
- Stage D difference and explicit Rincian correction;
- DERIV raw/include/exclude/offset;
- mapping coverage by CC_ADUM, CC_PASAR, RINCIAN_ADUM_DELTA, CC_DERIV;
- Nature breakdown grouped by ADUM/PASAR;
- blocking/diagnostic controls;
- analytical lineage table with filters/search;
- run history;
- Export Excel action only when export eligible.

Keep internal stage codes as secondary audit metadata rather than the primary finance-user labels.

## Analytical lineage

Expose at minimum:

- source logical code;
- sheet;
- source row;
- COA;
- description;
- raw amount;
- signed mapped contribution;
- analytical class;
- mapping status/action;
- Cost Group;
- Nature;
- rule code;
- mapping id/effective date;
- readable reference JSON.

Filters/search at minimum:

```text
COA / description text
source
Cost Group
Nature
mapping status/action
analytical class
```

Do not aggregate new authoritative financial totals in React.

## Excel export

Use server-side persisted results. `exceljs` is already installed and may be used.

Required sheets:

```text
Summary
Nature
Mapping Coverage
Controls
Analytical Lineage
Run History
```

Export eligibility is strict:

- active upload exists;
- active Stage E SUCCESS exists for that same upload;
- ruleset is ENGINE1_2000_RAW_V3;
- all persisted Stage E controls PASS;
- company and group results present;
- analytical population > 0;
- Nature population > 0.

Any failure must return a clear non-200 response and no workbook.

Never export an inactive, failed, superseded-upload, empty, or zero-population pseudo-success run.

Suggested filename:

```text
SIG-ACTIVA_Raw-V2_2000_YYYY-P##_Run-<runNumber>.xlsx
```

Money should be emitted as real Excel numeric cells for usability, while audit-exact decimal strings/reference evidence should also be retained where useful. Do not perform new financial calculations with JS floating point.

## Run history

Return/display all Raw V2 calculation runs for the selected period, including:

- Stage D failed diagnostic runs;
- invalidated Stage E run history;
- active Stage E SUCCESS;
- stage identity;
- run number/id;
- upload id/version where available;
- status / active;
- ruleset;
- start/end;
- error message;
- persisted row counts where relevant.

Do not mutate or delete history.

## No expected schema migration

Stage F should use existing Stage E persisted schema.

Do not add a migration unless a concrete requirement is impossible with current schema. If you believe a migration is required, stop implementation of that part and explain why in the PR instead of inventing DDL.

Do not apply anything to production.

## Security / isolation

Preserve existing permission model:

- reporting/history/export GET = Cost Structure READ;
- existing Stage D/E calculation POST = PREPARE.

Do not write legacy transaction tables or `CostPeriod.activeCalculationRunId`.

Do not change legacy Engine 1.

## Capability change

Only after the export implementation is complete and protected:

```text
RAW_V2_PHASE = 'F_OPERATIONAL_READINESS'
RAW_V2_CAPABILITIES.exportEnabled = true
```

Keep:

```text
uploadEnabled = true
calculationEnabled = true
```

If export is incomplete, leave export disabled and state the limitation in the PR.

## Tests

At minimum add coverage for:

- report read model scopes current truth to active upload;
- active Stage E SUCCESS selected instead of later failed/inactive history;
- superseded-upload Stage E result not visible as current truth;
- invalidated zero-value run appears in history only;
- export rejects no active SUCCESS;
- export rejects failed controls;
- export rejects no analytical rows;
- export rejects no Nature rows;
- export contains six required sheets;
- Summary values come from persisted results;
- Nature sheet equals persisted Nature records;
- Mapping Coverage/Controls use persisted controls;
- Analytical Lineage preserves source/mapping/rule/reference fields;
- Run History includes failed/inactive runs;
- READ permission on report/export;
- no legacy writes;
- no Stage E formula changes;
- `exportEnabled=true` only with real export route;
- hotfix regression: Stage E remains on `coaCodeRaw` with population guard.

Run:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Report exact results, including any pre-existing repository failures separately from Stage F failures.

## Hard exclusions

Do not implement:

- Company 7000;
- Engine 2/fluctuation;
- finalization/reopen;
- manual adjustment;
- cutover or legacy removal;
- parser semantic changes;
- Stage D formula changes;
- Stage E formula changes;
- production migration/application;
- hard-coded acceptance values or run ids.

## Pull request

Open a PR against `main` titled:

```text
feat(cost): add Raw V2 Stage F operational reporting
```

PR description must include:

- implemented operational read model;
- active-upload/current-result safety;
- dashboard changes;
- export eligibility and workbook sheets;
- history behavior;
- security/isolation;
- tests/build results;
- explicit statement that no financial formula changed;
- explicit statement that no production migration was applied;
- known limitations.

Do not merge the PR.
