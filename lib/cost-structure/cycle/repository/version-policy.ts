export function nextCycleUploadVersion(existingVersions: readonly number[]) {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}

export function replacementStates<T extends { id: number }>(
  active: T | null,
  created: T,
  createdIsValid = true,
) {
  if (!createdIsValid) {
    return { supersededId: null, activeId: active?.id ?? null };
  }
  return { supersededId: active?.id ?? null, activeId: created.id };
}
