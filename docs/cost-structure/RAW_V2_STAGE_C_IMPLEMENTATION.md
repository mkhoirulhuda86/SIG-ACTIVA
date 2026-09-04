# SIG ACTIVA — Raw V2 Stage C Implementation

## Status
IMPLEMENTATION TASK for the isolated Raw SAP engine. This document supplements, but does not replace, `docs/cost-structure/RAW_SAP_INPUT_CONTRACT_ENGINE1_V2.md`, which remains the locked business/technical source contract.

## Objective
Implement Company 2000 raw SAP ingestion through parser, normalization, reconciliation, and isolated persistence. Do not implement mapping, cost-nature calculation, Rincian Biaya, SI, GHoPO, Engine 2, or export.

Stage C ends at:

`raw workbook -> source detection -> normalized TB/CC rows -> source controls -> cross-source validation -> persisted Raw V2 upload`.

Existing Cost Structure upload/parser/calculation/export behavior must remain unchanged.

## Scope

### Input
One `.xlsx/.xlsm` workbook may contain multiple source sheets. Stage C Company 2000 supports:

- `TB` — required
- `CC_ADUM` — required
- `CC_PASAR` — required
- `CC_PROD` — optional-zero
- `CC_DERIV` — optional-zero

Filename and worksheet names are only hints. Content is authoritative.

### New source-level persistence
Add a dedicated Raw V2 source-summary model/table, e.g. `CostRawV2Source` / `cost_raw_v2_sources`, related to `CostRawV2Upload`.

Minimum fields/concepts:

- uploadId
- logicalSourceCode
- originalSheetName nullable for absent optional source
- presenceStatus (`PRESENT`, `ABSENT_TREATED_AS_ZERO` or equivalent enum/string)
- companyCode
- fiscalYear nullable until detected
- fiscalPeriod nullable until detected
- controllingArea nullable
- costCenterGroup nullable
- headerRowNumber nullable
- detailRowCount
- nonZeroDetailRowCount
- detailTotal Decimal nullable
- debitControl Decimal nullable
- overUnderControl Decimal nullable
- reconciliationDifference Decimal nullable
- metadataJson nullable
- createdAt / updatedAt

Enforce one source-summary record per `(uploadId, logicalSourceCode)`.

Do not create fabricated `CostRawV2SourceRow` records for an absent optional source.

### TB parser
Implement an isolated parser under `lib/cost-structure/raw-v2/parsers/`.

Required behavior is locked by Stage A:

- detect `FS Item/Account`
- detect current YTD header `FY yyyy 1-n`
- detect previous YTD `FY yyyy 1-(n-1)` for periods 2–12
- detect `Variance`
- normalize whitespace before matching
- extract terminal COA via `/(\d{8})\s*$/`
- financial monthly amount = `Variance`
- validate exactly with Decimal: `currentYtd - previousYtd - variance = 0`
- duplicate financial COA => `RAW_TB_DUPLICATE_COA` ERROR
- malformed mandatory amount => `RAW_TB_INVALID_AMOUNT` ERROR
- header/period errors use locked issue codes
- preserve non-COA summary rows as raw lineage but do not treat them as financial detail
- do not depend on fixed row/column locations
- January support may be coded per Stage A but January is not declared production-ready without a real fixture

### CC parser
Implement one shared raw CC parser for the B:K authoritative region only.

Hard boundary:

- financial classification and amounts may inspect only columns B:K
- column A and L onward must never influence source classification, COA, description, amount, period, or reconciliation

Detect semantic metadata within B:K:

- Controlling Area
- Fiscal Year
- From Period
- To Period
- Cost Center Group
- optional Plan Version

Monthly source requires `From Period == To Period`.

Detect the financial header pair:

- leftmost authoritative `Cost Elements`
- associated `Act. Costs`

Detail COA regex:

`^\s*(\d{8})(?:\s+|$)`

Stop ordinary detail at first normalized `Debit` control row. Recognize leading `*` characters. Persist optional `Over/Underabsorption` as secondary control.

Mandatory reconciliation:

`SUM(detail Act. Costs) - Debit = 0` using Decimal.

Missing Debit => `RAW_CC_DEBIT_NOT_FOUND`.

Mismatch => `RAW_CC_DETAIL_DEBIT_MISMATCH`.

Repeated SAP header rows inside the data section must be skipped, not parsed as COA rows.

### Company 2000 CC source registry
Content-first registry:

- `SI2000_ADM` => `CC_ADUM`
- `SI2000_PSR` => `CC_PASAR`
- `SI2000_DRV` => `CC_DERIV`

Do not guess an unknown CC group.

`CC_PROD` remains optional-zero until a verified production group alias is available. A sheet-name hint that conflicts with Cost Center Group must produce `RAW_SOURCE_CLASSIFICATION_CONFLICT`.

### Batch/source detection
Detection must inspect worksheet content, not only sheet names.

Rules:

- duplicate source resolution => `RAW_SOURCE_AMBIGUOUS` ERROR
- missing required source => `RAW_SOURCE_REQUIRED_MISSING` ERROR
- absent `CC_PROD` => INFO `RAW_OPTIONAL_SOURCE_ABSENT_ZERO`
- absent `CC_DERIV` => INFO `RAW_OPTIONAL_SOURCE_ABSENT_ZERO`
- present malformed optional source => ERROR, never zero

### Cross-source period validation
Selected upload context is company + fiscal year + fiscal period.

Every present authoritative source must match it.

TB-derived period and all present CC metadata periods must agree exactly.

Mismatch => `RAW_CROSS_SOURCE_PERIOD_MISMATCH` ERROR.

A raw August file selected as September must therefore fail validation and never become a valid active upload.

## Numeric rules

- use Decimal/Prisma Decimal for authoritative arithmetic/persistence
- no JavaScript binary floating point for financial equality/reconciliation
- full IDR is the storage unit
- accept native Excel numeric values and explicitly validated numeric text
- blank mandatory amount is an error
- invalid nonblank amount is an error
- exact zero is valid
- no `IFERROR -> 0` behavior

## Parser result boundary
Define Raw-V2-specific parse types. Do not reuse legacy `ParsedWorkbook` if doing so couples the parser to legacy source semantics.

Recommended conceptual result:

```ts
RawV2ParsedWorkbook {
  detectedPeriod?: { fiscalYear: number; fiscalPeriod: number };
  sources: RawV2ParsedSource[];
  rows: RawV2ParsedRow[];
  issues: RawV2ParserIssue[];
}
```

Each row retains original sheet + row number + raw snapshot. CC raw snapshot must represent authoritative B:K values.

## Upload integration

Implement isolated Raw V2 endpoints under:

- `POST /api/cost-structure/raw-v2/uploads/init`
- `POST /api/cost-structure/raw-v2/uploads/complete`
- `GET /api/cost-structure/raw-v2/uploads` (recommended for UI/history)

Use the existing Cost Structure authorization boundary (`requireCostStructurePrepare` for writes, read auth for listing).

Storage client may be reused, but storage keys/tokens must be Raw-V2-specific and must never call legacy upload persistence/lifecycle APIs.

Do not write:

- `CostPeriod`
- `CostUpload`
- `CostSourceRow`
- `CostValidationIssue`
- `CostCalculationRun`
- `CostPeriod.activeCalculationRunId`

Persist only `CostRawV2*` transaction models.

On successful completion, persist atomically:

- Raw V2 period/workspace
- upload/version/hash
- source summaries
- normalized/raw rows
- validation issues

Activation rules:

- validation errors may be persisted as an invalid/validation-failed upload for diagnostics
- an invalid upload must not supersede the previous valid active upload
- a valid upload may supersede the previous active Raw V2 upload atomically
- preserve the Stage B DB invariant of at most one active Raw V2 upload per period

If Stage B enum lacks a useful validation-failed status, add an additive enum/migration change rather than abusing an unrelated status.

## Stage C capability state

After implementation:

- `uploadEnabled = true` only if the upload UI/API is actually wired and safe
- `calculationEnabled = false`
- `exportEnabled = false`
- phase should move from `B_SKELETON` to a clear Stage C identifier such as `C_RAW_INGESTION`

Do not claim calculation readiness.

## Upload UI
Replace the Stage B placeholder with a functional Raw V2 upload screen that requires:

- company (initially 2000 functional; 7000 may be visible as not yet fully supported)
- fiscal year
- fiscal period
- raw workbook

Show parser result clearly:

- detected sources
- source presence status
- detected period
- detail row counts
- Debit/control reconciliation
- issues grouped by ERROR/WARNING/INFO
- whether the upload became the active valid Raw V2 version

Do not expose calculation/export actions yet.

## Tests
Use synthetic workbooks generated in tests with `xlsx`; do not commit private SAP files.

Minimum tests:

### TB
- valid period 8 current/prior/variance
- whitespace variants in FY header
- 8-digit terminal COA extraction
- summary/non-COA row preservation
- duplicate COA fails
- variance mismatch fails
- invalid amount fails
- missing required header fails
- wrong selected period fails through batch validation
- January semantic unit test (not production-readiness claim)

### CC
- classify `SI2000_ADM`, `SI2000_PSR`, `SI2000_DRV`
- ignore columns L+ even if they contain tempting helper headers/values
- detect metadata without fixed row numbers
- parse leftmost `Cost Elements` + `Act. Costs`
- skip repeated semantic header
- stop at Debit
- exact detail-to-Debit reconciliation
- missing Debit fails
- Debit mismatch fails
- From != To fails
- unknown group fails closed
- sheet-name/group conflict fails

### Batch
- required source missing fails
- duplicate logical source fails
- absent PROD => optional-zero INFO/source summary
- absent DERIV => optional-zero INFO/source summary
- present malformed DERIV => ERROR, not zero
- TB/CC period mismatch fails
- selected period mismatch fails

### Persistence/API
- invalid upload is persisted for diagnostics but does not replace previous valid active version
- valid replacement supersedes prior valid active version atomically
- duplicate hash detection remains period-scoped
- no writes to legacy transaction tables
- auth required
- calculation/export capabilities remain false

## Private August 2026 acceptance baseline
The real SAP workbook remains private and must not be committed. Its locked assertions from Stage A are the manual/private integration benchmark:

- TB: fiscal 2026/08, 502 unique financial COAs, 502/502 variance controls exact
- CC PASAR: `SI2000_PSR`, 63 detail rows, 54 non-zero, total/Debit 15,599,456,666 IDR
- CC ADUM: `SI2000_ADM`, 138 detail rows, 91 non-zero, total/Debit 202,328,795,213 IDR
- CC DERIV: `SI2000_DRV`, 36 detail rows, 33 non-zero, total/Debit 3,460,258,896 IDR
- CC PROD absent => `ABSENT_TREATED_AS_ZERO`

Do not hard-code these amounts into production parser logic.

## Non-goals
Stage C must not implement:

- mapping/nature resolution
- Company 2000 analytical corrections
- Derivative overlay calculation
- Rincian Biaya generation
- SI generation
- Company 7000 supporting-source adapters
- HPP/OA formulas
- workbook export
- finalization
- Engine 2 changes

## Validation before PR
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

Review `git diff main...HEAD` and explicitly confirm no legacy parser/calculation/export/upload lifecycle behavior changed.

Do not apply migrations to production Supabase and do not merge the PR.
