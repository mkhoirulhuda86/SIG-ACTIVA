# SIG ACTIVA — Raw SAP Input Contract
## Engine 1 V2 – Raw SAP (Stage A — LOCKED)

**Status:** LOCKED for Company 2000 TB + CC raw contract and shared TB/CC parser pattern for Company 7000.  
**Purpose:** define the authoritative raw-input boundary before implementation. Existing Cost Structure menu/engine must remain unchanged and usable in parallel.

---

## 1. Scope and non-negotiable boundary

The new raw engine accepts SAP source data and generates analytical working papers internally. Workbook helper/formula/output sheets are not authoritative inputs.

### Authoritative raw source principle

- TB: only semantic columns based on `FS Item/Account`, current YTD, previous YTD, and `Variance` are financial input.
- CC reports: only SAP raw area **columns B:K** is authoritative.
- Any helper/processed columns outside B:K must be ignored, even if they contain valid-looking COA/amount/formulas.
- `rincian biaya`, `SI`, `GHoPO`, `DERIV`, and similar calculated/reference sheets are outputs/golden references, not monthly raw inputs in the new engine.
- All financial arithmetic uses Decimal/NUMERIC; never JS binary floating point.
- Original file, file SHA-256, original sheet name, row number, and raw cell snapshot must remain traceable.

### Parallel-development rule

- Existing `/cost-structure` behavior must not be changed by this development.
- New route/API/data namespace must be isolated (planned: `/cost-structure/raw-v2` and `/api/cost-structure/raw-v2`).
- Existing calculation-run pointer must not be reused by experimental raw-engine runs.
- UI label may be `Engine 1 V2 – Raw SAP`.
- Internal rule-set identifiers must not collide with current `ENGINE1_2000_V2`; recommended identifiers:
  - `ENGINE1_2000_RAW_V3`
  - `ENGINE1_7000_RAW_V3`

---

## 2. Upload batch contract

A raw upload batch is bound to exactly:

- `companyCode`
- `fiscalYear`
- `fiscalPeriod`
- one source snapshot/version

The user may upload one workbook containing several sheets or several workbooks. Detection is performed per worksheet and all detected logical sources are assembled into one batch.

### Duplicate-source rule

Unless a logical source is explicitly designed as multipart, more than one worksheet resolving to the same logical source within one batch is an **ERROR** (`RAW_SOURCE_AMBIGUOUS`). Do not silently choose one.

### Filename rule

Filename and sheet name are hints only. They are never authoritative for financial content or period. Content metadata is authoritative where available.

---

# 3. Company 2000 source requirements

| Logical source | Requirement | Missing behavior |
|---|---|---|
| `TB` | REQUIRED | block |
| `CC_ADUM` | REQUIRED | block |
| `CC_PASAR` | REQUIRED | block |
| `CC_PROD` | OPTIONAL-ZERO | absent = explicit zero dependency |
| `CC_DERIV` | OPTIONAL-ZERO | absent = explicit zero dependency |

`CC_PROD` and `CC_DERIV` are not allowed to become required merely because a historical processed workbook contained their sheets.

### Optional-zero semantics

There is an important distinction:

1. **Sheet/source absent** → valid zero dependency with lineage status `ABSENT_TREATED_AS_ZERO`.
2. **Sheet present and valid with all financial detail zero** → valid zero source.
3. **Sheet present but malformed/unreadable/header missing/control mismatch** → **ERROR**, never silently treated as zero.

No fabricated source row should be inserted for an absent source. Zero semantics must be represented in calculation dependency metadata.

---

# 4. TB raw contract

## 4.1 Header detection

Do not hard-code row numbers. Detect semantic headers within the top section of the worksheet.

Required semantic fields:

- `FS Item/Account`
- `FY <year> 1 - <period>` — current cumulative YTD
- `FY <year> 1 - <period-1>` — previous cumulative YTD for periods 2–12
- `Variance`

Whitespace must be normalized before matching. Example regex concept for YTD header:

`^FY\s+(\d{4})\s+1\s*-\s*(\d{1,2})$`

The columns may move; identify them by semantics, not fixed letters.

## 4.2 Period derivation

For periods 2–12:

- current YTD header determines `fiscalYear` and `fiscalPeriod = n`;
- previous YTD must be the same fiscal year and period `n-1`;
- `monthlyAmount = Variance`;
- mandatory row control:

`currentYtd - previousYtd - variance = 0`

Any non-zero difference blocks the source with `RAW_TB_VARIANCE_MISMATCH`.

### January

For period 1, the implementation must support the January semantic case without inventing a `1-0` period. Preferred rule:

- current YTD = `FY yyyy 1-1`;
- monthly amount = `Variance` if provided;
- previous YTD is logically zero unless the actual January SAP fixture proves a different layout;
- require `currentYtd - variance = 0` when no previous-YTD column exists.

A real January raw fixture must be added before January is declared production-ready.

## 4.3 COA extraction

A financial TB detail row is a row whose `FS Item/Account` ends with an 8-digit account after `/`:

`/(\d{8})\s*$`

Example:

`CASH ON HAND RUPIAH  SGG /11111001` → COA `11111001`.

Rows without this terminal 8-digit pattern are not financial COA detail. Persist them as raw/non-COA summary evidence but do not map or calculate them.

This intentionally excludes rows such as `Calculated profit ... /*ERGEBNIS*`.

## 4.4 TB duplicate COA rule

Within one authoritative TB source, the same 8-digit COA must not appear more than once unless a later verified SAP fixture proves that duplicates are valid. Initial implementation must fail closed with `RAW_TB_DUPLICATE_COA`.

## 4.5 TB normalized record

Each financial row must normalize at least to:

```text
logicalSourceCode = TB
companyCode
fiscalYear
fiscalPeriod
sourceFileId
sourceSheetName
sourceRowNumber
coaCode
fsItemAccountRaw
descriptionRaw
currentYtd
previousYtd
variance
monthlyAmount
validationDifference
rawDataJson
```

All amounts are Decimal strings/full IDR.

---

# 5. Cost Center raw contract (shared parser pattern)

## 5.1 Authoritative range

For all CC SAP reports, only **columns B:K** may be read as authoritative raw SAP data.

- Column A: ignored for calculation.
- Columns L and later: ignored for calculation and source classification.
- They may be retained only as non-authoritative file snapshot metadata if needed, but must never affect financial results.

This prevents helper columns such as `CE`, `Act Amt`, `Group CE` from becoming source values.

## 5.2 Metadata detection

Within B:K, detect these labels semantically; do not rely on fixed row numbers:

- `Controlling Area`
- `Fiscal Year`
- `From Period`
- `To Period`
- `Cost Center Group`
- optionally `Plan Version`

Required validation for a monthly CC extract:

- `Fiscal Year` exists;
- `From Period` exists;
- `To Period` exists;
- `From Period == To Period`;
- year/period equals selected batch period;
- Cost Center Group resolves unambiguously to a logical source.

Multi-period CC reports are out of scope for this engine version and must be blocked.

## 5.3 Header detection

Find the leftmost financial semantic pair inside B:K:

- `Cost Elements`
- immediately associated `Act. Costs`

For the verified source this is B/C.

Do not choose the second `Cost Elements` field used with quantity columns (`Actual Qty`, `Plan Qty`, etc.).

The parser must tolerate repeated semantic header rows and skip them as layout metadata.

## 5.4 Financial detail rows

After the detected header, a detail row is a row whose financial `Cost Elements` cell begins with an 8-digit COA:

`^\s*(\d{8})(?:\s+|$)`

Normalize:

- `coaCode` = first 8 digits;
- `descriptionRaw` = remaining Cost Elements label;
- `amount` = `Act. Costs`;
- keep the complete B:K raw snapshot for audit.

A valid COA row with blank/non-numeric `Act. Costs` is an **ERROR**. Do not convert malformed amounts to zero.

Zero-valued COA rows remain audit evidence but do not require a business mapping solely because they are zero.

## 5.5 End-of-detail and controls

The first normalized control row `Debit` terminates the financial detail section.

Recognize labels after trimming spaces and leading `*` characters, including:

- `Debit`
- `Over/Underabsorption`

Rows after the first Debit must not be included as ordinary financial detail unless a future source-specific parser explicitly defines another section.

Mandatory control for a present CC source:

`SUM(detail Act. Costs) - Debit = 0`

Mismatch → `RAW_CC_DETAIL_DEBIT_MISMATCH` and calculation is blocked.

`Debit` missing → `RAW_CC_DEBIT_NOT_FOUND`.

If `Over/Underabsorption` is present in this report layout, persist it as a secondary control. For the verified 2000 fixture it equals Debit exactly. A future differing SAP layout must be reviewed before weakening this control.

## 5.6 Source classification

Source classification should be primarily content-based using `Cost Center Group`, not sheet name.

### Company 2000 verified patterns

- `SI2000_ADM` → `CC_ADUM`
- `SI2000_PSR` → `CC_PASAR`
- `SI2000_DRV` → `CC_DERIV`

`CC_PROD` must use a verified Product/Production group alias when a real source is supplied. Until then, `PROD`-style matching can exist only in an explicit registry and may not guess an unknown group silently.

Sheet-name aliases (`cc_adm`, `cc pasar`, `cc derivatif`, etc.) are secondary hints. If sheet-name hint conflicts with Cost Center Group metadata, raise `RAW_SOURCE_CLASSIFICATION_CONFLICT`.

## 5.7 CC normalized record

Each detail row must normalize at least to:

```text
logicalSourceCode
companyCode
fiscalYear
fiscalPeriod
controllingArea
costCenterGroup
sourceFileId
sourceSheetName
sourceRowNumber
coaCode
descriptionRaw
amount
rawColumnsBtoK
```

Each source must also persist source-level controls:

```text
headerRowNumber
detailRowCount
nonZeroDetailRowCount
detailTotal
debitControl
overUnderControl
reconciliationDifference
presenceStatus
```

---

# 6. Cross-source validation

Before calculation, all present authoritative sources in one batch must agree on:

- selected company context;
- fiscal year;
- fiscal period.

TB-derived period and all CC metadata periods must match exactly.

Mismatch is a batch-blocking `RAW_CROSS_SOURCE_PERIOD_MISMATCH`.

For company identification:

- selected UI company is the batch context;
- content signatures such as Cost Center Group validate that context where available;
- filename is never sufficient evidence.

---

# 7. Company 7000 shared contract

Company 7000 uses the **same TB parser** and the **same B:K Cost Center parser pattern**.

Verified historical group identifiers available for the shared registry include:

- `SGK_ADM` → `CC_ADUM`
- `SGK_PASAR` → `CC_PASAR`

Do not assume unverified group identifiers for `CC_PROD`, `CC_WHRPG`, or other CC sources. Add them only from real raw fixtures or already verified production evidence.

Company 7000 has additional authoritative supporting sources for HPP/OA/etc. Those sources remain part of the required Engine 1 calculation, but their exact raw-column contracts are **not to be guessed from processed workbook helper sheets**. Each extra source gets a source-specific adapter when its raw SAP/support fixture is verified.

Known logical supporting source families already used by the system include:

- `CC_WHRPG`
- `COAL`
- `CLINKER_PURCHASE`
- `SOLAR_PP_ORDER`
- `OA_STAT`

The new engine may reuse verified business formulas, but `rincian biaya`/`GHoPO` must ultimately be generated outputs rather than mandatory monthly input sheets.

---

# 8. Parsing and numeric rules

- COA always stored as text, preserving leading zero if ever present.
- Full IDR is authoritative storage unit.
- Use Decimal/NUMERIC end-to-end.
- Accept native Excel numeric values and validated numeric text forms.
- Parentheses/trailing-minus formats may represent negatives when explicitly parsed.
- Invalid nonblank numeric text is an error.
- Never use `IFERROR(...,0)` semantics.
- Blank mandatory financial amount is an error.
- Exact zero is valid and remains in raw lineage.
- Parser must not depend on cached helper formulas for financial authority.

---

# 9. Minimum validation issue codes

The new raw parser should expose stable, testable issue codes at minimum:

```text
RAW_SOURCE_REQUIRED_MISSING
RAW_SOURCE_AMBIGUOUS
RAW_SOURCE_CLASSIFICATION_CONFLICT
RAW_TB_HEADER_NOT_FOUND
RAW_TB_PERIOD_COLUMNS_INVALID
RAW_TB_DUPLICATE_COA
RAW_TB_INVALID_AMOUNT
RAW_TB_VARIANCE_MISMATCH
RAW_CC_METADATA_NOT_FOUND
RAW_CC_GROUP_UNKNOWN
RAW_CC_PERIOD_RANGE_INVALID
RAW_CC_HEADER_NOT_FOUND
RAW_CC_INVALID_AMOUNT
RAW_CC_DEBIT_NOT_FOUND
RAW_CC_DETAIL_DEBIT_MISMATCH
RAW_CROSS_SOURCE_PERIOD_MISMATCH
RAW_OPTIONAL_SOURCE_ABSENT_ZERO   (INFO)
```

Financial blockers are ERROR severity. Optional absent-zero is INFO, not WARNING/ERROR.

---

# 10. Verified Company 2000 private fixture — August 2026

Fixture file:

`TB Extract - 2000 - 26-08.xlsx`

SHA-256:

`b656068151a84264fa4be628ba4f725fd23c96061bd82a6073bc47f82d960a44`

**Do not commit the raw workbook to the public repository.** Use synthetic unit fixtures in Git and keep this file/private equivalent only for private integration/golden verification.

## TB verified assertions

- detected fiscal year = 2026
- detected fiscal period = 8
- financial COA detail rows = **502**
- non-COA summary rows before financial detail classification = **2** (`Calculated profit` rows)
- unique financial COAs = **502**
- duplicate financial COAs = **0**
- `currentYtd - previousYtd - Variance = 0` for **502/502** financial COA rows
- maximum absolute variance-control difference = **0**

## CC PASAR verified assertions

- Cost Center Group = `SI2000_PSR`
- period = 2026/08
- header row observed = 13 (parser must not hard-code)
- detail rows = **63**
- non-zero detail rows = **54**
- detail total = **15,599,456,666 IDR**
- Debit = **15,599,456,666 IDR**
- reconciliation difference = **0**

## CC ADUM verified assertions

- Cost Center Group = `SI2000_ADM`
- period = 2026/08
- header row observed = 13 (parser must not hard-code)
- detail rows = **138**
- non-zero detail rows = **91**
- detail total = **202,328,795,213 IDR**
- Debit = **202,328,795,213 IDR**
- reconciliation difference = **0**
- observed helper columns L:N (`CE`, `Act Amt`, `Group CE`) are non-authoritative and must be ignored

## CC Derivatif verified assertions

- Cost Center Group = `SI2000_DRV`
- period = 2026/08
- detail rows = **36**
- non-zero detail rows = **33**
- detail total = **3,460,258,896 IDR**
- Debit = **3,460,258,896 IDR**
- reconciliation difference = **0**

## CC PROD verified absence behavior

- no CC PROD sheet/source is present in this fixture
- Company 2000 raw contract result must be `CC_PROD = ABSENT_TREATED_AS_ZERO`
- absence must not block parsing/reconciliation

---

# 11. Stage A acceptance gate

Stage A is considered complete when the implementation plan treats the following as immutable unless new source evidence requires an explicit contract revision:

1. TB financial monthly amount is based on the semantic `Variance` column and is validated against current/previous YTD.
2. TB COA comes from terminal `/########` in `FS Item/Account`.
3. CC financial source boundary is columns B:K only.
4. CC financial amount comes from the semantic `Act. Costs` paired with the financial `Cost Elements` column.
5. Source classification is content-first using Cost Center Group.
6. Required ADUM/PASAR fail closed if absent/malformed.
7. Company 2000 CC_PROD and CC_DERIV use explicit optional-zero semantics.
8. Present malformed optional source is never silently treated as zero.
9. Detail-to-Debit reconciliation is mandatory for every present CC source.
10. All sources must match one company/year/period batch.
11. Helper/calculated sheets are not authoritative raw inputs.
12. Existing production Engine 1/menu remains untouched while Raw V2 is developed.

---

# 12. Controlled open items (do not block Stage B/C for Company 2000)

These are not assumptions to be coded silently:

1. Real Company 2000 `CC_PROD` raw Cost Center Group identifier — not needed for current 08/2026 fixture because absence = zero.
2. Real January TB layout — requires one January raw fixture before January production certification.
3. Exact raw contracts/group identifiers for Company 7000 extra supporting sources — lock per verified raw fixture, not processed helper columns.

These open items do not change the locked shared TB/CC parsing rules above.
