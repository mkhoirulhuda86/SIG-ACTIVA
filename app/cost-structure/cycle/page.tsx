import Link from 'next/link';
import {
  ArrowRight,
  FileCheck2,
  FileSpreadsheet,
  History,
  ListChecks,
  Settings2,
  ToggleRight,
  UploadCloud,
} from 'lucide-react';
import CostModuleFrame from '@/app/components/CostModuleFrame';

const workflow = [
  {
    icon: UploadCloud,
    title: '1. Upload Cycle',
    description: 'Upload satu workbook cycle SAP terbaru yang berisi Fixed Cost dan Variable Cost.',
  },
  {
    icon: ToggleRight,
    title: '2. Panel CC ON/OFF',
    description: 'Satu toggle untuk setiap Receiver Cost Center, dikelompokkan berdasarkan Plant Code dan urutan proses.',
  },
  {
    icon: ListChecks,
    title: '3. Preview & Validasi',
    description: 'Sistem menghitung seluruh segment yang terdampak, reference yang digunakan, serta blocking error dan warning.',
  },
  {
    icon: FileSpreadsheet,
    title: '4. Generate SAP Upload',
    description: 'Hasil akhir berupa delta Fix Cost dan Var Cost dengan format lima kolom yang siap digunakan untuk upload SAP.',
  },
];

export default function CycleProcessPage() {
  return (
    <CostModuleFrame
      title="Update Cycle SAP"
      subtitle="Cost Structure & Fluktuasi Biaya · SAP Cycle Allocation"
      contentClassName="p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <section
          data-cost-motion
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">7FT1GF · Fixed Cost</span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">7VT1GF · Variable Cost</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Workspace update cycle bulanan</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Panel ini disiapkan untuk workflow upload cycle, perubahan status Receiver CC, validasi perubahan, dan pembuatan file delta SAP. Business rule sudah dikunci; integrasi parser dan engine server sedang dipisahkan agar dapat diuji secara independen.
                </p>
              </div>
            </div>
            <FileCheck2 className="hidden size-20 text-primary/20 lg:block" aria-hidden="true" />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflow.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              data-cost-motion
              data-cost-hover
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon size={20} />
              </div>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </article>
          ))}
        </section>

        <section data-cost-motion className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-semibold text-foreground">Rule panel yang dikunci</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontrol user</p>
                <p className="mt-2 text-sm font-semibold text-foreground">1 Receiver CC = 1 toggle</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Segment tidak menjadi toggle dan hanya tampil sebagai audit detail.</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ON → OFF</p>
                <p className="mt-2 text-sm font-semibold text-foreground">Semua segment menjadi 0</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Tidak ada redistribusi atau normalisasi ke Receiver CC lain.</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">OFF → ON</p>
                <p className="mt-2 text-sm font-semibold text-foreground">Copy pattern Reference CC</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Matching dilakukan per Cycle + Segment Name dengan target CC tetap dipertahankan.</p>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">Akses cepat</h2>
            <div className="mt-4 space-y-2">
              <Link
                href="/cost-structure/cycle/history"
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-2"><History size={17} /> Riwayat Cycle</span>
                <ArrowRight size={16} className="text-muted-foreground" />
              </Link>
              <Link
                href="/cost-structure/cycle/master"
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-2"><Settings2 size={17} /> Master CC & Reference</span>
                <ArrowRight size={16} className="text-muted-foreground" />
              </Link>
            </div>
          </article>
        </section>

        <section data-cost-motion className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Area upload dan toggle belum diaktifkan pada foundation branch.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Komponen operasional akan dihubungkan setelah parser, allocation engine, validation, dan exporter melewati unit test masing-masing.
          </p>
        </section>
      </div>
    </CostModuleFrame>
  );
}
