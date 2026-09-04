import { FileWarning } from 'lucide-react';
import CostModuleFrame from '@/app/components/CostModuleFrame';
import { RAW_V2_CAPABILITIES } from '@/lib/cost-structure/raw-v2/constants';

export default function RawV2UploadPlaceholderPage() {
  return (
    <CostModuleFrame title="Upload Raw SAP – Raw V2" contentClassName="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <FileWarning className="mt-0.5 h-6 w-6 text-amber-700" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Stage B placeholder</p>
              <h1 className="mt-1 text-xl font-bold text-slate-900">Actual upload is disabled until Stage C</h1>
              <p className="mt-2 text-sm text-slate-700">No file is posted, stored, parsed, or registered from this page.</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Locked raw-input contract</h2>
          <p className="mt-2 text-sm text-slate-600">
            TB authority uses FS Item/Account, current and previous YTD, and Variance. CC authority is limited to SAP columns B:K; helper columns are excluded.
          </p>
          <h3 className="mt-5 font-semibold text-slate-900">Company 2000 source expectations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>TB, CC ADUM, and CC PASAR are required.</li>
            <li>CC PROD and CC Derivative are optional; absence is explicitly treated as zero.</li>
            <li>A present but malformed optional source remains an error.</li>
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            Company 7000 will share the TB/CC contract and later receive its separately verified additional source adapters.
          </p>
          <button
            type="button"
            disabled={!RAW_V2_CAPABILITIES.uploadEnabled}
            className="mt-6 cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            Upload unavailable in Stage B
          </button>
        </section>
      </div>
    </CostModuleFrame>
  );
}
