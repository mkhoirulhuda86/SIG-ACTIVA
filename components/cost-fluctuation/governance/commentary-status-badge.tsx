export function CommentaryStatusBadge({ status = 'OPEN' }: { status?: string }) {
  const saved = ['DRAFT', 'SUBMITTED', 'RETURNED', 'REVIEWED'].includes(status);
  const label = saved ? 'SAVED' : status;
  const style = saved ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}
