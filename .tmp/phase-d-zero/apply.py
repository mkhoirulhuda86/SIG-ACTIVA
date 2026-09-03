from pathlib import Path

# 1. Exact-zero mapping evidence must not create unresolved warnings.
service = Path('lib/cost-structure/reconciliation/service.ts')
s = service.read_text()
old = """        if (mappings.length > 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_AMBIGUOUS', 'ERROR', 'Lebih dari satu mapping efektif.');
        } else if (mappings.length === 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_TARGET_INVALID', 'ERROR', 'Target mapping tidak lagi aktif/valid atau bukan Nature MAPPED.');
        } else {
          setMappingIssue(
            desiredIssues,
            firstRowId,
            context,
            'UNMAPPED_COA',
            isBlocking ? 'ERROR' : 'WARNING',
            isBlocking
              ? 'COA belum memiliki disposition eksplisit.'
              : 'COA belum memiliki disposition, tetapi total absolut <= Rp1 sehingga non-blocking (de minimis).'
          );
        }
"""
new = """        if (mappings.length > 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_AMBIGUOUS', 'ERROR', 'Lebih dari satu mapping efektif.');
        } else if (mappings.length === 1) {
          setMappingIssue(desiredIssues, firstRowId, context, 'MAPPING_TARGET_INVALID', 'ERROR', 'Target mapping tidak lagi aktif/valid atau bukan Nature MAPPED.');
        } else if (totalAmount.isZero()) {
          // Exact-zero COAs remain visible in source-row audit evidence but do not
          // represent an unresolved business decision and must not create an open issue.
          setMappingIssue(desiredIssues, firstRowId, context, null);
        } else {
          setMappingIssue(
            desiredIssues,
            firstRowId,
            context,
            'UNMAPPED_COA',
            isBlocking ? 'ERROR' : 'WARNING',
            isBlocking
              ? 'COA belum memiliki disposition eksplisit.'
              : 'COA belum memiliki disposition, tetapi total absolut <= Rp1 sehingga non-blocking (de minimis).'
          );
        }
"""
if s.count(old) != 1:
    raise SystemExit('expected one service mapping issue block')
service.write_text(s.replace(old, new, 1))

# 2. UI distinguishes true non-zero de-minimis evidence from exact zero.
ui = Path('app/cost-structure/upload/[id]/phase-d-workspace.tsx')
s = ui.read_text()
old = """function amountIsBlocking(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) > 1;
}
"""
new = """function amountIsBlocking(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) > 1;
}

function amountIsZero(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}
"""
if s.count(old) != 1:
    raise SystemExit('expected one amount helper block')
s = s.replace(old, new, 1)
old = """  const nonBlockingUnmapped = useMemo(
    () => unmappedItems.filter((item) => !amountIsBlocking(item.totalAmount)),
    [unmappedItems]
  );
"""
new = """  const deMinimisUnmapped = useMemo(
    () => unmappedItems.filter((item) => !amountIsBlocking(item.totalAmount) && !amountIsZero(item.totalAmount)),
    [unmappedItems]
  );
  const zeroUnmapped = useMemo(
    () => unmappedItems.filter((item) => amountIsZero(item.totalAmount)),
    [unmappedItems]
  );
"""
if s.count(old) != 1:
    raise SystemExit('expected one non-blocking queue block')
s = s.replace(old, new, 1)
old = """                {nonBlockingUnmapped.length > 0 && <div className=\"rounded-lg bg-muted p-3 text-sm text-muted-foreground\">{nonBlockingUnmapped.length} COA masih UNMAPPED dengan total absolut ≤ Rp1. Item de-minimis ini tetap tercatat untuk audit tetapi tidak memblokir rekonsiliasi.</div>}
"""
new = """                {deMinimisUnmapped.length > 0 && <div className=\"rounded-lg bg-muted p-3 text-sm text-muted-foreground\">{deMinimisUnmapped.length} COA masih UNMAPPED dengan total non-zero absolut ≤ Rp1. Item de-minimis ini tetap tercatat untuk audit tetapi tidak memblokir rekonsiliasi.</div>}
                {zeroUnmapped.length > 0 && <div className=\"rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground\">{zeroUnmapped.length} COA bernilai tepat Rp0 hanya dipertahankan sebagai audit evidence. Item Rp0 bukan error, bukan de-minimis exception, dan tidak memerlukan mapping manual.</div>}
"""
if s.count(old) != 1:
    raise SystemExit('expected one non-blocking banner')
ui.write_text(s.replace(old, new, 1))

# 3. Persisted calculation controls use the same Rp1 de-minimis threshold as mapping.
run_service = Path('lib/cost-structure/calculations/run-service.ts')
s = run_service.read_text()
old_import = "import { getPhaseDReport } from '@/lib/cost-structure/reconciliation/service';\n"
new_import = old_import + "import { isMappingBlockingAmount } from '@/lib/cost-structure/reconciliation/money';\n"
if s.count(old_import) != 1:
    raise SystemExit('expected one Phase D import')
s = s.replace(old_import, new_import, 1)
old_status = "reconciliationStatus: control.difference.isZero() ? 'RECONCILED' : 'NOT_RECONCILED'"
new_status = "reconciliationStatus: isMappingBlockingAmount(control.difference.toString()) ? 'NOT_RECONCILED' : 'RECONCILED'"
if s.count(old_status) != 2:
    raise SystemExit(f'expected two persisted control status expressions, found {s.count(old_status)}')
s = s.replace(old_status, new_status)
run_service.write_text(s)

# 4. Reconciliation/finalization readiness must accept legacy persisted ±Rp1 controls too.
policy = Path('lib/cost-structure/finalization/policy.ts')
s = policy.read_text()
old_import = "import { calculateMappingCompleteness, type MappingCompletenessRow } from '../reconciliation/mapping-completeness';\n"
new_import = old_import + "import { isMappingBlockingAmount } from '../reconciliation/money';\n"
if s.count(old_import) != 1:
    raise SystemExit('expected one mapping completeness import')
s = s.replace(old_import, new_import, 1)
old = """const isZero = (value: FinalizationSnapshot['results'][number]['reconciliationDifference']) =>
  value !== null && new Prisma.Decimal(value).equals(0);
"""
new = """const isWithinControlTolerance = (value: FinalizationSnapshot['results'][number]['reconciliationDifference']) =>
  value !== null && !isMappingBlockingAmount(new Prisma.Decimal(value).toString());
"""
if s.count(old) != 1:
    raise SystemExit('expected one strict-zero helper')
s = s.replace(old, new, 1)
old = """    if (control.resultType !== 'CONTROL' || control.reconciliationStatus !== 'RECONCILED' || !isZero(control.reconciliationDifference)) {
      throw new FinalizationError(`Control ${code} harus RECONCILED dengan selisih 0.00.`);
    }
"""
new = """    if (control.resultType !== 'CONTROL' || !isWithinControlTolerance(control.reconciliationDifference)) {
      throw new FinalizationError(`Control ${code} harus memiliki selisih absolut <= Rp1.`);
    }
"""
if s.count(old) != 1:
    raise SystemExit('expected one required-control strict check')
s = s.replace(old, new, 1)
old = """  if (allControls.some((control) => control.reconciliationStatus !== 'RECONCILED' || !isZero(control.reconciliationDifference))) {
    throw new FinalizationError('Semua persisted CONTROL harus RECONCILED dengan selisih 0.00.');
  }
"""
new = """  if (allControls.some((control) => !isWithinControlTolerance(control.reconciliationDifference))) {
    throw new FinalizationError('Semua persisted CONTROL harus memiliki selisih absolut <= Rp1.');
  }
"""
if s.count(old) != 1:
    raise SystemExit('expected one all-control strict check')
policy.write_text(s.replace(old, new, 1))

# 5. Regression tests for legacy and new Rp1 control semantics.
test_file = Path('lib/cost-structure/finalization/service.test.ts')
s = test_file.read_text()
old = "test('non-zero persisted control blocks', () => { const value = fixture(); value.results[0] = control('ADUM_NATURE_RECONCILIATION', '0.01'); assert.throws(() => assertReconciliationReady(value), /ADUM_NATURE_RECONCILIATION/); });\n"
new = """test('absolute Rp1 persisted control is accepted even with legacy NOT_RECONCILED status', () => { const value = fixture(); value.results[0] = control('ADUM_NATURE_RECONCILIATION', '-1.00', 'NOT_RECONCILED'); assert.equal(assertReconciliationReady(value), 9); });
test('persisted control above Rp1 blocks even if status says RECONCILED', () => { const value = fixture(); value.results[0] = control('ADUM_NATURE_RECONCILIATION', '1.01', 'RECONCILED'); assert.throws(() => assertReconciliationReady(value), /ADUM_NATURE_RECONCILIATION/); });
"""
if s.count(old) != 1:
    raise SystemExit('expected one strict non-zero control test')
test_file.write_text(s.replace(old, new, 1))
