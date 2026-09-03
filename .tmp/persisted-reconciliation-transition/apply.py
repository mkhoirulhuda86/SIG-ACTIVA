from pathlib import Path
p = Path('lib/cost-structure/processing/service.ts')
s = p.read_text()
old = '    reconciliationReady: report.ready,\n'
new = "    reconciliationReady: report.ready && ['SOURCE_RECONCILED', 'CALCULATED', 'COST_STRUCTURE_RECONCILED', 'FINALIZED'].includes(upload.period.status),\n"
if s.count(old) != 1:
    raise SystemExit(f'expected one reconciliationReady assignment, got {s.count(old)}')
p.write_text(s.replace(old, new, 1))
