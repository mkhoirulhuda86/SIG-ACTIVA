'use client';
import { useState } from 'react';
import { commentaryActions, type GovernancePermissions } from '@/lib/cost-fluctuation/governance/presentation';
import { CommentaryStatusBadge } from './commentary-status-badge';

export type CommentaryView = { id: number; analysisKey: string; status: string; reason: string; generatedText?: string | null; reviewerNote?: string | null; preparedBy?: { id: number; name: string }; reviewedBy?: { id: number; name: string }; history?: Array<{ id: number; version: number; status: string; reason: string; reviewerNote?: string | null; createdAt?: string }> };

export function CommentaryEditor({ analysisKey, commentary, suggestedText, context, permissions, currentUserId, busy, onAction }: { analysisKey: string; commentary?: CommentaryView; suggestedText?: string; context?: React.ReactNode; permissions: GovernancePermissions; currentUserId?: number; busy: boolean; onAction: (action: 'draft', payload?: string) => Promise<void> }) {
  const [reason, setReason] = useState(commentary?.reason ?? suggestedText ?? '');
  const actions = commentaryActions(commentary?.status, permissions, commentary?.preparedBy?.id, currentUserId);
  return <aside className="space-y-4 rounded-xl border bg-white p-5" aria-label="Commentary editor">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-medium uppercase text-slate-500">Exact analytical target</p><p className="break-all font-medium">{analysisKey}</p></div><CommentaryStatusBadge status={commentary?.status} /></div>
    {context}
    {(commentary?.generatedText || suggestedText) && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"><strong>Penjelasan kuantitatif sistem</strong><p className="mt-1 whitespace-pre-wrap text-slate-700">{commentary?.generatedText ?? suggestedText}</p><p className="mt-2 text-xs text-blue-800">Baseline sistem menjelaskan apa yang berubah, bukan justifikasi bisnis. Baseline tersimpan terpisah saat commentary pertama disimpan.</p></div>}
    <div className="rounded border border-red-100 bg-red-50 p-3 text-sm text-red-900">Save berlaku langsung tanpa approval. Commentary Nature digunakan untuk readiness; commentary COA bersifat optional.</div>
    <label className="block text-sm font-medium">Commentary<textarea className="mt-1 block min-h-32 w-full rounded border p-3 disabled:bg-slate-50" maxLength={5000} value={reason} disabled={!actions.canEdit || busy} onChange={(event) => setReason(event.target.value)} placeholder="Jelaskan business driver untuk perubahan biaya." /></label>
    <div className="flex flex-wrap gap-2">{actions.canEdit && <button disabled={busy || !reason.trim()} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50" onClick={() => onAction('draft', reason)}>{busy ? 'Menyimpan…' : 'Save commentary'}</button>}</div>
    {!permissions.canPrepare && <p className="text-sm text-slate-500">Read-only access: hanya Staff Accounting dan Admin yang dapat menyimpan commentary.</p>}
    {!!commentary?.history?.length && <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-semibold">Audit history ({commentary.history.length})</summary><ol className="mt-2 space-y-2">{commentary.history.map((item) => <li key={item.id} className="rounded bg-slate-50 p-2 text-sm"><strong>v{item.version} · {item.status}</strong><p className="whitespace-pre-wrap text-slate-700">{item.reason}</p>{item.reviewerNote && <p className="text-amber-800">Legacy note: {item.reviewerNote}</p>}</li>)}</ol></details>}
  </aside>;
}
