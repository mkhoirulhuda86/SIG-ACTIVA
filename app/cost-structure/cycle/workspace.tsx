'use client';

import { useMemo, useState } from 'react';

type Receiver = {
  receiverCc: string;
  receiverDescription: string;
  plantCode: string;
  plantName: string;
  processLabel: string;
  baselineStatus: 'ON' | 'OFF';
  fixedRowCount: number;
  variableRowCount: number;
  reference?: {
    preferredReferenceCc?: string;
    reviewStatus: string;
    confidence: string;
  };
};

type ReferenceCandidate = {
  receiverCc: string;
  receiverDescription: string;
  plantCode: string;
  plantName: string;
  processLabel: string;
};

type Baseline = {
  upload: {
    id: number;
    version: number;
    hash: string;
    originalFileName: string;
    status: string;
    totalRowCount: number;
    fixedRowCount: number;
    variableRowCount: number;
    uniqueReceiverCcCount: number;
    errorCount: number;
    warningCount: number;
    sourceSheet?: string;
    uploadedAt?: string;
    isActiveVersion?: boolean;
  };
  masterFingerprint: string;
  receivers: Receiver[];
  referenceCandidates: ReferenceCandidate[];
};

type TargetChange = {
  receiverCc: string;
  targetStatus: 'ON' | 'OFF';
  selectedReferenceCc?: string;
};

type PreviewChange = Receiver & {
  baselineStatus: 'ON' | 'OFF';
  targetStatus: 'ON' | 'OFF';
  action: string;
  referenceCc?: string;
  referenceSource?: string;
  referenceReviewStatus?: string;
  fixedAffectedRows: number;
  variableAffectedRows: number;
};

type Preview = {
  upload: { id: number; version: number; hash: string };
  masterFingerprint: string;
  changes: PreviewChange[];
  issues: { severity: string; message: string }[];
  generationBlocked: boolean;
  totalChangedCcCount: number;
};

type GeneratedFile = {
  id: number;
  fileName: string;
  rowCount: number;
  downloadUrl: string;
};

export default function CycleWorkspace() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [period, setPeriod] = useState(now.getUTCMonth() + 1);
  const [data, setData] = useState<Baseline | null>(null);
  const [targets, setTargets] = useState<Record<string, 'ON' | 'OFF'>>({});
  const [selectedReferences, setSelectedReferences] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const changes = useMemo<TargetChange[]>(() => {
    if (!data) return [];
    return data.receivers.flatMap((receiver) => {
      const targetStatus = targets[receiver.receiverCc] ?? receiver.baselineStatus;
      if (targetStatus === receiver.baselineStatus) return [];
      const selectedReferenceCc = selectedReferences[receiver.receiverCc];
      return [{
        receiverCc: receiver.receiverCc,
        targetStatus,
        ...(targetStatus === 'ON' && selectedReferenceCc
          ? { selectedReferenceCc }
          : {}),
      }];
    });
  }, [data, targets, selectedReferences]);

  const missingManualReference = useMemo(() => {
    if (!data) return false;
    return data.receivers.some((receiver) => {
      const targetStatus = targets[receiver.receiverCc] ?? receiver.baselineStatus;
      return receiver.baselineStatus === 'OFF'
        && targetStatus === 'ON'
        && receiver.reference?.reviewStatus === 'MANUAL_REQUIRED'
        && !selectedReferences[receiver.receiverCc];
    });
  }, [data, targets, selectedReferences]);

  function resetOperationalState() {
    setData(null);
    setTargets({});
    setSelectedReferences({});
    setPreview(null);
    setFiles([]);
    setMessage('');
  }

  async function load(notice?: string) {
    setBusy(true);
    if (!notice) setMessage('');
    const response = await fetch(
      `/api/cost-structure/cycle/baseline?fiscalYear=${year}&fiscalPeriod=${period}`,
    );
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setData(null);
      setTargets({});
      setSelectedReferences({});
      setPreview(null);
      setFiles([]);
      setMessage(notice ? `${notice} ${payload.error}` : payload.error);
      return;
    }

    setData(payload);
    setTargets(
      Object.fromEntries(
        payload.receivers.map((receiver: Receiver) => [
          receiver.receiverCc,
          receiver.baselineStatus,
        ]),
      ),
    );
    setSelectedReferences({});
    setPreview(null);
    setFiles([]);
    setMessage(notice ?? '');
  }

  async function upload(file: File) {
    setBusy(true);
    setMessage('');
    const mimeType =
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const init = await fetch('/api/cost-structure/cycle/upload/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: year,
        fiscalPeriod: period,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
      }),
    });
    const signed = await init.json();
    if (!init.ok) {
      setBusy(false);
      setMessage(signed.error);
      return;
    }

    const put = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body: file,
    });
    if (!put.ok) {
      setBusy(false);
      setMessage('Upload durable storage gagal.');
      return;
    }

    const complete = await fetch('/api/cost-structure/cycle/upload/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadContext: signed.uploadContext }),
    });
    const output = await complete.json();
    setBusy(false);

    const notice = complete.ok
      ? 'Upload valid telah menjadi baseline aktif.'
      : output.error
        ?? (output.upload
          ? `Workbook tidak valid (${output.upload.summary?.errorCount ?? 0} error) dan tidak menggantikan baseline aktif.`
          : 'Workbook tidak valid dan tidak menggantikan baseline aktif.');
    await load(notice);
  }

  async function doPreview() {
    if (missingManualReference) {
      setMessage('Pilih Reference CC manual untuk semua Receiver CC dengan status MANUAL_REQUIRED sebelum preview.');
      return;
    }
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/cost-structure/cycle/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fiscalYear: year, fiscalPeriod: period, targets: changes }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setPreview(null);
      setMessage(payload.error);
      return;
    }
    setPreview(payload);
  }

  async function generate() {
    if (!preview || !data) return;
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/cost-structure/cycle/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fiscalYear: year,
        fiscalPeriod: period,
        targets: changes,
        expectedUploadId: preview.upload.id,
        expectedVersion: preview.upload.version,
        expectedHash: preview.upload.hash,
        expectedMasterFingerprint: preview.masterFingerprint,
      }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setFiles(payload.files);
    setMessage('File delta SAP berhasil dibuat dan dicatat pada audit history.');
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border bg-card p-5">
        <h1 className="text-xl font-bold">Proses Cycle Bulanan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Satu toggle per Receiver CC. Seluruh baseline, reference, validasi, dan delta dihitung ulang di server.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            className="rounded-lg border px-3 py-2"
            type="number"
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value));
              resetOperationalState();
            }}
          />
          <select
            className="rounded-lg border px-3 py-2"
            value={period}
            onChange={(event) => {
              setPeriod(Number(event.target.value));
              resetOperationalState();
            }}
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index} value={index + 1}>Periode {index + 1}</option>
            ))}
          </select>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => load()}
            disabled={busy}
          >
            Muat Baseline
          </button>
          <label className="cursor-pointer rounded-lg border px-4 py-2">
            Upload Workbook
            <input
              className="hidden"
              type="file"
              accept=".xlsx"
              onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
            />
          </label>
        </div>
        {message && <p className="mt-3 text-sm">{message}</p>}
      </section>

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-9">
            {[
              ['File', data.upload.originalFileName],
              ['Versi', `v${data.upload.version} · ${data.upload.status}`],
              ['Total', data.upload.totalRowCount],
              ['Fixed', data.upload.fixedRowCount],
              ['Variable', data.upload.variableRowCount],
              ['Receiver CC', data.upload.uniqueReceiverCcCount],
              ['Source Sheet', data.upload.sourceSheet ?? '-'],
              ['Issues', `${data.upload.errorCount} E / ${data.upload.warningCount} W`],
              ['Operational', data.upload.isActiveVersion ? 'ACTIVE' : 'INACTIVE'],
            ].map(([key, value]) => (
              <div key={String(key)} className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">{key}</p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="border-b p-4">
              <b>Panel Receiver CC</b>
              <span className="ml-2 text-sm text-muted-foreground">{changes.length} perubahan</span>
            </div>
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {['Plant', 'Equipment / Receiver CC', 'Baseline', 'Target', 'Fixed', 'Variable', 'Reference'].map((label) => (
                      <th key={label} className="p-3 text-left">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.receivers.map((receiver) => {
                    const targetStatus = targets[receiver.receiverCc] ?? receiver.baselineStatus;
                    const manualRequired = receiver.baselineStatus === 'OFF'
                      && targetStatus === 'ON'
                      && receiver.reference?.reviewStatus === 'MANUAL_REQUIRED';
                    return (
                      <tr key={receiver.receiverCc} className="border-t">
                        <td className="p-3">
                          {receiver.plantCode}<br />
                          <span className="text-xs text-muted-foreground">{receiver.plantName}</span>
                        </td>
                        <td className="p-3">
                          <b>{receiver.processLabel}</b><br />
                          {receiver.receiverCc}<br />
                          <span className="text-xs text-muted-foreground">{receiver.receiverDescription}</span>
                        </td>
                        <td className="p-3 font-semibold">{receiver.baselineStatus}</td>
                        <td className="p-3">
                          <button
                            onClick={() => {
                              const nextStatus = targetStatus === 'ON' ? 'OFF' : 'ON';
                              setTargets((current) => ({
                                ...current,
                                [receiver.receiverCc]: nextStatus,
                              }));
                              if (nextStatus === 'OFF') {
                                setSelectedReferences((current) => {
                                  const next = { ...current };
                                  delete next[receiver.receiverCc];
                                  return next;
                                });
                              }
                              setPreview(null);
                              setFiles([]);
                            }}
                            className={`rounded-full px-4 py-2 font-semibold ${targetStatus === 'ON' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200'}`}
                          >
                            {targetStatus}
                          </button>
                        </td>
                        <td className="p-3">{receiver.fixedRowCount}</td>
                        <td className="p-3">{receiver.variableRowCount}</td>
                        <td className="p-3 text-xs">
                          {manualRequired ? (
                            <div className="space-y-1">
                              <select
                                className="max-w-[260px] rounded-md border bg-background px-2 py-1"
                                value={selectedReferences[receiver.receiverCc] ?? ''}
                                onChange={(event) => {
                                  setSelectedReferences((current) => ({
                                    ...current,
                                    [receiver.receiverCc]: event.target.value,
                                  }));
                                  setPreview(null);
                                  setFiles([]);
                                }}
                              >
                                <option value="">Pilih Reference CC</option>
                                {data.referenceCandidates
                                  .filter((candidate) => candidate.receiverCc !== receiver.receiverCc)
                                  .map((candidate) => (
                                    <option key={candidate.receiverCc} value={candidate.receiverCc}>
                                      {candidate.receiverCc} · {candidate.processLabel} · {candidate.plantCode}
                                    </option>
                                  ))}
                              </select>
                              <div>MANUAL_REQUIRED · divalidasi saat preview</div>
                            </div>
                          ) : (
                            <>
                              {receiver.reference?.preferredReferenceCc ?? '-'}<br />
                              {receiver.reference?.reviewStatus ?? '-'}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t p-4">
              <button
                onClick={doPreview}
                disabled={busy || changes.length === 0 || missingManualReference}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-40"
              >
                Preview Changes
              </button>
              {missingManualReference && (
                <p className="mt-2 text-sm text-amber-700">
                  Pilih Reference CC untuk perubahan OFF ke ON yang berstatus MANUAL_REQUIRED.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {preview && (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-bold">Review sebelum generation</h2>
          {preview.changes?.map((change) => (
            <div key={change.receiverCc} className="mt-3 rounded-xl border p-4">
              <b>{change.plantCode} · {change.plantName} - {change.processLabel}</b>
              <p>{change.receiverCc}: {change.baselineStatus} → {change.targetStatus} ({change.action})</p>
              <p className="text-sm">
                Reference: {change.referenceCc ?? '-'} · {change.referenceSource ?? '-'} · {change.referenceReviewStatus ?? '-'} · Fixed {change.fixedAffectedRows} / Variable {change.variableAffectedRows}
              </p>
            </div>
          ))}
          {preview.issues?.map((issue, index) => (
            <p
              key={index}
              className={`mt-2 text-sm ${issue.severity === 'ERROR' ? 'text-red-600' : 'text-amber-700'}`}
            >
              {issue.severity}: {issue.message}
            </p>
          ))}
          <button
            onClick={generate}
            disabled={busy || preview.generationBlocked || preview.totalChangedCcCount === 0}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-40"
          >
            Generate SAP Upload Files
          </button>
        </section>
      )}

      {files.length > 0 && (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-bold">Download hasil</h2>
          {files.map((file) => (
            <a
              className="mt-3 mr-3 inline-block rounded-lg border px-4 py-2"
              key={file.id}
              href={file.downloadUrl}
            >
              {file.fileName} ({file.rowCount} rows)
            </a>
          ))}
        </section>
      )}
    </div>
  );
}
