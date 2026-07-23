import type { MindMapDocumentV1 } from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import { CommandValidationError } from './errors';
import type {
  CommandValidationContext,
  ReplaceImportedDocumentCommand,
} from './types';

const invalid = (message: string): never => {
  throw new CommandValidationError(message);
};

/** Validates both the machine schema and every cross-record domain invariant. */
export const validateReplaceImportedDocument = (
  context: CommandValidationContext,
  command: ReplaceImportedDocumentCommand,
): void => {
  const candidate = command.payload.candidate as unknown;
  if (candidate === context.document) {
    invalid('Imported document must not be the current document reference.');
  }

  const validation = validateMindMapDocument(candidate);
  if (validation.valid) return;

  const issuePreview = validation.issues
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  const remainder = validation.issues.length > 3
    ? `; and ${validation.issues.length - 3} more`
    : '';
  invalid(`Imported document is invalid: ${issuePreview || 'unknown validation error'}${remainder}`);
};

/**
 * Replaces the canonical root in one Immer transaction.
 *
 * One structured clone is intentional: Immer auto-freezes newly inserted
 * values, so inserting the caller-owned candidate directly would mutate that
 * external object graph. The command/planner never performs additional clones.
 */
export const applyReplaceImportedDocument = (
  _document: unknown,
  command: ReplaceImportedDocumentCommand,
): MindMapDocumentV1 => structuredClone(command.payload.candidate);
