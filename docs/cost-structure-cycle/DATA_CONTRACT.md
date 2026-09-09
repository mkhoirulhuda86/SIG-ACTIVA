# Update Cycle SAP — Data Contract

## 1. Canonical codes

```text
FIXED    = 7FT1GF
VARIABLE = 7VT1GF
```

Do not infer Fixed/Variable from Cost Element Group names. Cycle code is authoritative.

## 2. Canonical source row

The parser should normalize every supported source row into a deterministic server-side shape equivalent to:

```ts
type CycleCode = '7FT1GF' | '7VT1GF';

type CycleSourceRow = {
  sourceRowNumber: number;
  sourceOrder: number;
  cycle: CycleCode;
  startDate: string;        // normalized date representation, preserve value on output
  segmentName: string;      // identifier, preserve textual identity
  receiverCc: string;       // identifier, never numeric DB identity
  portion: number;
  raw?: Record<string, unknown>;
};
```

Receiver CC and Segment name are identifiers and must be normalized as strings. Excel numeric rendering must not introduce `.0` suffixes or scientific notation.

`sourceOrder` is retained so generated delta files can preserve baseline row order.

## 3. Uniqueness key

For supported source rows:

```text
Cycle + Segment name + Receiver CC
```

must be unique within one active upload.

Duplicate key is a blocking error.

## 4. Receiver baseline aggregate

Canonical CC-level aggregate:

```ts
type CycleReceiverBaseline = {
  receiverCc: string;
  plantCode: string;
  plantName: string;
  processCode: string;
  processLabel: string;
  displayOrder: number;
  fixedRowCount: number;
  variableRowCount: number;
  fixedNonZeroRowCount: number;
  variableNonZeroRowCount: number;
  baselineStatus: 'ON' | 'OFF';
};
```

Status is derived across both cycles:

```text
baselineStatus = ON if fixedNonZeroRowCount + variableNonZeroRowCount > 0
otherwise OFF
```

## 5. Target change request

UI/API change intent is CC-level only:

```ts
type CycleTargetChange = {
  receiverCc: string;
  targetStatus: 'ON' | 'OFF';
  selectedReferenceCc?: string;
};
```

The server must rederive baseline status and reference validity from persisted current upload data. Never trust baseline status or reference eligibility supplied by the browser.

## 6. Reference configuration

Suggested service contract:

```ts
type CycleReferenceConfig = {
  receiverCc: string;
  peerGroup: string;
  preferredReferenceCc?: string;
  fallbackReferenceCcs: string[];
  confidence: 'Validated' | 'High' | 'Medium' | 'Manual';
  reviewStatus: 'VALIDATED' | 'PROPOSED' | 'MANUAL_REQUIRED';
  active: boolean;
};
```

Database implementation may use rows/priority instead of array fields, but API behavior must preserve deterministic priority.

## 7. Resolved action

```ts
type CycleResolvedAction = {
  receiverCc: string;
  baselineStatus: 'ON' | 'OFF';
  targetStatus: 'ON' | 'OFF';
  action: 'NO_CHANGE' | 'TURN_OFF' | 'TURN_ON';
  referenceCc?: string;
  referenceSource?: 'PREFERRED' | 'FALLBACK_1' | 'FALLBACK_2' | 'USER_SELECTED';
  fixedAffectedRows: number;
  variableAffectedRows: number;
};
```

Only `TURN_OFF` and `TURN_ON` contribute export rows.

## 8. Delta row

Output row contract:

```ts
type CycleDeltaRow = {
  cycle: CycleCode;
  startDate: string;
  segmentName: string;
  receiverCc: string;
  portion: number;
  sourceOrder: number;
};
```

For TURN_OFF, `portion = 0`.

For TURN_ON, only `portion` is copied from the resolved reference row. The other fields come from the target baseline row.

## 9. Validation issue

```ts
type CycleIssueSeverity = 'INFO' | 'WARNING' | 'ERROR';

type CycleValidationIssue = {
  code: string;
  severity: CycleIssueSeverity;
  message: string;
  receiverCc?: string;
  cycle?: CycleCode;
  segmentName?: string;
  sourceRowNumber?: number;
  metadata?: Record<string, unknown>;
};
```

Recommended issue codes:

```text
WORKBOOK_UNREADABLE
MISSING_REQUIRED_COLUMN
MISSING_FIXED_CYCLE
MISSING_VARIABLE_CYCLE
UNEXPECTED_CYCLE
INVALID_PORTION
DUPLICATE_TARGET_KEY
UNMAPPED_RECEIVER_CC
REFERENCE_NOT_CONFIGURED
REFERENCE_NOT_IN_UPLOAD
REFERENCE_NOT_ACTIVE
REFERENCE_SELF
REFERENCE_SEGMENT_MISSING
REFERENCE_EXTRA_SEGMENT
REFERENCE_FALLBACK_USED
REFERENCE_MAPPING_PROPOSED
NEGATIVE_PORTION
```

## 10. Upload/session metadata

One target fiscal period can have versioned cycle uploads/runs.

Suggested API metadata:

```ts
type CyclePeriodIdentity = {
  fiscalYear: number;
  fiscalPeriod: number; // 1..12
};
```

No company field is required by current business scope. Do not invent a company dependency unless later source evidence requires it.

Suggested statuses:

```text
DRAFT
UPLOADED
VALIDATED
CHANGES_PREPARED
GENERATED
INVALID
SUPERSEDED
```

Exact DB enum split may differ, but generated history must remain versioned and auditable.

## 11. Input workbook contract

Expected data sheet in the August reference is `Sheet1`, but parser implementation should detect the required header set rather than depend only on sheet name.

Required headers, case/whitespace normalized:

```text
Cycle
Start Date
Segment name
Receiver CC
Portion/Percent
```

Additional SAP columns are allowed and may be retained in raw JSON.

The parser must not evaluate macros or execute formulas. It reads stored workbook values.

## 12. Export contract

For each generated workbook:

```text
Sheet name: Lembar1
```

Header row exactly:

```text
Cycle | Start Date | Segment name | Receiver CC | Portion/Percent
```

Fixed workbook contains only `7FT1GF` delta rows.
Variable workbook contains only `7VT1GF` delta rows.

Preserve identifiers as values that render exactly like the SAP template. Preserve `Start Date` semantically and format it compatibly with the reference workbook.

## 13. Verified August reference metrics

Use these as non-secret structural regression assertions where useful:

```text
Total data rows            13,913
7FT1GF rows                 7,090
7VT1GF rows                 6,823
Unique Receiver CC             45
Master production CC           59
Validated FM2 Tuban II fixed delta rows      220
Validated FM2 Tuban II variable delta rows   214
```

Private row-level workbook data must not be committed.

## 14. Golden case contract

Synthetic automated fixtures must cover the same semantics as the real validated case:

```text
Target CC:    7203311054
Reference CC: 7203311053
Baseline:     target OFF, reference ON
Action:       target OFF → ON
Expected:     every target Cycle+Segment copies reference portion
              target Receiver CC remains 7203311054
              target Start Date remains target baseline Start Date
              fixed and variable exports are separated
```

A local/private E2E harness may additionally accept paths to the three real files:

```text
cycle 08.26.xlsx
Fix Cost Agt 26.xlsx
Var Cost Agt 26.xlsx
```

The harness must compare semantic cell values/row identity, not workbook binary bytes.