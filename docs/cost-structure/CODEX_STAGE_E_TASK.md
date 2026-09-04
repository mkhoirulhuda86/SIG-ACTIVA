# Codex Task — Raw V2 Stage E Company 2000

Implement Stage E exactly according to:

- `docs/cost-structure/RAW_V2_STAGE_E_IMPLEMENTATION.md`
- `docs/cost-structure/RAW_V2_STAGE_D_IMPLEMENTATION.md`
- `docs/cost-structure/RAW_SAP_INPUT_CONTRACT_ENGINE1_V2.md`
- `docs/cost-structure-fluctuation/BUSINESS_RULES.md`
- `docs/cost-structure-fluctuation/CALCULATION_RULES.md`

Also inspect and reuse only validated business logic from:

- `lib/cost-structure/calculations/company-2000.ts`
- `lib/cost-structure/calculations/company-2000-si-adapter.ts`
- `lib/cost-structure/mappings/effective-mapping.ts`

## Required implementation

1. Company 2000 only.
2. Keep all runtime code isolated under Raw V2 namespaces.
3. Read existing mapping master as read-only configuration; do not write legacy mapping or transaction tables.
4. Effective mapping date = first day of fiscal period.
5. Mapping source identity:
   - CC_ADUM -> CC_ADUM mapping
   - CC_PASAR -> CC_PASAR mapping
   - CC_DERIV -> CC_PASAR mapping
   - Rincian ADUM Delta -> CC_ADUM mapping
6. Implement locked Rincian formula per COA:
```text
rawAdum      = SUM(CC_ADUM)
rawPasar     = SUM(CC_PASAR)
tbAmount     = TB
rincianPasar = rawPasar
rincianAdum  = tbAmount - rawPasar
adumDelta    = tbAmount - rawAdum - rawPasar
pasarDelta   = 0
```
7. Do not hard-code any COA or amount.
8. Stage D FAIL is allowed as Stage E input only when missing TB = 0, DERIV PASAR coverage missing = 0, source controls pass, and differences are handled explicitly by the Rincian rule. Never alter Stage D history.
9. Non-zero mapping rules:
   - exactly one effective mapping/disposition required;
   - INCLUDE contributes;
   - EXCLUDE is retained as evidence and contributes zero;
   - RECLASS contributes only to explicit target and preserves action/reason;
   - missing/ambiguous/invalid target blocks;
   - zero-only unmapped rows may be non-blocking.
10. DERIV is already inside PASAR raw. Use PASAR mapping and apply only as negative SI overlay for INCLUDE/RECLASS:
```text
finalPasar = mappedRawPasar - mappedContributingDeriv
```
EXCLUDE DERIV must not reduce SI.
11. Final SI:
```text
finalAdum    = mappedRawAdum + mappedRincianAdumDelta
finalPasar   = mappedRawPasar - mappedContributingDeriv
finalCompany = finalAdum + finalPasar
```
12. Populate `CostRawV2AnalyticalRow` only after mapping. Extend it additively as required for immutable mapping/source lineage.
13. Persist authoritative Nature/Group/Company/control results server-side in new isolated Raw V2 model(s); do not rely on React aggregation.
14. Snapshot exact mappings and rule identities in `mappingSnapshotJson` before authoritative result persistence.
15. Stage E run lifecycle:
   - new inactive run first;
   - FAIL stays inactive and cannot replace prior SUCCESS;
   - SUCCESS atomically becomes sole active Raw V2 run and sets only Raw V2 period to CALCULATED;
   - no finalization.
16. Add protected isolated API, preferably:
   - POST `/api/cost-structure/raw-v2/si/calculate`
   - GET `/api/cost-structure/raw-v2/si`
17. Extend Raw V2 UI with mapping coverage, Rincian correction, DERIV include/exclude/offset, Nature detail, final SI totals, blocking issues, and lineage.
18. Keep export disabled.

## August 2026 acceptance evidence

Do not hard-code these values in runtime. Use only for post-implementation acceptance:

```text
CC_ADUM non-zero 91: INCLUDE 84, EXCLUDE 7, unmapped/ambiguous 0
CC_PASAR non-zero 54: INCLUDE 52, EXCLUDE 2, unmapped/ambiguous 0
CC_DERIV non-zero 33: PASAR INCLUDE 31, PASAR EXCLUDE 2, unmapped/ambiguous 0

Stage D: 142 unique CC COAs, 142 in TB, 141 exact, 1 mismatch
62140001 CC-TB = -3,802
Rincian ADUM Delta = +3,802

Mapped Raw ADUM      147,739,445,941
Rincian ADUM Delta             3,802
Final ADUM           147,739,449,743
Mapped Raw PASAR      15,538,582,759
Included DERIV        3,448,504,987
Final PASAR           12,090,077,772
Final Company SI     159,829,527,515
```

All Nature-level Stage E results for August must equal active legacy `ENGINE1_2000_V2` results with zero difference.

## Tests

Synthetic fixtures only. Must cover at minimum:

- effective mapping boundary;
- missing/ambiguous mapping fail;
- INCLUDE/EXCLUDE/RECLASS semantics;
- zero unmapped non-blocking;
- Rincian formulas;
- non-zero Stage D difference becoming explicit ADUM Delta;
- missing TB fail;
- ADUM Delta mapping requirement;
- DERIV uses PASAR mapping;
- DERIV negative sign and no double count;
- excluded DERIV does not reduce SI;
- mapping completeness equality;
- Nature -> Group -> Company roll-up;
- failed run activation safety;
- successful rerun sole-active behavior;
- deterministic mapping snapshot;
- no legacy writes;
- Decimal-only arithmetic.

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

Open PR:

`feat(cost): add Raw V2 Stage E mapping Rincian and SI`

Do not merge the PR. Do not apply any Stage E migration to production. Report PR number, migration, changed files, formulas, snapshot design, activation safety, checks, and limitations.