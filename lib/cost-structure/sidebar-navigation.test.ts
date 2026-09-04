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
  '/cost-structure/raw-v2',
  '/cost-structure/raw-v2/upload',
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

test('Raw V2 routes select only their exact nested entry and expand the Raw V2 group', () => {
  assert.equal(navigationPathMatches('/cost-structure', '/cost-structure/raw-v2'), false);
  assert.equal(navigationPathMatches('/cost-structure/raw-v2', '/cost-structure/raw-v2/upload'), false);
  assert.equal(navigationPathMatches('/cost-structure/raw-v2/upload', '/cost-structure/raw-v2/upload'), true);
  assert.deepEqual(openNavigationIds(costStructureNavigation, '/cost-structure/raw-v2'), ['cost-raw-v2']);
  assert.deepEqual(openNavigationIds(costStructureNavigation, '/cost-structure/raw-v2/upload'), ['cost-raw-v2']);
});

test('Materiality Rules is hidden from non-admin navigation and visible to admins', () => {
  assert.deepEqual(visibleNavigationItems(costStructureAdminNavigation, false), []);
  assert.deepEqual(routes(visibleNavigationItems(costStructureAdminNavigation, true)), ['/cost-fluctuation/materiality-rules']);
});
