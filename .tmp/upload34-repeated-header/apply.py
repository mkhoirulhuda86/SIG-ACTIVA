from pathlib import Path

p = Path('lib/cost-structure/parsers/workbook.ts')
s = p.read_text()
old = """function isRepeatedSemanticHeader(values: unknown[], coaIndex: number, amountIndex: number) {\n  if (coaIndex < 0 || amountIndex < 0) return false;\n  const coaLabel = normalizeLabel(text(values[coaIndex]) ?? '');\n  const amountLabel = normalizeLabel(text(values[amountIndex]) ?? '');\n  return COA.includes(coaLabel) && AMOUNT.includes(amountLabel);\n}\n"""
new = """function isRepeatedSemanticHeader(values: unknown[], coaIndex: number, amountIndex: number) {\n  if (coaIndex < 0 || amountIndex < 0) return false;\n  const labels = values.map((value) => normalizeLabel(text(value) ?? '')).filter(Boolean);\n  // Historical SAP exports can repeat the raw semantic header below helper-only headers.\n  // The helper cells can be truncated (`Cost Ele` / `Act. Costs`), so detect the repeated\n  // header from the complete row instead of requiring the selected helper cells to match.\n  return labels.some((label) => COA.includes(label)) && labels.some((label) => AMOUNT.includes(label));\n}\n"""
if s.count(old) != 1:
    raise SystemExit(f'workbook.ts expected one target, got {s.count(old)}')
p.write_text(s.replace(old, new, 1))

p = Path('lib/cost-structure/parsers/workbook.test.ts')
s = p.read_text()
needle = """  it('skips a repeated SAP header and prefers authoritative raw columns over CE/Act Amt helpers', async () => {\n"""
pos = s.find(needle)
if pos < 0:
    raise SystemExit('existing repeated-header regression test not found')

test = """  it('skips historical repeated SAP header when the selected helper labels are truncated', async () => {\n    const workbook = new ExcelJS.Workbook();\n    const tb = workbook.addWorksheet('tb');\n    tb.addRows([['Account', 'Description', 'Amount'], ['61110002', 'Limestone', 5]]);\n    workbook.addWorksheet('cc_prod');\n    for (const name of ['cc_adm', 'cc pasar']) {\n      const sheet = workbook.addWorksheet(name);\n      for (let i = 1; i < 13; i += 1) sheet.addRow([]);\n      // Upload #34 pattern: the first detected header is helper-only (CE / Act Amt).\n      sheet.addRow([null, null, null, null, null, null, null, null, null, null, null, 'CE', 'Act Amt', 'Group CE']);\n      // The next row is the real SAP semantic header. Helper labels are truncated, while\n      // authoritative raw cells elsewhere in the same row contain Cost Elements / Act. Costs.\n      sheet.addRow([null, 'Cost Elements', 'Cost Elements', 'Act. Costs', 'Plan Costs', 'Var.(Abs.)', 'Var.(%)', 'Cost Elements', 'Actual Qty', 'Plan Qty', 'Var.(Abs.)', 'Cost Ele', 'Act. Costs', 'C']);\n      sheet.addRow([null, '61110002 LIMEST. CONSUMPT.', '61110002  LIMEST. CONSUMPT.', 0, 0, 0, 0, '61110002  LIMEST. CONSUMPT.', 0, 0, 0, '61110002', 0, '6']);\n    }\n    const parsed = await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), '2000');\n    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_INVALID_AMOUNT'), false);\n    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_MISSING_COA'), false);\n    const adum = parsed.rows.filter((row) => row.logicalSourceCode === 'CC_ADUM');\n    assert.equal(adum.some((row) => row.sourceRowNumber === 14), false);\n    assert.equal(adum.some((row) => row.coaCodeRaw === 'Cost Ele'), false);\n    assert.equal(adum.find((row) => row.coaCodeRaw === '61110002')?.amount, '0');\n  });\n\n"""
s = s[:pos] + test + s[pos:]
p.write_text(s)
