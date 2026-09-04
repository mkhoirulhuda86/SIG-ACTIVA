import Link from 'next/link';
import CostModuleFrame from '@/app/components/CostModuleFrame';
import { getRawV2CapabilityStatus } from '@/lib/cost-structure/raw-v2/status';

const statusLabel = (enabled: boolean) => enabled ? 'Aktif' : 'Belum diaktifkan';

export default function RawV2DashboardPage() {
  const status = getRawV2CapabilityStatus();

  return (
    <CostModuleFrame
      title="Engine 1 V2 – Raw SAP"
      subtitle="Jalur paralel Cost Structure berbasis raw SAP"
      contentClassName="p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <section data-cost-motion className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tahap B</p>
              <h1 className="text-2xl font-bold tracking-tight">Skeleton Raw SAP terisolasi</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Menu ini disiapkan sebagai jalur pengembangan paralel. Engine, upload, kalkulasi, dan export Cost Structure existing tidak diubah dan tetap menjadi baseline pembanding.
              </p>
            </div>
            <span className="inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold">{status.phase}</span>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ['Upload Raw SAP', status.uploadEnabled],
            ['Kalkulasi Raw V2', status.calculationEnabled],
            ['Export Cost Structure', status.exportEnabled],
          ].map(([label, enabled]) => (
            <div key={String(label)} data-cost-motion data-cost-hover className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold">{String(label)}</p>
              <p className="mt-2 text-sm text-muted-foreground">{statusLabel(Boolean(enabled))}</p>
            </div>
          ))}
        </section>

        <section data-cost-motion className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Ruleset lineage terpisah</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Company 2000</p>
              <p className="mt-1 font-mono text-sm font-semibold">{status.ruleSets['2000']}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs text-muted-foreground">Company 7000</p>
              <p className="mt-1 font-mono text-sm font-semibold">{status.ruleSets['7000']}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Identifier ini sengaja berbeda dari ruleset Engine 1 existing agar calculation lineage tidak dapat tercampur.
          </p>
        </section>

        <section data-cost-motion className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Guardrail Tahap B</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Tidak ada endpoint write untuk upload atau kalkulasi Raw V2.</li>
            <li>Tidak memakai active calculation run dari Cost Structure existing.</li>
            <li>Kontrak input wajib mengikuti dokumen Stage A di repository.</li>
            <li>Upload baru akan diaktifkan pada Tahap C setelah parser dan reconciliation test tersedia.</li>
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/cost-structure/raw-v2/upload" className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-accent">
              Lihat Upload Raw SAP
            </Link>
            <Link href="/cost-structure" className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-accent">
              Kembali ke Engine Existing
            </Link>
          </div>
        </section>
      </div>
    </CostModuleFrame>
  );
}
