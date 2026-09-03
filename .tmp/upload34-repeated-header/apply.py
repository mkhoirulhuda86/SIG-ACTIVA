from pathlib import Path

p = Path('lib/cost-structure/parsers/workbook.ts')
s = p.read_text()
old = """function isRepeatedSemanticHeader(values: unknown[], coaIndex: number, amountIndex: number) {\n  if (coaIndex < 0 || amountIndex < 0) return false;\n  const coaLabel = normalizeLabel(text(values[coaIndex]) ?? '');\n  const amountLabel = normalizeLabel(text(values[amountIndex]) ?? '');\n  return COA.includes(coaLabel) && AMOUNT.includes(amountLabel);\n}\n"""
new = """function isRepeatedSemanticHeader(values: unknown[], coaIndex: number, amountIndex: number) {\n  if (coaIndex < 0 || amountIndex < 0) return false;\n  const labels = values.map((value) => normalizeLabel(text(value) ?? '')).filter(Boolean);\n  // Some historical SAP exports repeat the raw semantic header under helper columns whose\n  // labels are truncated (for example `Cost Ele` / `Act. Costs`). Detect the repeated header\n  // from the complete row instead of requiring the selected helper cells themselves to match.\n  return labels.some((label) => COA.includes(label)) && labels.some((label) => AMOUNT.includes(label));\n}\n"""
if s.count(old) != 1:
    raise SystemExit(f'workbook.ts expected one target, got {s.count(old)}')
p.write_text(s.replace(old, new, 1))

p = Path('lib/cost-structure/parsers/workbook.test.ts')
s = p.read_text()
needle = """  test('skips a repeated SAP header and prefers authoritative raw columns over CE/Act Amt helpers', async () => {\n"""
pos = s.find(needle)
if pos < 0:
    raise SystemExit('existing repeated-header regression test not found')
# Insert a focused historical-header regression immediately before the existing test.
test = """  test('skips historical repeated SAP header when helper labels are truncated', async () => {\n    const workbook = XLSX.utils.book_new();\n    const rows = [\n      ['CE', 'Act Amt'],\n      ['Cost Ele', 'Act. Costs', 'Cost Elements', 'Cost Elements', 'Act. Costs', 'Plan Costs', 'Var.(Abs.)'],\n      ['61110002', 0, '61110002 LIMEST. CONSUMPT.', '61110002 LIMEST. CONSUMPT.', 0, 0, 0],\n    ];\n    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'cc_adm');\n    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });\n    const parsed = await parseWorkbook(bytes, '2000');\n    assert.equal(parsed.issues.filter((issue) => issue.issueCode === 'SOURCE_ROW_INVALID_AMOUNT').length, 0);\n    const adum = parsed.rows.filter((row) => row.logicalSourceCode === 'CC_ADUM');\n    assert.equal(adum.some((row) => row.coaCodeRaw === 'Cost Ele'), false);\n    assert.equal(adum.some((row) => row.coaCodeRaw === '61110002'), true);\n  });\n\n"""
s = s[:pos] + test + s[pos:]
p.write_text(s)
