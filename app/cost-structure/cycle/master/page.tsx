import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Factory, GitBranch, ShieldAlert } from 'lucide-react';
import CostModuleFrame from '@/app/components/CostModuleFrame';

const summary = [
  { label: 'Production CC Master', value: '59', icon: Factory },
  { label: 'Receiver CC pada Cycle Agt 2026', value: '45', icon: GitBranch },
  { label: 'Validated Reference', value: '1', icon: CheckCircle2 },
  { label: 'Manual Required', value: '1', icon: ShieldAlert },
];

export default function CycleMasterPage() {
  return (
    <CostModuleFrame
      title="Master CC & Reference"
      subtitle="Cost Structure & Fluktuasi Biaya · Update Cycle SAP"
      contentClassName="p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <section data-cost-motion className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Master Receiver CC dan reference</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Master menyimpan Plant Code, equipment/process, urutan tampilan, serta preferred/fallback reference untuk proses OFF → ON. Mapping berstatus PROPOSED tetap harus terlihat sebagai mapping yang belum divalidasi bisnis dan tidak boleh diam-diam dinaikkan menjadi VALIDATED.
              </p>
            </div>
            <Link
              href="/cost-structure/cycle"
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <ArrowLeft size={16} /> Kembali ke Proses Cycle
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(({ label, value, icon: Icon }) => (
            <article key={label} data-cost-motion data-cost-hover className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</p>
                </div>
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={21} />
                </div>
              </div>
            </article>
          ))}
        </section>

        <section data-cost-motion className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-foreground">Contoh reference tervalidasi</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target Receiver CC</p>
                <p className="mt-1 font-semibold text-foreground">7203311054 · Finish Mill 2 Tuban II</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preferred Reference</p>
                <p className="mt-1 font-semibold text-foreground">7203311053 · Finish Mill 1 Tuban II</p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Mapping ini sudah dibuktikan terhadap output SAP aktual: 220/220 segment Fixed dan 214/214 segment Variable mengikuti pattern reference per Cycle + Segment Name.
              </p>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-foreground">Governance reference</h2>
            <div className="mt-4 space-y-3">
              <div className="flex gap-3 rounded-xl border border-border p-4">
                <CheckCircle2 className="mt-0.5 shrink-0 text-primary" size={18} />
                <div>
                  <p className="text-sm font-semibold text-foreground">VALIDATED</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Reference yang sudah dibuktikan/di-review dapat digunakan sesuai rule engine.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-xl border border-border p-4">
                <GitBranch className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
                <div>
                  <p className="text-sm font-semibold text-foreground">PROPOSED</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Kandidat mapping tetap ditandai untuk review dan harus menghasilkan warning saat digunakan.</p>
                </div>
              </div>
              <div className="flex gap-3 rounded-xl border border-border p-4">
                <ShieldAlert className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
                <div>
                  <p className="text-sm font-semibold text-foreground">MANUAL_REQUIRED</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">OFF → ON diblokir sampai Admin menetapkan reference yang valid.</p>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section data-cost-motion className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Editor master akan diaktifkan setelah persistence/API master tersedia.</p>
          <p className="mt-1 text-sm text-muted-foreground">Foundation menggunakan seed yang terdokumentasi di docs/cost-structure-cycle untuk menjaga satu sumber kontrak selama parallel development.</p>
        </section>
      </div>
    </CostModuleFrame>
  );
}
