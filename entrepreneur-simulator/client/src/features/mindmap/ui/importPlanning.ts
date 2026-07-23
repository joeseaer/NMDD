import { createEntityId } from '../domain/ids';
import type {
  CommandId,
  ISODateTime,
  MindMapDocumentV1,
  SheetId,
} from '../domain/types';
import {
  MIND_MAP_COMMAND_TYPES,
  type ReplaceImportedDocumentCommand,
} from '../commands/types';

export interface ImportPlanningDependencies {
  readonly createCommandId: () => CommandId;
  readonly now: () => ISODateTime;
}

const DEFAULT_DEPENDENCIES: ImportPlanningDependencies = {
  createCommandId: () => createEntityId<'Command'>(),
  now: () => new Date().toISOString(),
};

export interface PlanReplaceImportedDocumentInput {
  /** Current canonical state; it owns baseRevision and the envelope anchor. */
  readonly document: MindMapDocumentV1;
  /** Complete document returned by an import parser. Kept by reference. */
  readonly candidate: MindMapDocumentV1;
  /** Defaults deterministically to the first current sheet by orderKey/ID. */
  readonly sheetId?: SheetId;
  readonly origin?: string;
}

const resolveAnchorSheetId = (
  document: MindMapDocumentV1,
  requested: SheetId | undefined,
): SheetId => {
  if (requested !== undefined) {
    if (!document.sheets[requested]) {
      throw new Error(`Import anchor sheet ${requested} does not exist in the current document.`);
    }
    return requested;
  }

  const first = Object.values(document.sheets).sort((left, right) =>
    left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id))[0];
  if (!first) throw new Error('The current document has no sheet to anchor an import command.');
  return first.id;
};

/** Plans one non-mergeable, undoable replacement without cloning a large candidate. */
export const planReplaceImportedDocumentCommand = (
  input: PlanReplaceImportedDocumentInput,
  dependencies: ImportPlanningDependencies = DEFAULT_DEPENDENCIES,
): ReplaceImportedDocumentCommand => ({
  commandId: dependencies.createCommandId(),
  type: MIND_MAP_COMMAND_TYPES.replaceImportedDocument,
  sheetId: resolveAnchorSheetId(input.document, input.sheetId),
  payload: { candidate: input.candidate },
  baseRevision: input.document.contentRevision,
  origin: input.origin ?? 'mindmap-v2-import',
  timestamp: dependencies.now(),
});
