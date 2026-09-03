'use client';

import { useMemo, useState } from 'react';
import { CommentaryEditor, type CommentaryView } from './commentary-editor';
import { CommentaryStatusBadge } from './commentary-status-badge';
import { governancePermissions, isCommentaryTarget } from '@/lib/cost-fluctuation/governance/presentation';

type PeriodOption = { id: number; companyCode: string; fiscalYear: number; fiscalPeriod: number };
type Row = { key: string; label: string; nodeType: string; varianceAmount: string; variancePercent: string | null; materialityStatus: string; suggestedCommentary?: {text:string}; children?: Row[] };
type Overlay = { kind?: string; hierarchy?: Row[]; status?: string; comparisonLabel?: string; commentaries?: CommentaryView[]; analysisLineageKey?: string; error?: string; code?: string };
const flatten = (rows: Row[], depth = 0): Array<Row & { depth: number }> => rows.flatMap((row) => [{ ...row, depth }, ...flatten(row.children ?? [], depth + 1)]);

export default function GovernanceWorkspace({ periodOptions, role, currentUserId }: { periodOptions: PeriodOption[]; role: string; currentUserId?: number }) {
  const [companyCode, setCompanyCode] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [comparison, setComparison] = useState('MOM');
  const [selected, setSelected] = useState('');
  const [data, setData] = useState<Overlay | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const permissions = governancePermissions(role);
  const companies = useMemo(() => [...new Set(periodOptions.map((period) => period.companyCode))].sort(), [periodOptions]);
  const companyPeriods = useMemo(() => periodOptions.filter((period) => period.companyCode === companyCode), [companyCode, periodOptions]);

  const reset = () => { setData(null); setSelected(''); setMessage(''); };

  async function load() {
    if (!periodId) return;
    setLoading(true); setMessage('');
    try {
      const response = await fetch(`/api/cost-fluctuation/commentary?periodId=${periodId}&comparison=${comparison}`);
      const body = await response.json() as Overlay;
      setData(body);
      if (!response.ok) setMessage(body.code === 'FLUCTUATION_INTEGRITY_ERROR' ? `Integrity error: ${body.error ?? 'analysis lineage is invalid.'}` : body.error ?? 'Unable to load commentary context.');
    } catch {
      setMessage('Unable to connect to the commentary service.'); setData(null);
    } finally { setLoading(false); }
  }

  async function action(kind: 'draft', payload?: string) {
    if (kind !== 'draft') return;
    const config = { path: '/api/cost-fluctuation/commentary/draft', body: { periodId: Number(periodId), comparisonType: comparison, analysisKey: selected, reason: payload } };
    setLoading(true); setMessage('');
    try {
      const response = await fetch(config.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config.body) });
      const body = await response.json();
      if (!response.ok) {
        const error = String(body.error ?? 'Save failed.');
        setMessage(error.toLowerCase().includes('stale') || error.toLowerCase().includes('lineage') ? 'Commentary ini berasal dari lineage lama dan tidak digunakan. Muat ulang analysis terkini lalu simpan commentary pada exact context yang aktif.' : error);
        return;
      }
      await load(); setMessage('Commentary berhasil disimpan langsung. Tidak ada approval lanjutan.');
    } catch { setMessage('Unable to connect to the commentary service.'); }
    finally { setLoading(false); }
  }

  const current = data?.commentaries?.find((item) => item.analysisKey === selected);
  return <section className="space-y-5">
    <div className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap gap-3">
        <select className="min-w-48 rounded border px-3 py-2" value={companyCode} onChange={(event) => { const next = event.target.value; setCompanyCode(next); setPeriodId(String(periodOptions.find((period) => period.companyCode === next)?.id ?? '')); reset(); }}><option value="">Pilih Company Code</option>{companies.map((code) => <option key={code}>{code}</option>)}</select>
        <select className="min-w-52 rounded border px-3 py-2" value={periodId} disabled={!companyCode} onChange={(event) => { setPeriodId(event.target.value); reset(); }}><option value="">Pilih periode finalized</option>{companyPeriods.map((period) => <option key={period.id} value={period.id}>{period.fiscalYear}/{String(period.fiscalPeriod).padStart(2, '0')}</option>)}</select>
        <select className="rounded border px-3 py-2" value={comparison} onChange={(event) => { setComparison(event.target.value); reset(); }}><option>MOM</option><option>YOY</option><option>YTD</option></select>
        <button className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50" onClick={load} disabled={loading || !periodId}>{loading ? 'Memuat…' : 'Muat commentary'}</button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Commentary wajib hanya pada Nature yang material. COA dapat diberi commentary secara optional. Cost Group, Calculated Item, COMPANY, dan ANALYSIS_BASIS adalah context-only.</p>
    </div>
    {message && <p role="status" className="rounded border bg-slate-50 p-3 text-sm">{message}</p>}
    {data?.status === 'UNAVAILABLE' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong>Comparison unavailable</strong><p className="text-sm">{data.comparisonLabel}. Historical data yang belum tersedia tidak dianggap nol dan tidak membutuhkan commentary untuk comparison ini.</p></div>}
    {data?.status === 'AVAILABLE' && <>
      <div className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p>{data.comparisonLabel}: <strong>AVAILABLE</strong></p><a href={`/cost-fluctuation/review?periodId=${periodId}`} className="text-sm font-medium text-red-700">Buka review readiness →</a></div><p className="mt-1 text-xs text-slate-500">Lineage: <code>{data.analysisLineageKey?.slice(0, 16)}…</code>. Commentary hanya dimuat untuk exact run/upload/ruleset/comparison lineage.</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Analytical hierarchy</th><th>Variance</th><th>Variance %</th><th>Materiality</th><th>Commentary</th></tr></thead><tbody>{flatten(data.hierarchy ?? []).map((row) => { const target = isCommentaryTarget(row.nodeType); const commentary = data.commentaries?.find((item) => item.analysisKey === row.key); return <tr key={row.key} className={`border-t ${target ? 'cursor-pointer hover:bg-red-50' : 'bg-slate-50/60'}`} onClick={() => target && setSelected(row.key)}><td className="p-3" style={{ paddingLeft: 12 + row.depth * 18 }}><span>{row.label}</span>{row.nodeType === 'ANALYSIS_BASIS' && <span className="ml-2 rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800">basis context</span>}<span className="ml-2 text-xs text-slate-400">{row.nodeType}</span></td><td>{row.varianceAmount}</td><td>{row.variancePercent ?? 'N/M'}</td><td><span className={row.materialityStatus === 'NOT_CONFIGURED' ? 'font-semibold text-red-700' : ''}>{row.materialityStatus}</span></td><td>{target ? <CommentaryStatusBadge status={commentary?.status ?? (row.nodeType === 'NATURE' && row.materialityStatus === 'REQUIRES_EXPLANATION' ? 'OPEN' : '—')} /> : <span className="text-slate-400">Context only</span>}</td></tr>; })}</tbody></table></div>
        {selected ? <CommentaryEditor key={`${selected}:${current?.id ?? 'new'}:${current?.status ?? 'OPEN'}`} analysisKey={selected} commentary={current} suggestedText={flatten(data.hierarchy ?? []).find(row=>row.key===selected)?.suggestedCommentary?.text} permissions={permissions} currentUserId={currentUserId} busy={loading} onAction={action} /> : <div className="rounded-xl border border-dashed p-5 text-sm text-slate-500">Pilih Nature untuk commentary wajib atau COA bila diperlukan commentary tambahan. Save dilakukan langsung tanpa approval.</div>}
      </div>
    </>}
    {!periodOptions.length && <p className="rounded border border-amber-200 bg-amber-50 p-4">Belum ada Cost Structure period berstatus FINALIZED.</p>}
  </section>;
}
