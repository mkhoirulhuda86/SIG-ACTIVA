# Update Cycle SAP — Parallel Codex Task Prompts

These prompts are designed to be run in separate Codex sessions/branches in parallel. They intentionally contain the business context required to start implementation without repeating discovery of the process.

All tasks use repository:

```text
mkhoirulhuda86/SIG-ACTIVA
```

Base work on the latest `feat/cycle-integration-foundation` branch, not an old snapshot of `main`.

Before editing, read:

```text
AGENTS.md
docs/cost-structure-cycle/README.md
docs/cost-structure-cycle/BUSINESS_RULES.md
docs/cost-structure-cycle/DATA_CONTRACT.md
docs/cost-structure-cycle/DEVELOPMENT_PLAN.md
```

Also respect existing repository runtime/migration/security constraints in:

```text
docs/cost-structure-fluctuation/DATABASE_RUNTIME.md
docs/cost-structure-fluctuation/SECURITY.md
```

Do not re-brainstorm the business process. The rules below are locked for this implementation unless code reality creates a technical blocker.

---

# PROMPT A — Database, Upload, Storage, Parser

```text
TASK: Implement the Cost Cycle database + ingestion lane only.

Repository: mkhoirulhuda86/SIG-ACTIVA
Base branch: feat/cycle-integration-foundation
Create/work on branch: codex/cycle-db-ingestion

Do not restart business analysis. The Cycle business contract is already locked in docs/cost-structure-cycle/*.

READ FIRST:
- AGENTS.md
- docs/cost-structure-cycle/README.md
- docs/cost-structure-cycle/BUSINESS_RULES.md
- docs/cost-structure-cycle/DATA_CONTRACT.md
- docs/cost-structure-cycle/DEVELOPMENT_PLAN.md
- docs/cost-structure-fluctuation/DATABASE_RUNTIME.md
- docs/cost-structure-fluctuation/SECURITY.md
- lib/cost-structure/cycle/contracts.ts

BUSINESS CONTEXT YOU MUST PRESERVE:
- User uploads ONE latest SAP cycle workbook each month.
- That workbook contains Fixed and Variable allocation cycles together.
- Supported Cycle codes are exactly:
  7FT1GF = Fixed Cost
  7VT1GF = Variable Cost
- August reference file had 13,913 data rows: 7,090 Fixed + 6,823 Variable, 45 unique Receiver CC.
- Persistent production CC master contains 59 CC; only CC present in the uploaded cycle appear in the monthly panel.
- Main toggle is one per Receiver CC, never per Segment.
- Status is derived across BOTH cycles: OFF only if every portion across Fixed+Variable is zero; otherwise ON.
- SAP Start Date is validity data and must be preserved; reporting period is application metadata.
- Required source headers: Cycle, Start Date, Segment name, Receiver CC, Portion/Percent.
- Additional SAP columns may exist and may be retained as raw JSON.
- Source unique key for supported rows: Cycle + Segment name + Receiver CC.
- Both supported cycles must be present. Unexpected cycle codes are blocking in MVP.
- Receiver CC and Segment are identifiers; never lose formatting by numeric coercion.

ARCHITECTURE CONSTRAINTS:
- Add isolated CostCycle* Prisma models. Do not repurpose CostPeriod/CostUpload/CostSourceRow because Cycle has a separate lifecycle and must not disturb Engine 1/Engine 2.
- Reuse existing custom session auth and Cost Structure role pattern.
- Runtime DB access remains server-side Prisma Client through lib/prisma.ts.
- Production DB is Supabase PostgreSQL, but production DDL is applied through controlled Supabase migrations.
- DO NOT run production prisma migrate deploy/reset/db push.
- Create additive reviewed migration SQL in repo only.
- Reuse the existing approved durable/private storage pattern. Do not use Vercel ephemeral local filesystem.
- Do not introduce Supabase Auth or direct browser DB access.

DESIGN TARGET:
Create a minimal normalized Cycle persistence model sufficient for:
1. one CostCyclePeriod per fiscal year/month;
2. versioned CostCycleUpload with original file name, hash, size, storage identity, active/superseded status, uploader/timestamps;
3. normalized CostCycleSourceRow with source row/order, cycle, start date, segment, receiver CC, portion and raw JSON as needed;
4. validation issue persistence;
5. persistent CC master and reference configuration OR repository/service shape that supports later DB-backed master without coupling parser to CSV;
6. future change/generation history support without forcing engine logic into DB models.

You may refine model names, but all new models must be CostCycle* and additive.

IMPLEMENT:
- Prisma schema additions + additive migration SQL.
- If User relations are needed, add only additive named relations.
- Server authorization helper(s) specific to Cycle if useful, reusing existing Cost Structure roles.
- POST upload endpoint under /api/cost-structure/cycle/*.
- Validate Excel extension/MIME/size with a reasonable configured limit consistent with repo patterns.
- SHA-256 file hash and duplicate/version behavior.
- Durable source-file storage through existing storage abstraction/pattern.
- Detect the data sheet by required header fingerprint instead of hard-coding Sheet1 only.
- Parse stored workbook values; never execute macros or arbitrary formulas.
- Normalize identifiers to string and portions to valid numeric values.
- Preserve source row number and deterministic source order.
- Enforce source duplicate key Cycle+Segment+Receiver CC.
- Validate both cycle codes present and no unexpected code.
- Validate every Receiver CC in source exists in active Cycle CC master; unknown source CC is blocking.
- Return/persist useful structural summary: total rows, fixed rows, variable rows, unique CC, issues.
- Do NOT implement ON/OFF allocation, reference copy, preview delta, or Excel export in this task.

MASTER SEED INPUTS:
- docs/cost-structure-cycle/CC_MASTER.csv contains 59 production CC rows.
- docs/cost-structure-cycle/REFERENCE_MAPPING.csv contains current reference proposals for 45 CC seen in the August cycle.
- Do not silently convert PROPOSED reference rows into business-validated rows. Preserve review status.
- 7203311054 -> 7203311053 is VALIDATED.
- WHRPG 7203141081 is MANUAL_REQUIRED.

TESTS REQUIRED:
- valid synthetic workbook containing both cycles;
- missing required column;
- missing Fixed or Variable cycle;
- unexpected cycle code;
- duplicate Cycle+Segment+Receiver CC;
- unknown Receiver CC;
- Receiver CC/Segment numeric-looking values preserve canonical string identity;
- active CC with Fixed nonzero and Variable all zero is still represented correctly for downstream status derivation;
- duplicate hash/version behavior;
- unauthenticated/unauthorized upload.

FILE OWNERSHIP / CONFLICT RULE:
You own:
- prisma/schema.prisma
- one new additive Cycle migration directory
- app/api/cost-structure/cycle/upload/* and period/upload endpoints needed for ingestion
- lib/cost-structure/cycle/parser/*
- lib/cost-structure/cycle/storage/*
- lib/cost-structure/cycle/repository/*
- ingestion-specific tests

Do NOT edit:
- app/cost-structure/cycle/*
- lib/cost-structure/sidebar-navigation.ts
- docs/cost-structure-cycle/*
- lib/cost-structure/cycle/engine/*
- lib/cost-structure/cycle/validation/* except parser-specific validation local to ingestion
- lib/cost-structure/cycle/export/*
- existing Engine 1/Engine 2 calculation code.

Before completion run applicable:
- prisma format
- prisma validate
- prisma generate
- relevant Cycle tests
- npm test or repo-scoped tests as appropriate
- npm run lint
- npm run build

Report:
- changed files;
- migration SQL summary and why it is non-destructive;
- test evidence;
- any pre-existing unrelated failures separately.
Do not apply production DDL.
```

---

# PROMPT B — Pure Allocation + Validation Engine

```text
TASK: Implement the pure Cost Cycle allocation and validation engine only.

Repository: mkhoirulhuda86/SIG-ACTIVA
Base branch: feat/cycle-integration-foundation
Create/work on branch: codex/cycle-engine-validation

Do not inspect or redesign the database. This task must remain a pure deterministic domain implementation so it can run in parallel with database ingestion work.

READ FIRST:
- AGENTS.md
- docs/cost-structure-cycle/README.md
- docs/cost-structure-cycle/BUSINESS_RULES.md
- docs/cost-structure-cycle/DATA_CONTRACT.md
- docs/cost-structure-cycle/DEVELOPMENT_PLAN.md
- lib/cost-structure/cycle/contracts.ts

LOCKED BUSINESS LOGIC:
1. Supported cycles:
   7FT1GF Fixed
   7VT1GF Variable
2. One Receiver CC = one toggle. Never segment-level toggles.
3. Baseline status is across both cycles:
   OFF only if ALL portions for the CC in both cycles are zero.
   ON if any portion is nonzero.
4. ON->ON and OFF->OFF = NO_CHANGE, no delta rows.
5. ON->OFF:
   output every target baseline row for the Receiver CC in both cycles,
   preserve target Cycle/Start Date/Segment/Receiver CC,
   set Portion=0.
   There is NO redistribution/normalization to other CCs.
6. OFF->ON:
   resolve preferred reference, then configured fallback order.
   no automatic historical self-pattern.
   reference must exist in current upload and be baseline ON overall.
   use TARGET rows as output skeleton.
   for each target row lookup reference by exact Cycle + Segment name + reference Receiver CC.
   copy ONLY reference Portion to target output row.
   preserve all target identity fields including target Start Date and Receiver CC.
7. If a target segment is missing on reference => blocking ERROR.
8. Extra reference segment not present on target => WARNING only, do not invent target row.
9. A reference may legitimately have all-zero rows in one cycle while still being ON overall. Do NOT reject such a reference solely because one cycle has no nonzero portion.
10. Duplicate Cycle+Segment+Receiver CC is blocking.
11. Preserve source order for generated delta rows.
12. Split delta rows by cycle for later export.

REFERENCE GOVERNANCE:
- reference config includes preferred and ordered fallbacks.
- VALIDATED starting case:
  target 7203311054 Finish Mill 2 Tuban II
  reference 7203311053 Finish Mill 1 Tuban II
- Actual August business evidence: target was OFF; generated real SAP files matched reference portions for 220/220 Fixed target segments and 214/214 Variable target segments.
- Other rows in REFERENCE_MAPPING.csv may be PROPOSED/Manual. Engine should surface review status as warning/metadata, not silently declare them validated.
- MANUAL_REQUIRED/no configured usable reference must block TURN_ON.

IMPLEMENT AS PURE FUNCTIONS:
Suggested capabilities, naming may vary:
- indexSourceRows(rows)
- deriveReceiverBaselines(rows, ccMaster)
- resolveReference(targetCc, referenceConfig, baselines, optionalUserSelectedReference)
- planCycleChanges(rows, baselines, targetRequests, referenceConfig)
- validatePlannedChanges(...)
- buildCycleDelta(...)
- splitDeltaByCycle(...)

Do not use React, Prisma, request objects, storage, or ExcelJS inside engine functions.
Do not perform network/database calls.
Do not mutate input arrays/objects.
Repeated identical input must produce deeply identical output/order.

ISSUE CODES:
Use canonical codes from DATA_CONTRACT.md where applicable, including:
DUPLICATE_TARGET_KEY
REFERENCE_NOT_CONFIGURED
REFERENCE_NOT_IN_UPLOAD
REFERENCE_NOT_ACTIVE
REFERENCE_SELF
REFERENCE_SEGMENT_MISSING
REFERENCE_EXTRA_SEGMENT
REFERENCE_FALLBACK_USED
REFERENCE_MAPPING_PROPOSED
NEGATIVE_PORTION

Negative portion is warning unless another locked rule says otherwise; do not invent a rejection rule.

TEST MATRIX REQUIRED:
- baseline OFF: Fixed zero + Variable zero.
- baseline ON: Fixed nonzero + Variable zero.
- baseline ON: Fixed zero + Variable nonzero.
- ON->ON no rows.
- OFF->OFF no rows.
- ON->OFF generates all target rows with zero while preserving identities/order.
- OFF->ON copies exact per-segment portion from preferred reference in both cycles.
- OFF->ON with one reference cycle all zero is valid when reference is ON overall and segment coverage exists.
- fallback selected when preferred absent/inactive and emits warning.
- no usable reference blocks.
- target segment missing in reference blocks.
- extra reference segment only warns.
- duplicate key blocks.
- user-selected allowed reference behavior if contract supports it.
- deterministic repeated calls.

GOLDEN SEMANTIC FIXTURE:
Create a compact synthetic fixture using the real identities:
- target: 7203311054
- reference: 7203311053
- include multiple Fixed and Variable segments with different portions and at least one zero portion.
- prove target Receiver CC and target Start Date are preserved while only portion is copied.
Do NOT commit private workbooks or proprietary row data.

FILE OWNERSHIP:
You own only:
- lib/cost-structure/cycle/engine/*
- lib/cost-structure/cycle/validation/*
- engine/validation test files

You may import but should not rewrite lib/cost-structure/cycle/contracts.ts unless a real contract defect blocks implementation. If a contract change is necessary, document it rather than broadly editing foundation files.

Do NOT edit:
- prisma/*
- app/api/*
- app/cost-structure/cycle/*
- sidebar navigation
- docs/cost-structure-cycle/*
- export implementation
- existing Cost Structure/Fluctuation financial engines.

Run relevant tests, lint and build. Report exact changed files and test evidence.
```

---

# PROMPT C — Excel Export + Golden Comparator

```text
TASK: Implement the Cost Cycle Excel export lane only.

Repository: mkhoirulhuda86/SIG-ACTIVA
Base branch: feat/cycle-integration-foundation
Create/work on branch: codex/cycle-export-tests

This task runs in parallel with DB ingestion and allocation engine work. Do not add DB/API/UI logic.

READ FIRST:
- AGENTS.md
- docs/cost-structure-cycle/README.md
- docs/cost-structure-cycle/BUSINESS_RULES.md
- docs/cost-structure-cycle/DATA_CONTRACT.md
- docs/cost-structure-cycle/DEVELOPMENT_PLAN.md
- lib/cost-structure/cycle/contracts.ts

OUTPUT CONTRACT IS LOCKED:
Input to exporter is already-planned CycleDeltaRow data. Exporter must not decide ON/OFF/reference logic.

Generate two independent XLSX outputs:
- 7FT1GF rows -> Fix Cost <period>.xlsx
- 7VT1GF rows -> Var Cost <period>.xlsx

Workbook contract:
- use exceljs server-side;
- one worksheet named exactly `Lembar1`;
- exact header order:
  Cycle
  Start Date
  Segment name
  Receiver CC
  Portion/Percent
- no extra business columns in SAP upload workbook;
- preserve delta source order;
- preserve target Start Date semantically and render compatibly with Excel/SAP reference;
- render Receiver CC and Segment identifiers without `.0`, scientific notation, or accidental loss of identity;
- Portion must be numeric Excel value, not formatted text;
- no formulas are needed in the upload files;
- generated workbooks are delta only, not full cycle copies.

FILE NAME CONTRACT:
Use Indonesian month abbreviations:
Jan Feb Mar Apr Mei Jun Jul Agt Sep Okt Nov Des
Examples:
Fix Cost Agt 26.xlsx
Var Cost Agt 26.xlsx

REFERENCE FACTS:
Actual user-approved August files had:
- worksheet `Lembar1`;
- exact 5-column header above;
- Fix file: 220 data rows for Receiver CC 7203311054;
- Var file: 214 data rows for Receiver CC 7203311054.
The actual private files must not be committed.

IMPLEMENT:
- pure filename formatter;
- Fixed/Variable workbook writer accepting delta rows and target fiscal period;
- return Buffer/Uint8Array plus file name/content type metadata suitable for later API integration;
- semantic workbook-reader/comparator used only in tests/local harness;
- optional CLI/local script for private golden parity that accepts file paths through CLI args or environment variables and never assumes those files exist in repo.

PRIVATE GOLDEN HARNESS EXPECTED SEMANTICS:
When local files are supplied:
1. parse generated and expected workbook semantically;
2. compare sheet name/header;
3. compare row count;
4. compare Cycle, Start Date, Segment name, Receiver CC, Portion values row-by-row or by deterministic source-order contract;
5. report first mismatch clearly;
6. do not compare binary XLSX bytes or metadata timestamps.

TESTS REQUIRED:
- Fixed-only delta writes correct workbook.
- Variable-only delta writes correct workbook.
- both output sets generated with correct names.
- zero portion remains numeric zero.
- decimal portions such as 2.5/6.5 remain numeric.
- long Receiver CC renders exactly.
- Start Date survives write/read roundtrip.
- no-change/empty delta behavior is explicit: either no file returned or well-defined empty-file behavior, aligned with BUSINESS_RULES (prefer no file for a cycle with no changed rows).
- deterministic semantic output.
- user-provided text if ever written is formula-injection safe; current SAP five columns should contain no user free text.

FILE OWNERSHIP:
You own:
- lib/cost-structure/cycle/export/*
- export tests
- optional cycle private-golden local script

Do NOT edit:
- prisma/*
- app/api/*
- app/cost-structure/cycle/*
- sidebar navigation
- docs/cost-structure-cycle/*
- engine/validation code
- existing Cost Structure export code except importing a small shared utility if absolutely necessary.

Run relevant tests, lint and build. Report changed files and semantic export evidence.
```

---

# PROMPT D — Integration Workflow after A+B+C

This prompt is NOT part of the first parallel wave. Run it after A, B and C are integrated/rebased and their tests pass.

```text
TASK: Integrate Cost Cycle ingestion + allocation + export into the existing SIG ACTIVA Cycle UI shells and implement history/master workflow.

Repository: mkhoirulhuda86/SIG-ACTIVA
Base: a temporary integration branch containing:
- feat/cycle-integration-foundation
- codex/cycle-db-ingestion
- codex/cycle-engine-validation
- codex/cycle-export-tests

Create/work on branch: codex/cycle-workflow-integration

Do not redesign business logic. Use the existing parser/engine/export services as authoritative.

READ all docs/cost-structure-cycle/* and root AGENTS.md.

TARGET E2E FLOW:
Select target period
→ upload one cycle workbook
→ server validates/persists
→ panel shows only uploaded/master-mapped Receiver CC grouped by Plant Code/process order
→ exactly one ON/OFF toggle per Receiver CC
→ user changes desired CC statuses
→ preview server plans all affected segment rows
→ validation issues shown; ERROR blocks generation
→ generate Fixed/Variable delta files
→ persist generation/audit history
→ authorized download
→ history page shows source/generation versions and change summary
→ Admin master page manages CC/reference config/review status

SERVER IS AUTHORITATIVE:
- rederive baseline status from persisted active upload;
- never trust browser baseline/action/reference eligibility;
- rerun engine validation at preview and again immediately before generation;
- generation must bind to exact active upload version and selected changes;
- if active upload/reference master changed after preview, fail closed and require refresh.

UI REQUIREMENTS:
- keep existing CostModuleFrame and SIG ACTIVA visual language;
- main panel grouped by Plant Code;
- sort by plant then master display_order;
- show process/equipment, Receiver CC, description, baseline status, target toggle;
- do not expose segment toggles;
- segment detail is read-only preview/audit drawer/table;
- for OFF->ON display resolved reference and warning if fallback/PROPOSED mapping;
- generation button disabled while ERROR issues exist;
- if there are no actual changes, generation is disabled and explain why.

HISTORY/AUDIT:
Persist source upload identity/hash/version, baseline/target status, resolved reference, warnings/errors, affected Fixed/Variable row counts, generation identity/hash/user/time.

AUTHORIZATION:
- read/history: Cost Structure read roles;
- prepare/upload/toggle/generate: ADMIN_SYSTEM and STAFF_ACCOUNTING;
- master reference administration: ADMIN_SYSTEM;
- enforce server-side.

PRIVATE GOLDEN RELEASE GATE:
Provide a local/manual E2E path to validate the actual August scenario:
- source cycle 08.26.xlsx
- turn 7203311054 OFF->ON
- reference 7203311053
- generated Fixed semantic rows must match the approved Fix Cost Agt 26.xlsx (220 rows)
- generated Variable semantic rows must match Var Cost Agt 26.xlsx (214 rows)
Private files stay outside GitHub.

Run:
- relevant Cycle tests
- auth negative tests
- npm test/applicable runner
- npm run lint
- npm run build
- regression for existing Cost Structure routes and existing Fluktuasi OI/EXP isolation.

Do not apply production migration in this task. Produce deployment/migration instructions for review.
```

---

## Parallel execution rule

Prompts A, B and C are deliberately non-overlapping and may start together after `feat/cycle-integration-foundation` is pushed/current.

Do not let one Codex session opportunistically implement another lane. If a dependency is missing, expose the required interface/assumption and continue within the task boundary rather than editing another lane's files.