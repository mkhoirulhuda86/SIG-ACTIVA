# Codex Task — Raw V2 Stage G Company 7000 Ingestion & Reconciliation

Implement Stage G exactly from:

```text
docs/cost-structure/RAW_V2_STAGE_G_7000_INGESTION_RECONCILIATION.md
```

That document is authoritative. If existing code conflicts with it, preserve Company 2000 behavior and implement the new Company 7000 path without weakening financial controls.

## Primary objective

Extend the isolated Raw V2 upload/parser/persistence workflow so a finance user can upload a Company 7000 raw workbook and obtain auditable core validation plus support-source certification inventory.

Do **not** implement Company 7000 HPP/GHoPO calculation or export in this task.

## Required implementation work

### 1. Company-aware upload

Update Raw V2 upload init and UI so `companyCode` supports only:

```text
2000
7000
```

The signed pending context and storage key must use the selected company. Preserve PREPARE authorization and current duplicate/version/supersession semantics.

Company 2000 behavior must remain byte-for-byte/accounting-equivalent from the user's perspective.

### 2. Company-aware parser source requirements

Refactor the current global source requirement arrays into company-specific policy.

Preserve Company 2000 exactly:

```text
required = TB, CC_ADUM, CC_PASAR
optional-zero = CC_PROD, CC_DERIV
```

Company 7000 Stage G core:

```text
required = TB, CC_ADUM, CC_PASAR
```

Do not create optional-zero placeholders for Company 7000 support sources.

### 3. Certified Company 7000 CC registry

Add only these certified group mappings:

```text
SGK_ADM   -> CC_ADUM
SGK_PASAR -> CC_PASAR
```

Do not invent Company 7000 Cost Center Group identifiers for CC_PROD or CC_WHRPG.

Unknown CC groups must remain unclassified/certification-pending evidence and must never be silently classified solely from sheet name.

A sheet hint that conflicts with a certified group remains ERROR.

### 4. Core 7000 TB and CC validation

Reuse the already validated Raw V2 TB parser and absolute-B:K CC parser.

Company 7000 CC behavior must include:

- B:K only;
- required semantic metadata;
- From Period = To Period;
- exact selected company/year/period consistency;
- `Cost Elements` + `Act. Costs`;
- first Debit terminates detail;
- SUM(detail) - Debit = 0;
- no rows after Debit treated as ordinary detail;
- full Decimal strings/NUMERIC persistence.

### 5. Preserve unknown CC support candidates

Support exact candidate hints for likely CC_PROD and CC_WHRPG worksheets only as inspection evidence.

Required behavior:

- parse/preserve metadata and B:K rows when safe;
- retain observed Cost Center Group;
- do not assign a certified financial logical source if the group is unknown;
- surface `RAW_CC_GROUP_CERTIFICATION_REQUIRED` or equivalent stable issue;
- record certification state in source metadata;
- do not treat pending candidates as zero;
- do not allow them to become calculation inputs.

Use a deterministic source/candidate identity that cannot collide if multiple unknown CC sheets exist.

### 6. Preserve non-CC support candidates

Inventory/preserve these known Company 7000 support families:

```text
COAL
CLINKER_PURCHASE
SOLAR_PP_ORDER
OA_STAT
```

Reuse existing legacy parser knowledge only to recognize/preserve source evidence safely. Do not copy legacy final calculation results into Raw V2.

For Stage G:

- exact worksheet aliases may identify a support candidate;
- preserve raw row/cell evidence and file/sheet/row lineage;
- store `CERTIFICATION_PENDING` metadata unless the Stage G contract explicitly certifies a semantic field;
- amount may remain null where no certified financial semantic field exists;
- surface `RAW_SUPPORT_CONTRACT_PENDING` warning/info;
- no cached formula/output total becomes authoritative.

### 7. Stage H readiness read model

Return an explicit Company 7000 readiness object from upload/result data, e.g.:

```text
coreValidated
stageHReady
blockers[]
pendingSupport[]
```

`stageHReady` must be false while mandatory future dependencies remain missing or certification-pending.

This is a readiness signal only; do not create a Company 7000 calculation run.

### 8. UI

Raw V2 upload workspace must:

- allow company 2000/7000 selection;
- clearly label 7000 as raw ingestion/certification only;
- show core source controls;
- show support candidates and certification states;
- separate ERROR/WARNING/INFO;
- show Stage H blocked reasons;
- never show/enable a Company 7000 HPP/GHoPO calculate or export action.

Do not regress Company 2000 Stage F operational page/export.

### 9. Persistence

Prefer current generic Raw V2 tables. No migration is expected.

Use `metadataJson`/existing fields for source certification metadata if sufficient.

If a schema migration is genuinely unavoidable, **stop** and document why in the PR. Do not add migration/DDL by assumption.

### 10. Security/isolation

- PREPARE for upload writes.
- READ for upload/history reads.
- supported companies allow-list `2000|7000` server-side.
- no legacy Cost Structure transaction write.
- no Company 7000 calculation/result write.
- no production mutation from this coding task.

## Required tests

Add synthetic tests for at least:

1. upload init accepts 7000 and binds signed context/storage path to 7000;
2. unsupported company rejected;
3. 2000 source requirements unchanged;
4. 7000 `SGK_ADM` -> `CC_ADUM`;
5. 7000 `SGK_PASAR` -> `CC_PASAR`;
6. 7000 unknown CC group not silently classified from `cc_prod` sheet hint;
7. unknown CC support evidence remains preserved/certification-pending;
8. 7000 ADUM/PASAR first Debit ends detail population;
9. missing Debit blocks certified core source;
10. detail-to-Debit mismatch blocks;
11. wrong fiscal period blocks;
12. support candidate inventory for COAL/CLINKER_PURCHASE/SOLAR_PP_ORDER/OA_STAT;
13. pending support is not converted to zero;
14. Stage H readiness false while support certification is pending;
15. no 7000 calculate/export endpoint becomes enabled;
16. Company 2000 parser and Stage F tests remain green;
17. no legacy transaction writes.

Do not commit private Company 7000 workbooks. Use synthetic workbook fixtures generated in tests.

## Validation commands

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

If repository-wide pre-existing lint/build issues remain, document exact failures and demonstrate that modified Stage G files pass targeted lint/type checks. Do not hide new failures.

## PR requirements

Open a PR against `main` with:

- summary of Company 7000 core support;
- exact source policy by company;
- support certification behavior;
- list of pending raw-contract items discovered;
- tests run/results;
- explicit statement that no migration was introduced, or stop if one is needed;
- explicit statement that no Company 7000 HPP/GHoPO calculation/export was enabled;
- explicit statement that Company 2000 Stage C-F behavior was preserved.

Do not merge the PR.
Do not deploy production manually.
Do not apply migrations.
