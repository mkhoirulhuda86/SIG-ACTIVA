# Update Cycle SAP — Integration Blueprint

Status: foundation locked for implementation inside SIG ACTIVA.

## Product placement

`Update Cycle SAP` is an additive operational submodule under `Cost Structure & Fluktuasi`. It must not modify or recalculate existing Engine 1 Monthly Cost Structure or Engine 2 Fluctuation Analysis results.

Recommended navigation:

```text
Cost Structure & Fluktuasi
├── Dashboard
├── Upload & Proses
├── Cost Structure Bulanan
├── Engine 1 V2 – Raw SAP
├── Update Cycle SAP
│   ├── Proses Cycle
│   ├── Riwayat Cycle
│   └── Master CC & Reference [Admin]
└── Analisis Fluktuasi
```

UI routes:

```text
/cost-structure/cycle
/cost-structure/cycle/history
/cost-structure/cycle/master
```

API namespace reserved for implementation:

```text
/api/cost-structure/cycle/*
```

Domain namespace:

```text
lib/cost-structure/cycle/*
```

Database models must use isolated `CostCycle*` names.

## Monthly user workflow

```text
Select target fiscal period
→ upload one latest SAP cycle workbook
→ validate workbook
→ derive one baseline ON/OFF status per Receiver CC
→ display Receiver CC grouped by Plant Code and process order
→ user changes only the required CC toggles
→ engine applies the change to all target rows/segments for that Receiver CC
→ validate delta
→ preview CC-level changes and optional segment-level audit detail
→ generate two delta workbooks
   - Fix Cost <period>.xlsx
   - Var Cost <period>.xlsx
→ user uploads generated files to SAP
```

There is exactly one ON/OFF control per Receiver CC. Segment is an engine/audit grain, never an ON/OFF control.

## Source workbook facts verified from August 2026 example

Private reference files remain outside GitHub.

Verified `cycle 08.26.xlsx` characteristics:

- data sheet: `Sheet1`;
- 13,913 data rows;
- 11 source columns;
- `7FT1GF`: 7,090 rows, Fixed Cost;
- `7VT1GF`: 6,823 rows, Variable Cost;
- 45 unique Receiver CC values present in the cycle;
- all 45 Receiver CC values map to the supplied production-CC/plant master;
- supplied master contains 59 production Cost Centers total;
- Cost Centers in the master but absent from the uploaded cycle are not displayed in the monthly toggle panel;
- SAP `Start Date` in the August example is 2023-01-01 for all rows and is SAP validity data, not the reporting month.

The application target fiscal period is transaction metadata entered in SIG ACTIVA. It must not overwrite SAP `Start Date`.

## Golden business evidence

Receiver CC `7203311054` = Finish Mill 2 Tuban II was OFF in the August cycle baseline. Receiver CC `7203311053` = Finish Mill 1 Tuban II is its validated reference.

The user's actual SAP upload files prove the rule:

- Fixed Cost output for `7203311054`: 220/220 target segments matched the `7203311053` portion pattern;
- Variable Cost output for `7203311054`: 214/214 target segments matched the `7203311053` portion pattern.

This is the first mandatory golden scenario for the allocation engine.

## Existing SIG ACTIVA architecture to preserve

Reuse:

- Next.js App Router + React + TypeScript;
- existing `CostModuleFrame`, Sidebar/Header and UI language;
- existing custom session authentication and Cost Structure role helpers;
- Prisma Client server runtime;
- Supabase PostgreSQL as database host;
- controlled Supabase migrations for production DDL;
- existing private durable storage pattern;
- `xlsx` for parsing when appropriate and `exceljs` for server-generated output.

Do not introduce Supabase Auth, direct browser-to-database access, or an iframe/standalone app.

## Security intent

Baseline permissions follow Cost Structure conventions:

- Read/history: existing Cost Structure read roles;
- Prepare/upload/toggle/generate: `ADMIN_SYSTEM`, `STAFF_ACCOUNTING`;
- Master CC/reference administration: `ADMIN_SYSTEM`;
- all write authorization enforced server-side.

## Source-of-truth documents

Read these before implementing Cycle code:

1. root `AGENTS.md`;
2. all existing `docs/cost-structure-fluctuation/*` documents because repository/runtime/security constraints still apply;
3. this folder, especially:
   - `BUSINESS_RULES.md`
   - `DATA_CONTRACT.md`
   - `DEVELOPMENT_PLAN.md`
   - `CODEX_PARALLEL_TASKS.md`
   - `CC_MASTER.csv`
   - `REFERENCE_MAPPING.csv`

When a generic Cost Structure document conflicts with a Cycle-specific rule, the Cycle-specific document governs only the `CostCycle*` domain. Existing Cost Structure financial behavior must remain unchanged.