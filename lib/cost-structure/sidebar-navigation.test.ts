import assert from 'node:assert/strict';
import test from 'node:test';
import {
  costStructureAdminNavigation,
  costStructureNavigation,
  navigationContainsPath,
  navigationPathMatches,
  openNavigationIds,
  visibleNavigationItems,
} from './sidebar-navigation';

const expectedRoutes = [
  '/cost-structure',
  '/cost-structure/upload',
  '/cost-structure/monthly',
  '/cost-fluctuation',
  '/cost-fluctuation/commentary',
  '/cost-fluctuation/review',
  '/cost-fluctuation/readiness',
  '/cost-fluctuation/materiality-rules',
];

function routes(items: typeof costStructureNavigation): string[] {
  return items.flatMap((item) => [item.href, ...(item.children ? routes(item.children) : [])]).filter(Boolean) as string[];
}

test('navigation retains every Cost Structure and fluctuation route', () => {
  assert.deepEqual([...routes(costStructureNavigation), ...routes(costStructureAdminNavigation)].sort(), expectedRoutes.sort());
});

test('analysis pages activate and expand both navigation levels', () => {
  const pathname = '/cost-fluctuation/commentary';
  assert.equal(navigationContainsPath({ id: 'cost', label: 'Cost', children: costStructureNavigation }, pathname), true);
  assert.deepEqual(openNavigationIds(costStructureNavigation, pathname), ['cost-analysis-review']);
});

test('dynamic upload detail keeps Upload & Proses active without activating dashboard root', () => {
  const pathname = '/cost-structure/upload/6';
  assert.equal(navigationPathMatches('/cost-structure/upload', pathname), true);
  assert.equal(navigationPathMatches('/cost-structure', pathname), false);
  assert.equal(navigationContainsPath(costStructureNavigation.find((item) => item.id === 'cost-upload')!, pathname), true);
});

test('Materiality Rules is hidden from non-admin navigation and visible to admins', () => {
  assert.deepEqual(visibleNavigationItems(costStructureAdminNavigation, false), []);
  assert.deepEqual(routes(visibleNavigationItems(costStructureAdminNavigation, true)), ['/cost-fluctuation/materiality-rules']);
});
