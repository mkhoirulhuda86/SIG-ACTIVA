from pathlib import Path

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
