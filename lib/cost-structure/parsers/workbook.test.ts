import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { parseWorkbook } from './workbook';
import { reconcileCcGroup } from '../reconciliation/reconcile-cc-group';

describe('parseWorkbook raw support-source lineage', () => {
  it('uses only the first Debit section for Company 7000 CC source controls', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('tb').addRows([['kode','descr','amount'],['50000001','x',1]]);
    const totals: Record<string, number> = { cc_prod:323678831230, cc_adm:8559756291, 'cc pasar':10648498072, WHRPG:4589161539 };
    for (const [name,total] of Object.entries(totals)) {
      const sheet=workbook.addWorksheet(name); sheet.addRow(['Cost Elements','Act. Costs']);
      sheet.addRow(['60000001 Primary',total]); sheet.addRow(['* Debit',total]);
      sheet.addRow(['* Credit',999]); sheet.addRow(['60000002 post debit',999]);
    }
    for(const name of ['Batu bara','beli','solar PP order','statistical pasar']) workbook.addWorksheet(name).addRow(['support']);
    const parsed=await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer),'7000');
    for(const [name,total] of Object.entries(totals)) {
      const source=name==='cc_prod'?'CC_PROD':name==='cc_adm'?'CC_ADUM':name==='cc pasar'?'CC_PASAR':'CC_WHRPG';
      const sourceRows=parsed.rows.filter(row=>row.logicalSourceCode===source);
      assert.equal(sourceRows.length,2); assert.equal(sourceRows[0].amount,String(total)); assert.equal(sourceRows[1].descriptionRaw,'* Debit');
      assert.equal(sourceRows.some(row=>row.coaCodeRaw==='60000002'),false);
      const control=reconcileCcGroup(sourceRows.map(row=>({coaCodeRaw:row.coaCodeRaw,descriptionRaw:row.descriptionRaw,amount:row.amount})));
      assert.equal(control.status,'RECONCILED'); assert.equal(control.detailAmount,`${total}.00`); assert.equal(control.difference,'0.00');
    }
  });

  it('preserves verified special sources as intentional raw lineage without parser warnings', async () => {
    const workbook = new ExcelJS.Workbook();
    const coal = workbook.addWorksheet('Batu bara');
    coal.addRow(['Material', 'Quantity', 'Price']); coal.addRow(['COAL-A', 2, 100]);
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = await parseWorkbook(bytes as unknown as Uint8Array, '7000');
    const coalRows = parsed.rows.filter((row) => row.logicalSourceCode === 'COAL');
    assert.equal(coalRows.length, 2);
    assert.equal(coalRows[1].rawDataJson.COLUMN_1, 'COAL-A');
    assert.equal(coalRows[1].coaCodeRaw, null);
    assert.equal(coalRows[1].amount, null);
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_MISSING_COA' && issue.message.includes('COAL')), false);
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_HEADER_NOT_FOUND' && issue.message.includes('Batu bara')), false);
  });

  it('assigns OA_STAT summary, derivative and transaction roles semantically', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('statistical pasar');
    sheet.addRow([null, '68110001  LOADING PORT EXPEN', null, null, 516078394]);
    sheet.addRow([null, 'DER']);
    sheet.addRow([null, '68140005  CEMENT BULK TRUCK', 368191098]);
    sheet.addRow(['Company Code','G/L Account','Posting Period','Document Number','Document Type','Posting Date','Amount in local currency']);
    sheet.addRow(['7000','68140006','7','1','WE','2026-07-01',626212260]);
    const parsed = await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), '7000');
    const rows = parsed.rows.filter((row) => row.logicalSourceCode === 'OA_STAT');
    assert.equal(rows.find((row) => row.sourceRowNumber === 1)?.rawDataJson.ROLE, 'SUMMARY');
    assert.equal(rows.find((row) => row.sourceRowNumber === 1)?.rawDataJson.ROLE_GL, '68110001');
    assert.equal(rows.find((row) => row.sourceRowNumber === 3)?.rawDataJson.ROLE, 'DERIVATIVE');
    assert.equal(rows.find((row) => row.sourceRowNumber === 5)?.rawDataJson.ROLE, 'TRANSACTION');
    assert.equal(rows.find((row) => row.sourceRowNumber === 5)?.rawDataJson.COMPANY_CODE, '7000');
    assert.equal(rows.find((row) => row.sourceRowNumber === 5)?.rawDataJson.POSTING_PERIOD, '7');
  });

  it('normalizes Solar semantic alias and Excel SUM blank-as-zero clinker cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const solar = workbook.addWorksheet('solar PP order');
    solar.addRow(['User Name','Posting Date','Order','Material','Material Description','Plant','Cost Element','Company Code','Cost element name','Value in Obj Crcy']);
    for (let row = 2; row < 18; row += 1) solar.addRow([]);
    solar.addRow([null,null,null,'112-200001',null,'7702','Consumption Production CKM3n',null,null,287849467]);
    const beli = workbook.addWorksheet('beli');
    for (let row = 1; row < 63; row += 1) beli.addRow([]);
    for (let row = 63; row <= 69; row += 1) beli.addRow([row === 63 ? 'September' : null, '7702', '121-200-0010', 'KLINKER OPC', null, row === 65 ? 0 : null]);
    const parsed = await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), '7000');
    const solarRow = parsed.rows.find((row) => row.logicalSourceCode === 'SOLAR_PP_ORDER' && row.sourceRowNumber === 18);
    assert.equal(solarRow?.rawDataJson.MATERIAL, '112-200001');
    assert.equal(solarRow?.rawDataJson.PLANT, '7702');
    assert.equal(solarRow?.rawDataJson['COST ELEMENT TEXT'], 'Consumption Production CKM3n');
    assert.equal(solarRow?.rawDataJson['VALUE IN OBJ CRCY'], '287849467');
    const clinker = parsed.rows.filter((row) => row.logicalSourceCode === 'CLINKER_PURCHASE' && row.sourceRowNumber >= 63 && row.sourceRowNumber <= 69);
    assert.equal(clinker.length, 7);
    assert.ok(clinker.every((row) => row.rawDataJson.COLUMN_6 === '0'));
  });

  it('persists GHoPO/DERIV/rincian derivative sheets as audit-only zero-semantics rows', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('GHoPO').addRows([['Beban Pokok Penjualan'],['Bahan baku',123]]);
    workbook.addWorksheet('DERIV').addRows([['Beban Pokok Penjualan'],['Bahan baku',0]]);
    workbook.addWorksheet('rincian biaya').addRows([[null,'G/L acc','Keterangan','HPP'],[null,'61110001','LIMESTONE',10]]);
    workbook.addWorksheet('cc_drv').addRow(['audit derivative']);
    workbook.addWorksheet('SI2000_DRV').addRow(['audit SI derivatif']);
    const parsed = await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), '7000');
    for (const code of ['AUDIT_GHOPO','AUDIT_DERIV','AUDIT_RINCIAN','AUDIT_CC_DRV','AUDIT_SI2000_DRV']) {
      const rows = parsed.rows.filter((row) => row.logicalSourceCode === code);
      assert.ok(rows.length > 0, `${code} missing`);
      assert.ok(rows.every((row) => row.amount === null && row.coaCodeRaw === null));
    }
  });

  it('ignores META as an authoritative logical source', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('META').addRow(['Company', '7000']);
    const tb = workbook.addWorksheet('TB'); tb.addRow(['Account', 'Description', 'Amount']); tb.addRow(['001000', 'Test', 10]);
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = await parseWorkbook(bytes as unknown as Uint8Array, '2000');
    assert.equal(parsed.sources.some((source) => source.sheetName === 'META'), false);
    assert.equal(parsed.rows.find((row) => row.logicalSourceCode === 'TB')?.coaCodeRaw, '001000');
  });

  it('prefers authoritative Cost Elements / Act. Costs and ignores SAP control/layout artifacts', async () => {
    const workbook = new ExcelJS.Workbook();
    const tb = workbook.addWorksheet('tb');
    tb.addRow(['', '', '', '', '', '', '', 'kode ', 'descr', 'amount']);
    tb.addRow(['', '', '', '', '', '', '', '61110002', 'Limestone', 5]);
    tb.addRow(['Company code currenc 10', 'Rupiah IDR', 'metadata only']);
    workbook.addWorksheet('cc_prod');
    for (const name of ['cc_adm', 'cc pasar']) {
      const sheet = workbook.addWorksheet(name); for (let i = 1; i < 13; i += 1) sheet.addRow([]);
      sheet.addRow(['', '', 'Cost Elements', 'Act. Costs', '', '', '', '', '', '', '', '', 'CE', 'Act Amt', 'Group CE']);
      sheet.addRow(['', '', '   61110002  LIMEST. CONSUMPT.', 10, '', '', '', '', '', '', '', '', { formula: 'LEFT(C14,8)' }, { formula: 'D14' }, '6']);
      sheet.addRow(['', '', '*  Debit', 10, '', '', '', '', '', '', '', '', { formula: 'LEFT(C15,8)' }, { formula: 'D15' }, 'D']);
      sheet.addRow(['', '', '** Over/Underabsorption', 10, '', '', '', '', '', '', '', '', { formula: 'LEFT(C16,8)' }, { formula: 'D16' }, 'O']);
      sheet.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '', 0, '']);
    }
    const parsed = await parseWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), '2000');
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_MISSING_COA'), false);
    assert.equal(parsed.sources.find((source) => source.code === 'CC_ADUM')?.rowCount, 3);
    assert.equal(parsed.sources.find((source) => source.code === 'CC_PROD')?.rowCount, 0);
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_EMPTY' && issue.severity === 'INFO'), true);
    assert.equal(parsed.rows.find((row) => row.logicalSourceCode === 'CC_ADUM' && row.coaCodeRaw === '61110002')?.amount, '10');
    assert.equal(parsed.rows.find((row) => row.logicalSourceCode === 'TB' && row.coaCodeRaw === '61110002')?.amount, '5');
    assert.equal(parsed.rows.some((row) => row.logicalSourceCode === 'TB' && row.sourceRowNumber === 3), false);
  });

  it('skips a repeated SAP header and prefers authoritative raw columns over CE/Act Amt helpers', async () => {
    const workbook = new ExcelJS.Workbook();
    const tb = workbook.addWorksheet('tb');
    tb.addRows([['Account', 'Description', 'Amount'], ['61110002', 'Limestone', 5]]);
    workbook.addWorksheet('cc_prod');
    for (const name of ['cc_adm', 'cc pasar']) {
      const sheet = workbook.addWorksheet(name);
      for (let i = 1; i < 13; i += 1) sheet.addRow([]);
      sheet.addRow(['CE', 'Act Amt', 'Group CE', 'Cost Elements', 'Act. Costs']);
      sheet.addRow(['Cost Ele', 'Act. Costs', 'Group CE', 'Cost Elements', 'Act. Costs']);
      sheet.addRow(['61110002', 10, '6', '61110002  LIMEST. CONSUMPT.', 10]);
      sheet.addRow(['Debit', 10, 'D', '*  Debit', 10]);
    }
    const parsed = await parseWorkbook(
      new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer),
      '2000'
    );
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_INVALID_AMOUNT'), false);
    assert.equal(parsed.issues.some((issue) => issue.issueCode === 'SOURCE_ROW_MISSING_COA'), false);
    const adum = parsed.rows.filter((row) => row.logicalSourceCode === 'CC_ADUM');
    assert.equal(adum.some((row) => row.sourceRowNumber === 14), false);
    assert.equal(adum.find((row) => row.coaCodeRaw === '61110002')?.amount, '10');
    assert.equal(adum.find((row) => row.descriptionRaw === '*  Debit')?.amount, '10');
  });

});
