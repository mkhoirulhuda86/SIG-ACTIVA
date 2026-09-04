export type CostNavigationItem = {
  id: string;
  label: string;
  href?: string;
  requireAdmin?: boolean;
  children?: CostNavigationItem[];
};

export const costStructureNavigation: CostNavigationItem[] = [
  { id: 'cost-dashboard', label: 'Dashboard', href: '/cost-structure' },
  { id: 'cost-upload', label: 'Upload & Proses', href: '/cost-structure/upload' },
  { id: 'cost-monthly', label: 'Cost Structure Bulanan', href: '/cost-structure/monthly' },
  {
    id: 'cost-raw-v2',
    label: 'Engine 1 V2 – Raw SAP',
    children: [
      { id: 'cost-raw-v2-dashboard', label: 'Dashboard Raw V2', href: '/cost-structure/raw-v2' },
      { id: 'cost-raw-v2-upload', label: 'Upload Raw SAP', href: '/cost-structure/raw-v2/upload' },
    ],
  },
  { id: 'cost-fluctuation', label: 'Analisis Fluktuasi', href: '/cost-fluctuation' },
  {
    id: 'cost-analysis-review',
    label: 'Analisis & Review',
    children: [
      { id: 'cost-commentary', label: 'Commentary', href: '/cost-fluctuation/commentary' },
      { id: 'cost-review', label: 'Review Analitis', href: '/cost-fluctuation/review' },
      { id: 'cost-readiness', label: 'Historical Readiness', href: '/cost-fluctuation/readiness' },
    ],
  },
];

export const costStructureAdminNavigation: CostNavigationItem[] = [
  {
    id: 'cost-settings',
    label: 'Pengaturan Cost Structure',
    requireAdmin: true,
    children: [
      {
        id: 'cost-materiality-rules',
        label: 'Materiality Rules',
        href: '/cost-fluctuation/materiality-rules',
        requireAdmin: true,
      },
    ],
  },
];

const exactOnlyRoutes = new Set(['/cost-structure', '/cost-fluctuation', '/cost-structure/raw-v2']);

export function navigationPathMatches(href: string | undefined, pathname: string): boolean {
  if (!href) return false;
  if (href === pathname) return true;
  return !exactOnlyRoutes.has(href) && pathname.startsWith(`${href}/`);
}

export function navigationContainsPath(item: CostNavigationItem, pathname: string): boolean {
  return navigationPathMatches(item.href, pathname) || item.children?.some((child) => navigationContainsPath(child, pathname)) === true;
}

export function openNavigationIds(items: CostNavigationItem[], pathname: string): string[] {
  const openIds: string[] = [];
  const visit = (item: CostNavigationItem): boolean => {
    const childContainsPath = item.children?.some(visit) === true;
    if (childContainsPath) openIds.push(item.id);
    return navigationPathMatches(item.href, pathname) || childContainsPath;
  };
  items.forEach(visit);
  return openIds;
}

export function visibleNavigationItems(items: CostNavigationItem[], admin: boolean): CostNavigationItem[] {
  return items
    .filter((item) => !item.requireAdmin || admin)
    .map((item) => ({
      ...item,
      children: item.children ? visibleNavigationItems(item.children, admin) : undefined,
    }));
}
