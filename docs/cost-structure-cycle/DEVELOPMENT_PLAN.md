# Update Cycle SAP — Development Plan

## Strategy

This is an additive SIG ACTIVA module. No standalone bootstrap and no iframe integration.

Initial development is split into non-overlapping lanes so multiple Codex tasks can run in parallel after this foundation branch is available.

## Foundation branch

```text
feat/cycle-integration-foundation
```

Foundation owns:

- Cycle-specific documentation;
- master/reference seed specifications;
- shared Cycle TypeScript contracts/constants;
- navigation entries;
- route/UI shells only.

Foundation does not own Prisma models, migrations, parser implementation, allocation engine, API persistence or final Excel generation.

## Parallel Lane A — DB + ingestion

Suggested branch:

```text
codex/cycle-db-ingestion
```

Own files:

```text
prisma/schema.prisma
prisma/migrations/<cycle migration>/*
app/api/cost-structure/cycle/upload/*
app/api/cost-structure/cycle/periods/* as needed
lib/cost-structure/cycle/storage/*
lib/cost-structure/cycle/parser/*
lib/cost-structure/cycle/repository/*
cycle DB/ingestion tests
```

Scope:

- additive `CostCycle*` schema;
- controlled migration SQL only, never production `prisma db push/reset/deploy`;
- active/upload versioning and SHA-256;
- reuse approved durable storage pattern;
- workbook/header detection;
- normalize supported rows;
- source/master mapping coverage validation;
- server-side upload authorization;
- persist raw/normalized lineage.

Acceptance:

- parser recognizes exact Cycle contract;
- duplicate/unmapped/required-cycle controls work;
- no financial Cost Structure model is modified destructively;
- Prisma validate/generate, relevant tests and build pass.

## Parallel Lane B — allocation + validation engine

Suggested branch:

```text
codex/cycle-engine-validation
```

Own files:

```text
lib/cost-structure/cycle/engine/*
lib/cost-structure/cycle/validation/*
engine/validation tests
```

No Prisma/schema/API/UI edits.

Scope:

- pure deterministic functions over shared Cycle contracts;
- derive CC baseline status across both cycles;
- resolve NO_CHANGE / TURN_OFF / TURN_ON;
- reference priority and usability checks;
- target-skeleton segment copy;
- exact missing/extra/duplicate controls;
- delta rows split by Fixed/Variable;
- no automatic self-history.

Golden semantic gate:

```text
7203311054 OFF→ON using 7203311053
```

must behave exactly as documented.

Acceptance:

- deterministic repeated calls;
- ON→OFF and OFF→ON tests;
- Fixed-only nonzero / Variable-all-zero active CC test;
- target/reference segment mismatch tests;
- fallback/warning behavior tests;
- no DB dependency.

## Parallel Lane C — Excel export + private golden harness

Suggested branch:

```text
codex/cycle-export-tests
```

Own files:

```text
lib/cost-structure/cycle/export/*
export tests
optional scripts/cycle-private-golden-* harness
```

No Prisma/schema/API/UI edits.

Scope:

- ExcelJS writer for Fixed/Variable delta files;
- `Lembar1` sheet;
- exact five-column header/order;
- preserve source order;
- period-based Indonesian file names;
- deterministic values/formatting suitable for SAP upload;
- semantic test reader/comparator;
- optional local private golden harness that reads paths from environment/CLI and never commits private workbooks.

Acceptance:

- synthetic fixtures generate expected workbook values;
- formula-injection safe for any text fields;
- empty/no-change case handled explicitly;
- no database dependency.

## Integration Lane D — workflow API + history + UI wiring

Starts only after A+B+C contracts are stable and preferably merged/rebased onto one integration branch.

Suggested branch:

```text
codex/cycle-workflow-integration
```

Scope:

- upload response → CC panel data;
- save target status changes;
- server revalidation before preview/generate;
- preview endpoint;
- generation transaction/history;
- generated-file persistence/download authorization;
- wire existing route shells to APIs;
- master admin screen persistence;
- history page;
- audit actions.

Acceptance:

```text
upload → validate → toggle CC → preview → generate → download Fixed/Variable
```

works end-to-end using synthetic/approved local data.

## Hardening Lane E

After integration:

- negative authorization tests;
- upload abuse/size/row limits;
- transaction/race checks;
- replacement/supersede behavior;
- idempotent preview/generation;
- generated file access checks;
- realistic 13,913-row performance test;
- existing SIG ACTIVA regression;
- migration/deployment runbook.

## Merge order

Recommended:

```text
feat/cycle-integration-foundation
        ↓
merge/rebase A, B, C independently against latest foundation
        ↓
merge A + B + C into temporary cycle integration branch
        ↓
Lane D workflow integration
        ↓
Lane E hardening
        ↓
PR to main
```

Do not merge Cycle production DDL before migration review.

## Conflict boundaries

Initial parallel Codex tasks must not edit:

```text
app/cost-structure/cycle/*          foundation UI shell
lib/cost-structure/sidebar-navigation.ts
AGENTS.md
```

unless their prompt explicitly moves into Integration Lane D.

Foundation must not edit:

```text
prisma/schema.prisma
prisma/migrations/*
app/api/cost-structure/cycle/*
lib/cost-structure/cycle/parser/*
lib/cost-structure/cycle/engine/*
lib/cost-structure/cycle/export/*
```

except the shared `lib/cost-structure/cycle/contracts.ts` contract.

## Release gates

1. Source parser gate: structural controls pass.
2. Engine unit gate: all toggle/reference semantics pass.
3. Export gate: exact workbook contract pass.
4. August private golden gate: `7203311054` output semantically matches actual Fix/Var upload files.
5. Full integration gate: authorized E2E flow passes.
6. Regression gate: existing SIG ACTIVA build/tests/modules remain functional.
7. Production migration gate: reviewed additive SQL applied only through controlled Supabase migration tooling.

## Out of scope

Do not add opportunistically:

- direct SAP API/RFC/BAPI posting;
- automatic posting approval;
- AI selection of reference CC;
- automatic historical self-pattern restoration;
- modification of Cost Structure Engine 1/Engine 2 formulas;
- unrelated Accrual/Prepaid/Material/Fluktuasi refactors.