export type WorkflowStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'REVIEWED';
export type WorkflowAction = 'SAVE' | 'SUBMIT' | 'RETURN' | 'REVIEW';
export const WORKFLOW_AUDIT: Record<WorkflowAction, string> = {
  SAVE: 'SAVE_COMMENTARY',
  SUBMIT: 'SUBMIT_COMMENTARY',
  RETURN: 'RETURN_COMMENTARY',
  REVIEW: 'REVIEW_COMMENTARY',
};

export function nextStatus(
  current: WorkflowStatus | null,
  action: WorkflowAction,
  reason: string,
  reviewerNote: string,
  preparerId: number | null,
  actorId: number,
): WorkflowStatus {
  if (action === 'SAVE') {
    if (!reason.trim()) throw new Error('Save requires a nonblank commentary.');
    // DRAFT is retained as the persisted legacy enum value, but SAVE is now the
    // authoritative completion action. It can replace any old maker/checker state.
    return 'DRAFT';
  }
  if (action === 'SUBMIT') {
    if (current !== 'DRAFT' || !reason.trim()) throw new Error('Submit requires a nonblank DRAFT reason.');
    return 'SUBMITTED';
  }
  if (action === 'RETURN') {
    if (current !== 'SUBMITTED' || !reviewerNote.trim()) throw new Error('Return requires a reviewer note.');
    if (preparerId === actorId) throw new Error('Maker/checker violation.');
    return 'RETURNED';
  }
  if (current !== 'SUBMITTED') throw new Error('Only SUBMITTED commentary can be reviewed.');
  if (preparerId === actorId) throw new Error('Maker/checker violation.');
  return 'REVIEWED';
}
