# Update Cycle SAP — Business Rules

## 1. Scope

The module prepares monthly SAP cycle delta files for two allocation cycles:

```text
7FT1GF = Fixed Cost
7VT1GF = Variable Cost
```

The source is one latest SAP cycle workbook uploaded each month. The source contains both cycles together.

The module does not post directly to SAP. It generates two Excel files ready for the user's existing SAP upload process.

## 2. Monthly baseline

The uploaded cycle workbook is the authoritative baseline for the target update session.

Do not reconstruct the baseline from prior SIG ACTIVA history. Historical records are audit evidence only.

The application target fiscal year/period is metadata. SAP `Start Date` must be preserved from the corresponding baseline target row and must not be replaced by the reporting month.

## 3. One toggle per Receiver CC

The user interface exposes exactly one target status toggle for each Receiver CC present in the uploaded cycle and found in the active CC master.

Never create a toggle per Segment.

A toggle change applies to all rows for that Receiver CC across both supported cycles.

## 4. Baseline status derivation

For one Receiver CC, collect all its rows from both `7FT1GF` and `7VT1GF`.

```text
OFF = every Portion/Percent value across both cycles is zero
ON  = at least one Portion/Percent value across either cycle is non-zero
```

Do not determine status independently per Fixed/Variable cycle.

This rule is required because a valid active Receiver CC may have non-zero Fixed rows while every Variable row is zero.

## 5. No-change behavior

```text
ON  → ON  = no delta
OFF → OFF = no delta
```

No output rows are generated when final target status equals baseline status.

If a user toggles a CC and then returns it to the baseline status before generation, the change disappears from the delta.

## 6. ON to OFF

For target Receiver CC changed from ON to OFF:

- use every baseline row belonging to that Receiver CC for each supported cycle;
- preserve Cycle, Start Date, Segment name and Receiver CC;
- set `Portion/Percent = 0`;
- include all those rows in the appropriate Fixed/Variable delta workbook.

There is no redistribution or normalization to other Receiver CCs.

## 7. OFF to ON

For target Receiver CC changed from OFF to ON:

1. resolve its configured preferred reference CC;
2. if preferred reference cannot be used, evaluate configured fallbacks in order;
3. if no usable configured reference exists, block generation and require manual/master resolution;
4. process Fixed and Variable independently while keeping one CC-level toggle;
5. use the target CC baseline rows as the output skeleton;
6. for each target row, find the reference row by exact:

```text
Cycle + Segment name + Reference Receiver CC
```

7. copy only the reference `Portion/Percent` to the target output row;
8. preserve target Cycle, target Start Date, target Segment name and target Receiver CC.

Do not automatically use the target CC's historical pre-OFF pattern.

## 8. Reference usability

A reference CC is usable when:

- it exists in the current uploaded cycle;
- its derived baseline status is ON;
- it is not the same Receiver CC as the target;
- every target row required for copying has an exact reference row for the same Cycle + Segment name;
- reference portion values are valid numeric values.

A Variable cycle whose reference rows are all zero is not automatically invalid. Zero can be a valid pattern for an active CC. Usability is based on the overall CC status and exact row/segment coverage, not a requirement that every supported cycle has a non-zero portion.

## 9. Segment mismatch

For OFF → ON, target rows are authoritative for what must be updated.

- target segment missing in reference = blocking error;
- extra segment existing only in reference = warning/audit information; do not invent an extra target row;
- duplicate `Cycle + Segment name + Receiver CC` source key = blocking error.

## 10. Supported source rows

Required source columns:

```text
Cycle
Start Date
Segment name
Receiver CC
Portion/Percent
```

The real SAP extract may contain additional columns such as Text, Sender CostC, Cost Element Group, Set identification and receiver-rule descriptions. They may be persisted for audit but are not required in the generated upload file.

Both supported cycle codes must exist in the uploaded workbook. Unexpected cycle codes are blocking for the MVP so an unrelated SAP cycle workbook cannot be processed accidentally.

## 11. Panel population

The persistent CC master contains 59 production Cost Centers from the supplied mapping.

For a monthly panel:

- include only master CCs that are present as Receiver CC in the uploaded cycle;
- group by Plant Code;
- order plants by Plant Code;
- order CCs within plant by configured process display order;
- display the process/equipment label, Receiver CC, description, baseline status and target toggle;
- do not display individual segments on the main panel.

Segment detail may be exposed only in a preview/audit drill-down.

## 12. Process order

Baseline process sequence for production plants:

```text
Crusher BK
Crusher TL
Raw Meal
Fine Coal
Fine Coal - New Coal Mill when applicable
Kiln
Finish Mill
WHRPG when applicable
Packer / Packing
Distribution / GP
```

Master `display_order` is authoritative for UI ordering.

## 13. Reference master governance

`REFERENCE_MAPPING.csv` is an implementation seed/proposal, not proof that every pair has been business-approved.

Reference records carry review status:

- `VALIDATED`: proven by actual business output;
- `PROPOSED`: usable only according to the application's approved master governance; before production use the Admin screen must allow review/update;
- `MANUAL_REQUIRED`: no automatic reference exists and generation must fail closed until Admin configures one.

The validated starting case is:

```text
Target    7203311054  Finish Mill 2 Tuban II
Reference 7203311053  Finish Mill 1 Tuban II
```

## 14. Delta output

Generate only Receiver CCs whose target status differs from baseline.

Split rows by cycle:

```text
7FT1GF → Fix Cost <period>.xlsx
7VT1GF → Var Cost <period>.xlsx
```

One workbook sheet named `Lembar1`.

Exact columns and order:

```text
Cycle
Start Date
Segment name
Receiver CC
Portion/Percent
```

Preserve target-row ordering from the uploaded cycle for deterministic output. Do not arbitrarily re-sort segment rows unless a later validated SAP template explicitly requires it.

Suggested Indonesian file-name month abbreviations:

```text
Jan Feb Mar Apr Mei Jun Jul Agt Sep Okt Nov Des
```

Example:

```text
Fix Cost Agt 26.xlsx
Var Cost Agt 26.xlsx
```

## 15. Preview and controls

Before export show a CC-level change summary:

```text
Plant Code
Plant
Process/Equipment
Receiver CC
Baseline Status
Target Status
Action
Reference Used when OFF→ON
Fixed affected row count
Variable affected row count
```

Segment-level diff is optional audit detail and is read-only.

## 16. Blocking validation

At minimum block generation for:

- unreadable/unsupported workbook;
- missing required columns;
- missing `7FT1GF` or `7VT1GF`;
- unexpected cycle code in MVP;
- non-numeric required portion;
- duplicate Cycle + Segment + Receiver CC;
- Receiver CC present in cycle but absent from active master;
- OFF→ON without a usable reference;
- OFF→ON target segment missing from chosen reference;
- persistence/integrity failure.

Warnings may include:

- master CC absent from this month's cycle;
- extra segment on reference not present on target;
- unusual/negative portion pending business review;
- use of fallback reference;
- use of reference mapping that is still marked PROPOSED.

Warnings remain visible in preview/audit history.

## 17. Audit/history

Persist enough information to reproduce the decision trail:

- target fiscal year/period;
- original source file identity/hash/version;
- uploader/time;
- source row counts and supported-cycle counts;
- baseline CC status;
- requested target status;
- reference/fallback actually used;
- validation issues;
- affected row counts;
- generated export identity/hash/time;
- user who generated the files.

Do not let history silently mutate an already-generated monthly result. A replacement/re-run should create a new version/run record.