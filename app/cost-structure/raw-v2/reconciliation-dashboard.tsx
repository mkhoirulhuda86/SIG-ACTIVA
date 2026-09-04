'use client';
import { useState } from 'react';

type Data = any;
function rupiah(value: string | null | undefined) {
  if (value == null) return '—';
  const negative = value.startsWith('-');
  const [whole, fraction] = value.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp${grouped}${fraction && fraction !== '00' ? `,${fraction}` : ''}`;
}

export default function ReconciliationDashboard() {
  const [year, setYear] = useState(2026);
  const [period, setPeriod] = useState(8);
  const [data, setData] = useState<Data>(null);
  const [si, setSi] = useState<Data>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/cost-structure/raw-v2/reconciliation?fiscalYear=${year}&fiscalPeriod=${period}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setData(json);
      const siResponse = await fetch(`/api/cost-structure/raw-v2/si?fiscalYear=${year}&fiscalPeriod=${period}`);
      if (siResponse.ok) setSi(await siResponse.json());
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Gagal memuat data.');
    } finally {
      setBusy(false);
    }
  }

  async function calculateSi() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/cost-structure/raw-v2/si/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyCode: '2000', fiscalYear: year, fiscalPeriod: period }) });
      const json = await response.json(); if (!response.ok) throw new Error(json.error); await load();
    } catch (value) { setError(value instanceof Error ? value.message : 'Gagal menghitung SI.'); setBusy(false); }
  }

  async function calculate() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/cost-structure/raw-v2/reconciliation/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyCode: '2000', fiscalYear: year, fiscalPeriod: period }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Gagal menghitung.');
      setBusy(false);
    }
  }

  const rec = data?.run?.reconciliation;
  const upload = data?.upload;
  const source = (code: string) => upload?.sources?.find((item: any) => item.logicalSourceCode === code);
  const cards = rec
    ? [
        ['Unique CC COA', rec.uniqueCcCoaCount],
        ['Found in TB', rec.foundInTbCount],
        ['Missing in TB', rec.missingInTbCount],
        ['Exact match', rec.exactMatchCount],
        ['Mismatch', rec.mismatchCount],
        ['ADUM', rupiah(rec.totalAdum)],
        ['PASAR', rupiah(rec.totalPasar)],
        ['Base CC', rupiah(rec.totalBaseCc)],
        ['TB (same COAs)', rupiah(rec.totalTbPopulation)],
        ['Difference (CC − TB)', rupiah(rec.totalDifference)],
      ]
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
        <p className="text-sm font-semibold uppercase text-blue-700">D_RAW_RECONCILIATION</p>
        <h1 className="mt-2 text-2xl font-bold">Company 2000 TB ↔ Base CC</h1>
        <p className="mt-2 text-sm text-slate-700">Exact per-COA control: TB = CC_ADUM + CC_PASAR. DERIV is separate evidence and is never double-counted. No SI is finalized here.</p>
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-5 shadow-sm">
        <label className="text-sm">Fiscal year<input className="mt-1 block rounded border p-2" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label className="text-sm">Period<select className="mt-1 block rounded border p-2" value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
        <button onClick={load} disabled={busy} className="rounded bg-slate-700 px-4 py-2 text-white">Load</button>
        <button onClick={calculate} disabled={busy || upload?.status !== 'VALIDATED'} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-300">Calculate reconciliation</button>
        <button onClick={calculateSi} disabled={busy || !rec || rec.missingInTbCount > 0 || rec.derivPasarCoverageMissing > 0} className="rounded bg-violet-700 px-4 py-2 font-semibold text-white disabled:bg-slate-300">Calculate mapped SI</button>
        {error && <p className="w-full text-sm text-red-700">{error}</p>}
      </section>

      {data && <>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <div><h2 className="font-bold">Active upload</h2><p className="text-sm">{upload ? `v${upload.version} · ${upload.status}` : 'No active upload'}</p></div>
            {rec && <span className={`rounded-full px-4 py-2 font-bold ${rec.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{rec.status}</span>}
          </div>
          {source('TB') && <div className="mt-4 rounded-xl bg-emerald-50 p-4"><b>TB coverage: {source('TB').detailRowCount} COA parsed · {source('TB').nonZeroDetailRowCount} non-zero</b><p className="text-xs text-slate-600">Net TB: {rupiah(source('TB').detailTotal)}. A zero Net TB does not mean TB is empty.</p></div>}
        </section>

        {rec && <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label, value]) => <div key={label as string} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold">{value}</p></div>)}</section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-bold">Blocking exceptions</h2>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th>COA</th><th>TB</th><th>ADUM</th><th>PASAR</th><th>CC total</th><th>Difference (CC − TB)</th><th>Status</th></tr></thead><tbody>{rec.rows.length === 0 ? <tr><td colSpan={7} className="py-4 text-slate-500">No TB/base-CC mismatch.</td></tr> : rec.rows.map((row: any) => <tr key={row.coaCode} className="border-b"><td className="py-2 font-mono font-bold">{row.coaCode}</td><td>{rupiah(row.tbAmount)}</td><td>{rupiah(row.adumAmount)}</td><td>{rupiah(row.pasarAmount)}</td><td>{rupiah(row.ccAmount)}</td><td className="font-bold text-red-700">{rupiah(row.difference)}</td><td>{row.status}</td></tr>)}</tbody></table></div>
          </section>

          <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
            <h2 className="font-bold">DERIV — separate PASAR evidence</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <span>Presence: <b>{rec.derivPresenceStatus}</b></span>
              <span>Rows: <b>{rec.derivDetailRowCount}</b></span>
              <span>Non-zero: <b>{rec.derivNonZeroCount}</b></span>
              <span>Total: <b>{rupiah(rec.derivTotal)}</b></span>
              <span>Debit: <b>{rupiah(rec.derivDebitControl)}</b></span>
              <span>Control difference: <b>{rupiah(rec.derivSourceDifference)}</b></span>
              <span>COA missing in PASAR: <b className={rec.derivPasarCoverageMissing > 0 ? 'text-red-700' : ''}>{rec.derivPasarCoverageMissing}</b></span>
            </div>
            {rec.derivPasarCoverageMissing > 0 && <p className="mt-3 rounded-lg bg-red-100 p-3 text-sm font-semibold text-red-800">Blocking: non-zero DERIV COA must already exist inside CC_PASAR.</p>}
            <p className="mt-3 text-xs">Future SI treatment: PASAR analytical base − DERIV. Stage D does not apply or finalize that overlay.</p>
          </section>
        </>}
        {si?.run && <StageESummary run={si.run} />}
      </>}
    </div>
  );
}

function StageESummary({ run }: { run: any }) {
  const result = (code: string) => run.results.find((item: any) => item.resultCode === code)?.amount;
  const mappingControls = run.controls.filter((item: any) => item.controlCode.endsWith('_MAPPING_COMPLETENESS'));
  const corrections = run.analyticalRows.filter((item: any) => item.analyticalClass === 'RINCIAN_ADUM_DELTA' || item.analyticalClass === 'DERIV_PASAR_OFFSET');
  return <section className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50 p-5">
    <div className="flex justify-between"><div><p className="text-xs font-bold uppercase text-violet-700">E_MAPPING_RINCIAN_SI</p><h2 className="text-xl font-bold">Mapped Company 2000 SI</h2></div><b>{run.status}</b></div>
    <div className="grid gap-3 sm:grid-cols-3">{[['Final ADUM',result('GROUP:ADUM')],['Final PASAR',result('GROUP:PASAR')],['Company SI',result('COMPANY:SI')]].map(([label,value])=><div key={label} className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">{label}</p><b>{rupiah(value)}</b></div>)}</div>
    <div className="overflow-x-auto rounded-xl bg-white p-4"><h3 className="mb-2 font-bold">Mapping coverage</h3><table className="w-full text-left text-sm"><thead><tr><th>Population</th><th>Source</th><th>Accounted</th><th>Difference</th><th>Status</th></tr></thead><tbody>{mappingControls.map((c:any)=><tr key={c.controlCode} className="border-t"><td className="py-2">{c.sourceLogicalCode}</td><td>{rupiah(c.sourceAmount)}</td><td>{rupiah(c.accountedAmount)}</td><td>{rupiah(c.difference)}</td><td className="font-bold">{c.status}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto rounded-xl bg-white p-4"><h3 className="mb-1 font-bold">Explicit corrections and offsets</h3><p className="mb-3 text-xs text-slate-600">A Stage D CC − TB mismatch is reconstructed as the exact opposite-signed Rincian ADUM correction; it is never hidden.</p><table className="w-full text-left text-sm"><thead><tr><th>COA</th><th>Class</th><th>Raw evidence</th><th>SI contribution</th><th>Mapping</th></tr></thead><tbody>{corrections.map((r:any)=><tr key={r.id} className="border-t"><td className="py-2 font-mono">{r.coaCode}</td><td>{r.analyticalClass}</td><td>{rupiah(r.rawAmount)}</td><td className="font-bold">{rupiah(r.mappedAmount)}</td><td>{r.mappingAction} → {r.costGroupCode}/{r.natureCode}</td></tr>)}</tbody></table></div>
    <div className="overflow-x-auto rounded-xl bg-white p-4"><h3 className="mb-2 font-bold">Nature breakdown</h3><table className="w-full text-left text-sm"><tbody>{run.results.filter((r:any)=>r.resultLevel==='NATURE').map((r:any)=><tr key={r.id} className="border-t"><td className="py-2">{r.costGroupCode}</td><td>{r.natureCode}</td><td className="text-right font-bold">{rupiah(r.amount)}</td></tr>)}</tbody></table></div>
  </section>;
}
