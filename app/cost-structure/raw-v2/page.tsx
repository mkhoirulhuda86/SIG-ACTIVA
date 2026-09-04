import { Database, FileUp, FlaskConical, Sheet } from 'lucide-react';
import CostModuleFrame from '@/app/components/CostModuleFrame';
import { getRawV2Status } from '@/lib/cost-structure/raw-v2/status';

const capabilities = [
  { key: 'uploadEnabled', label: 'Upload Raw SAP', icon: FileUp },
  { key: 'calculationEnabled', label: 'Calculation Raw V2', icon: FlaskConical },
  { key: 'exportEnabled', label: 'Export', icon: Sheet },
] as const;

export default function RawV2DashboardPage() {
  const status = getRawV2Status();

  return (
    <CostModuleFrame title="Engine 1 V2 – Raw SAP" contentClassName="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-slate-900">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Status: Stage B / Skeleton</p>
          <h1 className="mt-2 text-2xl font-bold">Parallel Raw SAP engine foundation</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">
            This isolated workspace is not production-ready. The existing Cost Structure engine remains active and unchanged.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {capabilities.map(({ key, label, icon: Icon }) => (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Icon className="h-6 w-6 text-slate-500" aria-hidden="true" />
              <h2 className="mt-3 font-semibold text-slate-900">{label}</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {status[key] ? 'Enabled' : 'Disabled — not yet enabled'}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Database className="h-6 w-6 text-blue-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Independent ruleset lineage</h2>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {Object.entries(status.ruleSets).map(([company, ruleSet]) => (
              <div key={company} className="rounded-xl bg-slate-50 p-4">
                <dt className="text-sm text-slate-500">Company {company}</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900">{ruleSet}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </CostModuleFrame>
  );
}
