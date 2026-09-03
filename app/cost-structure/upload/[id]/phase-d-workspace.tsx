'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CostModuleFrame from '@/app/components/CostModuleFrame';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import ProcessWorkflow from '@/components/cost-structure/process/process-workflow';
import { getLockedCostGroupCode } from '@/lib/cost-structure/mappings/source-cost-group-policy';

type Item = {
  logicalSourceCode: string;
  coaCodeRaw: string;
  description: string | null;
  rowCount: number;
  totalAmount: string;
  mappingStatus: string;
};

type Group = {
  id: number;
  code: string;
  natures: { id: number; code: string; name: string }[];
};

type MappingAction = 'INCLUDE' | 'EXCLUDE' | 'RECLASS';

type MappingDialogState = {
  item: Item;
  action: MappingAction;
  natureId: string;
  reason: string;
};

function amountIsBlocking(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) > 1;
}

function amountIsZero(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}

function lockedGroup(groups: Group[] | undefined, logicalSourceCode: string): Group | null {
  const code = getLockedCostGroupCode(logicalSourceCode);
  return code ? groups?.find((group) => group.code === code) ?? null : null;
}

export default function PhaseDWorkspace({ uploadId }: { uploadId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [rec, setRec] = useState<Record<string, unknown> | null>(null);
  const [map, setMap] = useState<{ items: Item[]; groups: Group[] } | null>(null);
  const [mappingDialog, setMappingDialog] = useState<MappingDialogState | null>(null);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      fetch(`/api/cost-structure/uploads/${uploadId}`),
      fetch(`/api/cost-structure/uploads/${uploadId}/reconciliation`),
      fetch(`/api/cost-structure/uploads/${uploadId}/mapping`),
    ]);
    if (!a.ok) throw new Error('Upload tidak ditemukan.');
    setData(await a.json());
    setRec(await b.json());
    setMap(await c.json());
  }, [uploadId]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function revalidate() {
    setBusy(true);
    setError('');
    const response = await fetch(`/api/cost-structure/uploads/${uploadId}/revalidate`, { method: 'POST' });
    const value = await response.json();
    if (!response.ok) setError(value.error ?? 'Revalidation gagal.');
    await load();
    setBusy(false);
  }

  function openMappingDialog(item: Item, action: MappingAction) {
    const group = action === 'EXCLUDE' ? null : lockedGroup(map?.groups, item.logicalSourceCode);
    setMappingDialog({
      item,
      action,
      natureId: group?.natures[0] ? String(group.natures[0].id) : '',
      reason: '',
    });
    setError('');
  }

  async function submitMapping() {
    if (!mappingDialog) return;
    const { item, action, natureId, reason } = mappingDialog;
    const group = action === 'EXCLUDE' ? null : lockedGroup(map?.groups, item.logicalSourceCode);
    if (action !== 'EXCLUDE' && (!group || !natureId)) {
      setError('Cost Group source tidak tersedia atau Nature belum dipilih.');
      return;
    }
    if ((action === 'EXCLUDE' || action === 'RECLASS') && !reason.trim()) {
      setError(`Alasan ${action === 'EXCLUDE' ? 'exclude' : 'reclassify'} wajib diisi.`);
      return;
    }

    setBusy(true);
    setError('');
    const response = await fetch(`/api/cost-structure/uploads/${uploadId}/mapping/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        logicalSourceCode: item.logicalSourceCode,
        coaCodeRaw: item.coaCodeRaw,
        mappingAction: action,
        natureId: action === 'EXCLUDE' ? undefined : Number(natureId),
        reason: reason.trim(),
        note: reason.trim(),
      }),
    });
    const value = await response.json();
    if (!response.ok) {
      setError(value.error ?? 'Resolusi mapping gagal.');
      setBusy(false);
      return;
    }

    setMappingDialog(null);
    await load();
    setBusy(false);
    // Refresh the process tracker so a newly-ready upload can continue through the
    // normal automatic stages. FINALIZE remains explicit/manual.
    window.location.reload();
  }

  const upload = (data?.upload ?? {}) as Record<string, unknown>;
  const period = (upload.period ?? {}) as Record<string, unknown>;
  const company = (period.company ?? {}) as Record<string, unknown>;
  const sources = (rec?.sources ?? []) as Record<string, unknown>[];
  const completeness = (rec?.completeness ?? {}) as Record<string, unknown>;
  const issues = (upload.validationIssues ?? []) as Record<string, unknown>[];
  const canRevalidate = upload.isActiveVersion === true && upload.status === 'VALIDATION_FAILED';

  const unmappedItems = useMemo(
    () => (map?.items ?? []).filter((item) => item.mappingStatus === 'UNMAPPED'),
    [map]
  );
  const blockingUnmapped = useMemo(
    () => unmappedItems.filter((item) => amountIsBlocking(item.totalAmount)),
    [unmappedItems]
  );
  const deMinimisUnmapped = useMemo(
    () => unmappedItems.filter((item) => !amountIsBlocking(item.totalAmount) && !amountIsZero(item.totalAmount)),
    [unmappedItems]
  );
  const zeroUnmapped = useMemo(
    () => unmappedItems.filter((item) => amountIsZero(item.totalAmount)),
    [unmappedItems]
  );

  const selectedGroup = mappingDialog && mappingDialog.action !== 'EXCLUDE'
    ? lockedGroup(map?.groups, mappingDialog.item.logicalSourceCode)
    : null;

  return (
    <CostModuleFrame title="Source Reconciliation & Mapping" subtitle="Cost Structure Phase D" contentClassName="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div data-cost-motion className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Upload #{uploadId}</h1>
            <p className="text-muted-foreground">{String(company.companyCode ?? '')} · {String(period.fiscalYear ?? '')}/{String(period.fiscalPeriod ?? '')} · v{String(upload.version ?? '')} · {String(upload.originalFileName ?? '')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{upload.isActiveVersion ? 'Active' : 'Superseded'} · {String(upload.status ?? '')} · Period {String(rec?.periodStatus ?? '')}</p>
          </div>
          {canRevalidate && <button disabled={busy} onClick={revalidate} className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0">{busy ? 'Processing…' : 'Revalidate file'}</button>}
        </div>

        {canRevalidate && <p data-cost-motion className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">File ini gagal validasi dengan rule sebelumnya. Revalidate menjalankan ulang parser terbaru pada file/hash yang sama tanpa membuat upload version duplikat.</p>}
        {error && <p data-cost-motion className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <ProcessWorkflow uploadId={uploadId} />

        {blockingUnmapped.length > 0 && (
          <div data-cost-motion className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">Mapping manual diperlukan untuk {blockingUnmapped.length} COA.</div>
            <p className="mt-1">Cost Group dikunci otomatis dari source. User hanya menentukan Nature untuk mapping Include/Reclassify agar tidak terjadi salah grouping.</p>
            <a href="#mapping-detail" className="mt-3 inline-flex rounded-md bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700">Buka mapping manual</a>
          </div>
        )}

        <details data-cost-motion className="group min-w-0 rounded-xl border bg-card" open={blockingUnmapped.length > 0}>
          <summary className="cursor-pointer list-none p-4 font-semibold sm:p-6">Detail proses <span className="ml-1 text-sm font-normal text-muted-foreground group-open:hidden">(tampilkan)</span></summary>
          <div className="min-w-0 space-y-6 px-4 pb-4 sm:px-6 sm:pb-6">
            <Card data-cost-hover className="min-w-0 transition-shadow hover:shadow-md">
              <CardHeader><CardTitle>Source reconciliation</CardTitle></CardHeader>
              <CardContent><Table headers={['Source', 'Detail Rows', 'Detail Amount', 'Reported Amount', 'Difference', 'Status']} rows={sources.map((s) => [s.logicalSourceCode, s.detailRowCount, s.detailAmount, s.reportedAmount ?? '—', s.difference ?? '—', s.status])} /></CardContent>
            </Card>

            <Card data-cost-hover className="min-w-0 transition-shadow hover:shadow-md">
              <CardHeader><CardTitle>Mapping completeness</CardTitle></CardHeader>
              <CardContent><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{['mappedAmount', 'excludedAmount', 'reclassifiedAmount', 'unmappedAmount', 'unmappedCoaCount', 'blockingDifference'].map((key) => <Metric key={key} label={key} value={String(completeness[key] ?? '—')} />)}</div></CardContent>
            </Card>

            <Card id="mapping-detail" data-cost-hover className="min-w-0 scroll-mt-4 transition-shadow hover:shadow-md">
              <CardHeader><CardTitle>Unmapped COA work queue</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {blockingUnmapped.length === 0 && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Tidak ada COA material yang membutuhkan mapping. Work queue bersih.</div>}
                {deMinimisUnmapped.length > 0 && <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{deMinimisUnmapped.length} COA masih UNMAPPED dengan total non-zero absolut ≤ Rp1. Item de-minimis ini tetap tercatat untuk audit tetapi tidak memblokir rekonsiliasi.</div>}
                {zeroUnmapped.length > 0 && <div className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{zeroUnmapped.length} COA bernilai tepat Rp0 hanya dipertahankan sebagai audit evidence. Item Rp0 bukan error, bukan de-minimis exception, dan tidak memerlukan mapping manual.</div>}
                <Table headers={['Source', 'COA', 'Description', 'Rows', 'Amount', 'Status', 'Action']} rows={blockingUnmapped.map((item) => [
                  item.logicalSourceCode,
                  item.coaCodeRaw,
                  item.description ?? '—',
                  item.rowCount,
                  item.totalAmount,
                  item.mappingStatus,
                  <span className="flex flex-wrap gap-2" key={`${item.logicalSourceCode}:${item.coaCodeRaw}`}>
                    <button disabled={busy} onClick={() => openMappingDialog(item, 'INCLUDE')} className="font-medium text-red-700 hover:underline disabled:opacity-50">Map</button>
                    <button disabled={busy} onClick={() => openMappingDialog(item, 'EXCLUDE')} className="font-medium text-red-700 hover:underline disabled:opacity-50">Exclude</button>
                    <button disabled={busy} onClick={() => openMappingDialog(item, 'RECLASS')} className="font-medium text-red-700 hover:underline disabled:opacity-50">Reclassify</button>
                  </span>,
                ])} />
              </CardContent>
            </Card>

            <Card data-cost-hover className="min-w-0 transition-shadow hover:shadow-md">
              <CardHeader><CardTitle>Validation issues</CardTitle></CardHeader>
              <CardContent><Table headers={['State', 'Severity', 'Code', 'Message']} rows={issues.map((issue) => [issue.resolved ? 'Resolved' : 'Open', issue.severity, issue.issueCode, issue.message])} /></CardContent>
            </Card>

            <Card data-cost-hover className="min-w-0 transition-shadow hover:shadow-md">
              <CardHeader><CardTitle>Readiness</CardTitle></CardHeader>
              <CardContent><p className="font-semibold">{rec?.ready ? 'SOURCE_RECONCILED' : 'SOURCE_VALIDATION'}</p><ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{((rec?.blockers ?? []) as string[]).map((x) => <li key={x}>{x}</li>)}</ul></CardContent>
            </Card>
          </div>
        </details>
      </div>

      {mappingDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Konfirmasi mapping manual">
          <div className="w-full max-w-lg rounded-xl bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Konfirmasi mapping manual</h2>
                <p className="mt-1 text-sm text-muted-foreground">{mappingDialog.item.logicalSourceCode} · COA {mappingDialog.item.coaCodeRaw} · {mappingDialog.item.description ?? '—'}</p>
                <p className="mt-1 text-sm font-medium">Amount: {mappingDialog.item.totalAmount}</p>
              </div>
              <button disabled={busy} onClick={() => setMappingDialog(null)} className="rounded-md border px-2 py-1 text-sm disabled:opacity-50">Tutup</button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Action</label>
                <select
                  value={mappingDialog.action}
                  onChange={(event) => {
                    const action = event.target.value as MappingAction;
                    const group = action === 'EXCLUDE' ? null : lockedGroup(map?.groups, mappingDialog.item.logicalSourceCode);
                    setMappingDialog({ ...mappingDialog, action, natureId: group?.natures[0] ? String(group.natures[0].id) : '' });
                  }}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="INCLUDE">Map / Include</option>
                  <option value="EXCLUDE">Exclude</option>
                  <option value="RECLASS">Reclassify</option>
                </select>
              </div>

              {mappingDialog.action !== 'EXCLUDE' && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Cost Group</label>
                    <div className="flex items-center justify-between rounded-md border bg-muted/60 px-3 py-2 text-sm">
                      <span className="font-semibold">{selectedGroup?.code ?? 'Tidak tersedia'}</span>
                      <span className="text-xs text-muted-foreground">Otomatis dari source · terkunci</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Nature</label>
                    <select value={mappingDialog.natureId} onChange={(event) => setMappingDialog({ ...mappingDialog, natureId: event.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      {(selectedGroup?.natures ?? []).map((nature) => <option key={nature.id} value={nature.id}>{nature.code} · {nature.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">Catatan / alasan {mappingDialog.action === 'INCLUDE' ? '(opsional)' : '(wajib)'}</label>
                <textarea value={mappingDialog.reason} onChange={(event) => setMappingDialog({ ...mappingDialog, reason: event.target.value })} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Jelaskan dasar mapping jika diperlukan." />
              </div>

              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                Cost Group ditentukan dari logical source di server dan tidak dapat dioverride dari browser. Setelah dikonfirmasi, sistem membuat mapping effective-dated untuk Company + Source + COA, mencatat audit trail, lalu menjalankan ulang Phase D. Mapping tidak boleh mengubah periode FINALIZED.
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button disabled={busy} onClick={() => setMappingDialog(null)} className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50">Batal</button>
              <button disabled={busy} onClick={submitMapping} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Menyimpan…' : 'Konfirmasi & Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </CostModuleFrame>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (unknown | React.ReactNode)[][] }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border overscroll-x-contain">
      <table className="w-full min-w-max text-left text-xs sm:text-sm">
        <thead className="bg-muted/40"><tr className="border-b">{headers.map((header) => <th className="p-2 font-medium" key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr className="border-b transition-colors hover:bg-muted/30" key={i}>{row.map((value, j) => <td className="max-w-56 whitespace-nowrap p-2 tabular-nums" key={j}>{value as React.ReactNode}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"><div className="text-xs text-muted-foreground">{label}</div><b className="tabular-nums">{value}</b></div>;
}
