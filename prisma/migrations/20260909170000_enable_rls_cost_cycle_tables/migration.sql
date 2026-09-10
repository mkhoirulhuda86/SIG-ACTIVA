-- Defense-in-depth for Update Cycle SAP tables exposed in the public schema.
-- The application accesses these tables through the server-side Prisma connection;
-- no browser/client RLS policies are intentionally granted here.
ALTER TABLE public.cost_cycle_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_validation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_cc_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_change_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_cycle_generated_files ENABLE ROW LEVEL SECURITY;
