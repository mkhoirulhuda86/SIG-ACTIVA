export const COMMENTARY_TARGET_TYPES = ['NATURE', 'COA'] as const;

export type GovernancePermissions = { canPrepare: boolean; canReview: boolean; canAdmin: boolean };

export function governancePermissions(role: string): GovernancePermissions {
  return {
    canPrepare: role === 'ADMIN_SYSTEM' || role === 'STAFF_ACCOUNTING',
    canReview: role === 'ADMIN_SYSTEM' || role === 'SUPERVISOR_ACCOUNTING',
    canAdmin: role === 'ADMIN_SYSTEM',
  };
}

export function isCommentaryTarget(nodeType: string) {
  return (COMMENTARY_TARGET_TYPES as readonly string[]).includes(nodeType);
}

export function commentaryActions(
  _status: string | undefined,
  permissions: GovernancePermissions,
  _preparedById?: number,
  _actorId?: number,
) {
  return {
    canEdit: permissions.canPrepare,
    canSubmit: false,
    canCheck: false,
    immutable: false,
    makerCheckerBlocked: false,
  };
}

export function explainMaterialityRule(amount: string, percent: string, operator: 'AND' | 'OR') {
  const criteria = [amount && `variance amount ≥ ${amount}`, percent && `absolute variance % ≥ ${percent}%`].filter(Boolean);
  if (!criteria.length) return 'Enter at least one threshold. No business threshold is assumed.';
  return `Requires explanation when ${criteria.join(operator === 'AND' ? ' AND ' : ' OR ')}.`;
}
