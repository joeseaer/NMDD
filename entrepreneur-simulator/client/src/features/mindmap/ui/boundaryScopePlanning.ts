import { createEntityId } from '../domain/ids';
import { planBoundaryScopeNormalizations } from '../domain/semanticScope';
import type { BoundaryId, MindMapSheet } from '../domain/types';
import type { BoundaryScopeChange } from '../commands/types';

export interface MaterializeBoundaryScopeChangesInput {
  readonly before: MindMapSheet;
  readonly after: MindMapSheet;
  /** Optional deterministic queue used by import/replay tests. */
  readonly splitBoundaryIds?: readonly BoundaryId[];
}

/**
 * Adds planner-owned identities to pure scope normalization. The source ID is
 * always retained by the first deterministic group.
 */
export const materializeBoundaryScopeChanges = (
  input: MaterializeBoundaryScopeChangesInput,
): BoundaryScopeChange[] => {
  const supplied = [...(input.splitBoundaryIds ?? [])];
  let cursor = 0;
  const occupied = new Set<string>(Object.keys(input.before.boundaries));
  const result = planBoundaryScopeNormalizations(input.before, input.after).map((plan) => ({
    boundaryId: plan.boundaryId,
    replacements: plan.scopes.map((scope, index) => {
      let boundaryId = plan.boundaryId;
      if (index > 0) {
        const suppliedId = supplied[cursor];
        if (suppliedId !== undefined) cursor += 1;
        boundaryId = suppliedId ?? createEntityId<'Boundary'>();
      }
      if (index > 0 && occupied.has(boundaryId)) {
        throw new Error(`Boundary split ID ${boundaryId} is already in use.`);
      }
      occupied.add(boundaryId);
      return { boundaryId, scope };
    }),
  }));
  if (cursor !== supplied.length) {
    throw new Error(
      `Boundary split supplied ${supplied.length} IDs but only ${cursor} were required.`,
    );
  }
  return result;
};
