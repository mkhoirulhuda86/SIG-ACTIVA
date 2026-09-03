'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { costStructureProcessApi, ProcessApiError } from './api';
import { shouldAttemptMappingRecovery, shouldAutoAdvance } from './presentation';
import { ProcessTracker } from './process-tracker';
import type { CostStructureProcess } from './types';

const NETWORK_BACKOFF_MS = [1200, 2500, 5000];
type WorkflowError = { title: string; message: string; detail?: string };

function mappingRecoveryRefreshKey(uploadId: number) {
  return `cost-structure:mapping-recovery-refresh:${uploadId}`;
}

export default function ProcessWorkflow({ uploadId, onProcessChange }: { uploadId: number; onProcessChange?: (value: CostStructureProcess) => void }) {
  const [process, setProcess] = useState<CostStructureProcess | null>(null);
  const [error, setError] = useState<WorkflowError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [auditMessage, setAuditMessage] = useState('');
  const requestInFlight = useRef(false);
  const networkAttempt = useRef(0);
  const mappingRecoveryAttemptedForUpload = useRef<number | null>(null);

  const update = useCallback((value: CostStructureProcess) => { setProcess(value); onProcessChange?.(value); }, [onProcessChange]);
  const load = useCallback(async () => {
    try { update(await costStructureProcessApi.get(uploadId)); setError(null); networkAttempt.current = 0; }
    catch (caught) {
      const e = caught instanceof ProcessApiError ? caught : new ProcessApiError(caught instanceof Error ? caught.message : 'Koneksi proses gagal.');
      if (e.process) update(e.process);
      setError({ title: 'Koneksi proses terganggu', message: e.message, detail: e.technicalDetail });
    }
  }, [uploadId, update]);

  const advance = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true; setSubmitting(true);
    try {
      await costStructureProcessApi.advance(uploadId);
      update(await costStructureProcessApi.get(uploadId));
      setError(null); networkAttempt.current = 0;
    } catch (caught) {
      const e = caught instanceof ProcessApiError ? caught : new ProcessApiError(caught instanceof Error ? caught.message : 'Koneksi proses gagal.');
      if (e.process) {
        // A 409 with authoritative process state is a business/no-progress stop, not
        // a network retry. Keep the server state visible and require explicit retry
        // so a WAITING stage cannot create an automatic POST loop.
        update(e.process);
        setError({ title: 'Tahap proses belum dapat dilanjutkan', message: e.message, detail: e.technicalDetail });
        networkAttempt.current = NETWORK_BACKOFF_MS.length;
      } else {
        setError({ title: 'Koneksi proses terganggu', message: e.message, detail: e.technicalDetail });
        if (e.retryable) networkAttempt.current = Math.min(networkAttempt.current + 1, NETWORK_BACKOFF_MS.length);
        else networkAttempt.current = NETWORK_BACKOFF_MS.length;
      }
    } finally { requestInFlight.current = false; setSubmitting(false); }
  }, [uploadId, update]);

  useEffect(() => {
    // Mapping recovery mutates persisted mapping/readiness outside the parent workspace's
    // initial GETs. After a recovery we reload once so its work queue cannot keep showing
    // stale pre-recovery counts. The session marker suppresses exactly the immediate
    // post-reload recovery attempt, preventing a reload loop when genuine blockers remain.
    const refreshKey = mappingRecoveryRefreshKey(uploadId);
    const skipImmediateRecovery = window.sessionStorage.getItem(refreshKey) === '1';
    if (skipImmediateRecovery) window.sessionStorage.removeItem(refreshKey);
    mappingRecoveryAttemptedForUpload.current = skipImmediateRecovery ? uploadId : null;
    void load();
  }, [load, uploadId]);
  useEffect(() => {
    if (!process || requestInFlight.current) return;

    // A persisted mapping blocker may pre-date newly approved effective-dated mappings.
    // Run the idempotent reconciliation/backfill action exactly once per page mount.
    // After the attempt, reload once to synchronize the mapping work queue. A one-shot
    // session marker prevents the reload from immediately repeating the same recovery.
    if (
      shouldAttemptMappingRecovery(process) &&
      mappingRecoveryAttemptedForUpload.current !== uploadId
    ) {
      mappingRecoveryAttemptedForUpload.current = uploadId;
      const timer = window.setTimeout(() => {
        void (async () => {
          await advance();
          window.sessionStorage.setItem(mappingRecoveryRefreshKey(uploadId), '1');
          window.location.reload();
        })();
      }, 300);
      return () => window.clearTimeout(timer);
    }

    if (!shouldAutoAdvance(process)) return;
    if (error && networkAttempt.current >= NETWORK_BACKOFF_MS.length) return;
    const delay = NETWORK_BACKOFF_MS[Math.max(0, networkAttempt.current - 1)] ?? 900;
    const timer = window.setTimeout(() => void advance(), delay);
    return () => window.clearTimeout(timer);
  }, [advance, process, error, uploadId]);

  const hydrateAudit = async () => {
    if (!process || requestInFlight.current) return;
    requestInFlight.current = true; setSubmitting(true); setAuditMessage(''); setError(null);
    try {
      const response = await fetch(`/api/cost-structure/periods/${process.periodId}/hydrate-audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUploadId: uploadId }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? 'Refresh referensi export gagal.');
      setAuditMessage(`Referensi export siap · ${Number(value.rowCount ?? 0).toLocaleString('id-ID')} rows · hash terverifikasi.`);
      await load();
    } catch (caught) {
      setError({ title: 'Referensi export belum siap', message: caught instanceof Error ? caught.message : 'Refresh referensi export gagal.' });
    } finally { requestInFlight.current = false; setSubmitting(false); }
  };

  const finalize = async () => {
    if (!process?.readyForFinalization || requestInFlight.current) return;
    requestInFlight.current = true; setSubmitting(true);
    try {
      const response = await fetch(`/api/cost-structure/periods/${process.periodId}/finalize`, { method: 'POST' });
      if (!response.ok) throw new Error('Finalisasi gagal. Periksa kembali kesiapan periode.');
      await load();
    } catch (caught) { setError({ title: 'Finalisasi gagal', message: caught instanceof Error ? caught.message : 'Finalisasi gagal.' }); }
    finally { requestInFlight.current = false; setSubmitting(false); }
  };

  if (!process) return <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">{error ? <InlineError error={error} retry={load} /> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Memuat status proses…</p>}</section>;

  const auditStage = process.stages.find((stage) => stage.key === 'AUDIT_READINESS');
  const auditNeedsPreparation = auditStage?.status === 'NOT_APPLICABLE';
  return <div className="min-w-0 space-y-3">
    <ProcessTracker process={process} submitting={submitting} onRetry={advance} onFinalize={finalize} />
    {process.requiresRecalculation && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950"><div className="min-w-0"><p className="font-semibold">Calculation lama harus dihitung ulang</p><p className="mt-1 break-words text-xs">Reopen atau perubahan rule Engine 1 membuat run sebelumnya stale. Reconciliation/finalization ditahan sampai run baru berhasil.</p></div><button type="button" disabled={submitting} onClick={() => void advance()} className="rounded-md bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{submitting ? 'Menghitung ulang…' : 'Recalculate'}</button></div>}
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><div className="min-w-0"><p className="font-medium">{auditNeedsPreparation ? 'Audit/reference export belum lengkap' : 'Audit/reference export tersimpan'}</p><p className="mt-1 break-words text-xs text-muted-foreground">Refresh membaca ulang hanya AUDIT_* dan sheet referensi dari workbook authoritative yang hash-nya terverifikasi; Engine 1 dan calculation run tidak diubah.</p></div><button type="button" disabled={submitting} onClick={() => void hydrateAudit()} className="rounded-md border border-primary px-3 py-2 font-medium text-primary disabled:opacity-50">{submitting ? 'Menyiapkan…' : auditNeedsPreparation ? 'Siapkan referensi export' : 'Refresh referensi export'}</button></div>
    {auditMessage && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{auditMessage}</p>}
    {error && <InlineError error={error} retry={advance} />}
  </div>;
}

function InlineError({ error, retry }: { error: WorkflowError; retry: () => void | Promise<void> }) {
  return <div className="max-w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{error.title}</p><p className="mt-1 break-words">{error.message}</p>{error.detail && <details className="mt-2"><summary className="cursor-pointer font-medium">Technical detail</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{error.detail}</pre></details>}<button type="button" onClick={() => void retry()} className="mt-3 rounded-md border border-amber-700 px-3 py-1.5 font-medium">Coba lagi</button></div>;
}
