'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';

type AnyRow = Record<string, any>;

function rupiah(value: unknown) {
  if (value == null) return '—';
  const text = String(value);
  const negative = text.startsWith('-');
  const [whole, fraction] = text.replace('-', '').split('.');
  return `${negative ? '-' : ''}Rp${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction && fraction !== '00' ? `,${fraction}` : ''}`;
}

function Badge({ status }: { status: string }) {
  const pass = ['PASS', 'SUCCESS', 'READY'].includes(status);
  const neutral = ['NOT RUN', 'BLOCKED'].includes(status);
  const diagnostic = status === 'DIAGNOSTIC';
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${pass ? 'bg-emerald-100 text-emerald-800' : diagnostic ? 'bg-amber-100 text-amber-800' : neutral ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-800'}`}>
      {status}
    </span>
  );
}

export default function ReconciliationDashboard() {
  const [year, setYear] = useState(2026);
  const [period, setPeriod] = useState(8);
  const [data, setData] = useState<AnyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [natureFilter, setNatureFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  async function load() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/cost-structure/raw-v2/report?fiscalYear=${year}&fiscalPeriod=${period}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Gagal memuat laporan.');
    } finally {
      setBusy(false);
    }
  }

  async function calculate(path: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyCode: '2000', fiscalYear: year, fiscalPeriod: period }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Proses gagal.');
      setBusy(false);
    }
  }

  const run = data?.run;
  const rec = data?.stageD?.reconciliation;
  const analytical = useMemo(() => run?.analyticalRows ?? [], [run]);
  const filtered = useMemo(
    () => analytical.filter((row: AnyRow) =>
      (!query || `${row.coaCode} ${row.descriptionRaw ?? ''}`.toLowerCase().includes(query.toLowerCase())) &&
      (!sourceFilter || row.logicalSourceCode === sourceFilter) &&
      (!groupFilter || row.costGroupCode === groupFilter) &&
      (!natureFilter || row.natureCode === natureFilter) &&
      (!statusFilter || row.mappingStatus === statusFilter || row.mappingAction === statusFilter) &&
      (!classFilter || row.analyticalClass === classFilter)
    ),
    [analytical, query, sourceFilter, groupFilter, natureFilter, statusFilter, classFilter]
  );

  const stageDDiagnostic = Boolean(
    rec?.status === 'FAIL' &&
    rec?.missingInTbCount === 0 &&
    rec?.derivPasarCoverageMissing === 0 &&
    run?.status === 'SUCCESS'
  );
  const stageDWorkflowStatus = stageDDiagnostic ? 'DIAGNOSTIC' : rec?.status ?? 'NOT RUN';
  const workflows = [
    ['1. Raw upload', data?.upload?.status === 'VALIDATED' ? 'READY' : data?.upload?.status ?? 'NOT RUN'],
    ['2. Source validation', data?.upload?.status === 'VALIDATED' ? 'PASS' : data?.upload ? 'FAIL' : 'NOT RUN'],
    ['3. TB ↔ Base CC reconciliation', stageDWorkflowStatus],
    ['4. Mapping / Rincian / SI', run?.status ?? (rec ? 'BLOCKED' : 'NOT RUN')],
    ['5. Reporting / Export', data?.exportEligibility?.eligible ? 'READY' : 'BLOCKED'],
  ];
  const cards = [
    ['Final ADUM', data?.executive?.finalAdum],
    ['Final PASAR', data?.executive?.finalPasar],
    ['Final Company SI', data?.executive?.finalCompanySi],
    ['Stage D CC − TB', data?.executive?.stageDDifference],
    ['Rincian ADUM correction', data?.executive?.rincianAdumCorrection],
    ['DERIV raw', data?.executive?.derivRaw],
    ['DERIV contributing', data?.executive?.derivContributing],
    ['DERIV excluded', data?.executive?.derivExcluded],
    ['DERIV SI offset', data?.executive?.derivSiOffset],
  ];
  const failedControls = run?.controls?.filter((control: AnyRow) => control.status !== 'PASS') ?? [];
  const blockingIssues = data?.issues?.filter((issue: AnyRow) => issue.severity === 'ERROR') ?? [];
  const diagnosticIssues = data?.issues?.filter((issue: AnyRow) => issue.severity !== 'ERROR') ?? [];
  const hasBlockingIssue = blockingIssues.length > 0 || failedControls.length > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-violet-50 p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Operational reporting · Company 2000</p>
        <h1 className="mt-2 text-2xl font-bold">Raw SAP Cost Structure & SI</h1>
        <p className="mt-2 text-sm text-slate-600">Active-upload scoped review, persisted results, audit lineage, and controlled export. Ruleset: {run?.ruleSetVersion ?? '—'}</p>
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-5 shadow-sm">
        <label className="text-sm">Fiscal year<input className="mt-1 block rounded border p-2" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label className="text-sm">Period<select className="mt-1 block rounded border p-2" value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
        <button onClick={load} disabled={busy} className="rounded bg-slate-700 px-4 py-2 text-white">{busy ? 'Loading…' : 'Load period'}</button>
        <button onClick={() => calculate('/api/cost-structure/raw-v2/reconciliation/calculate')} disabled={busy || data?.upload?.status !== 'VALIDATED'} className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-slate-300">Run reconciliation</button>
        <button onClick={() => calculate('/api/cost-structure/raw-v2/si/calculate')} disabled={busy || !rec || rec.missingInTbCount > 0 || rec.derivPasarCoverageMissing > 0} className="rounded bg-violet-700 px-4 py-2 text-white disabled:bg-slate-300">Run mapped SI</button>
        {data?.exportEligibility?.eligible && <a className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white" href={`/api/cost-structure/raw-v2/report/export?fiscalYear=${year}&fiscalPeriod=${period}`}>Export Excel</a>}
        {error && <p className="w-full text-sm font-semibold text-red-700">{error}</p>}
      </section>

      {data && <>
        <section className="grid gap-3 md:grid-cols-5">
          {workflows.map(([label, status]) => <div className="rounded-xl border bg-white p-4" key={label}><p className="mb-3 text-xs font-semibold text-slate-600">{label}</p><Badge status={status} /></div>)}
        </section>

        {stageDDiagnostic && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Stage D diagnostic retained:</b> CC − TB {rupiah(data?.executive?.stageDDifference)} is not hidden or auto-balanced. Stage E SUCCESS explicitly carries the corresponding Rincian ADUM correction {rupiah(data?.executive?.rincianAdumCorrection)}.
        </section>}

        <section className="rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div><h2 className="font-bold">Period context</h2><p className="text-sm text-slate-600">Company 2000 · {year}/P{String(period).padStart(2, '0')} · period {data.period?.status ?? 'NOT FOUND'} · upload {data.upload ? `#${data.upload.id} v${data.upload.version} ${data.upload.status}` : 'none'}</p></div>
            {run && <Badge status={run.status} />}
          </div>
        </section>

        {run && <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{rupiah(value)}</p></div>)}</section>

          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-bold">Mapping coverage</h2>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Population</th><th>Non-zero</th>{['INCLUDE', 'EXCLUDE', 'RECLASS', 'UNMAPPED', 'AMBIGUOUS', 'INVALID TARGET'].map((label) => <th key={label}>{label}</th>)}<th>Difference</th><th>Status</th></tr></thead><tbody>{run.controls.filter((control: AnyRow) => control.controlCode.endsWith('_MAPPING_COMPLETENESS')).map((control: AnyRow) => { const metrics = control.metricsJson ?? {}; return <tr className="border-t" key={control.id}><td className="py-2 font-bold">{control.sourceLogicalCode}</td><td>{metrics.nonZeroCount ?? 0}</td>{['include', 'exclude', 'reclass', 'unmapped', 'ambiguous', 'invalidTarget'].map((key) => <td key={key}>{metrics[key]?.count ?? 0} · {rupiah(metrics[key]?.amount)}</td>)}<td>{rupiah(control.difference)}</td><td><Badge status={control.status} /></td></tr>; })}</tbody></table></div>
          </section>

          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-bold">Nature breakdown (persisted)</h2>
            {['ADUM', 'PASAR'].map((group) => <div key={group} className="mt-4"><h3 className="font-semibold">{group}</h3><div className="overflow-x-auto"><table className="w-full text-sm"><tbody>{run.results.filter((result: AnyRow) => result.resultLevel === 'NATURE' && result.costGroupCode === group).map((result: AnyRow) => <tr className="border-t" key={result.id}><td className="py-2 font-mono">{result.natureCode}</td><td>{result.natureName ?? '—'}</td><td className="text-right font-bold">{rupiah(result.amount)}</td></tr>)}</tbody></table></div></div>)}
          </section>

          <section className="rounded-2xl border bg-white p-5">
            <h2 className="font-bold">Analytical lineage</h2>
            <div className="my-3 grid gap-2 md:grid-cols-3 lg:grid-cols-6">
              <input placeholder="COA / description" className="rounded border p-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} />
              {[
                ['Source', sourceFilter, setSourceFilter, 'logicalSourceCode'],
                ['Cost Group', groupFilter, setGroupFilter, 'costGroupCode'],
                ['Nature', natureFilter, setNatureFilter, 'natureCode'],
                ['Status / action', statusFilter, setStatusFilter, 'mappingStatus'],
                ['Class', classFilter, setClassFilter, 'analyticalClass'],
              ].map(([label, value, setter, key]: any) => <select aria-label={label} className="rounded border p-2 text-sm" key={label} value={value} onChange={(event) => setter(event.target.value)}><option value="">All {label}</option>{[...new Set(analytical.map((row: AnyRow) => row[key]).filter(Boolean))].map((option: any) => <option key={option}>{option}</option>)}</select>)}
            </div>
            <div className="max-h-[34rem] overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Source / sheet / row</th><th>COA / description</th><th>Raw</th><th>SI contribution</th><th>Class</th><th>Status/action</th><th>Target</th><th>Rule / mapping</th><th>References</th></tr></thead><tbody>{filtered.map((row: AnyRow) => <tr className="border-t align-top" key={row.id}><td className="py-2">{row.logicalSourceCode}<br />{row.originalSheetName} · {row.sourceRowNumber}</td><td><b className="font-mono">{row.coaCode}</b><br />{row.descriptionRaw}</td><td>{rupiah(row.rawAmount)}</td><td className="font-bold">{rupiah(row.mappedAmount)}</td><td>{row.analyticalClass}</td><td>{row.mappingStatus} / {row.mappingAction ?? '—'}</td><td>{row.costGroupCode ?? '—'} / {row.natureCode ?? '—'}</td><td>{row.ruleCode ?? '—'}<br />#{row.mappingId ?? '—'} · {row.mappingEffectiveDate?.slice(0, 10) ?? '—'}</td><td><details><summary>View JSON</summary><pre className="max-w-sm whitespace-pre-wrap">{JSON.stringify(row.referenceJson, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
          </section>

          <section className={`rounded-2xl border p-5 ${hasBlockingIssue ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <h2 className="font-bold">Blocking & diagnostic issues</h2>
            {!hasBlockingIssue && <p className="mt-2 text-sm font-semibold text-emerald-800">Zero blocking issues. All persisted Stage E controls PASS.</p>}
            {hasBlockingIssue && <ul className="mt-2 list-disc pl-5 text-sm">{blockingIssues.map((issue: AnyRow) => <li key={issue.id}><b>{issue.severity}</b> · {issue.issueCode}: {issue.message}</li>)}{failedControls.map((control: AnyRow) => <li key={control.id}>{control.controlCode}: {control.status} ({rupiah(control.difference)})</li>)}</ul>}
            {diagnosticIssues.length > 0 && <div className="mt-3 border-t border-current/10 pt-3"><p className="text-xs font-bold uppercase">Non-blocking diagnostics</p><ul className="mt-1 list-disc pl-5 text-sm">{diagnosticIssues.map((issue: AnyRow) => <li key={issue.id}><b>{issue.severity}</b> · {issue.issueCode}: {issue.message}</li>)}</ul></div>}
          </section>
        </>}

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">Run history</h2>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Run</th><th>Stage</th><th>Upload</th><th>Status</th><th>State</th><th>Ruleset</th><th>Started / completed</th><th>Rows R/C/A</th><th>Error / invalidation</th></tr></thead><tbody>{data.history.map((history: AnyRow) => <tr className={`border-t ${history.isActive && history.status === 'SUCCESS' ? 'bg-emerald-50' : ''}`} key={history.id}><td className="py-2">#{history.runNumber} / ID {history.id}</td><td>{history.stage ?? '—'}</td><td>#{history.uploadId} / v{history.uploadVersion ?? '—'}</td><td><Badge status={history.status} /></td><td>{history.isActive ? 'ACTIVE' : 'INACTIVE'}</td><td>{history.ruleSetVersion}</td><td>{new Date(history.startedAt).toLocaleString()}<br />{history.completedAt ? new Date(history.completedAt).toLocaleString() : '—'}</td><td>{history.resultCount}/{history.controlCount}/{history.analyticalRowCount}</td><td>{history.errorMessage ?? '—'}</td></tr>)}</tbody></table></div>
          {!data.exportEligibility.eligible && <p className="mt-3 text-xs text-amber-800">Export blocked: {data.exportEligibility.reasons.join(' ')}</p>}
        </section>
      </>}
    </div>
  );
}
