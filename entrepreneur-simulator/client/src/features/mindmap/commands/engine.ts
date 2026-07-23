import { enablePatches, produceWithPatches } from 'immer';

import type { MindMapDocumentV1 } from '../domain/types';
import { validateMindMapDocument } from '../domain/validation';
import {
  CommandPostconditionError,
  CommandRevisionError,
  CommandValidationError,
  ReadOnlyCommandError,
} from './errors';
import {
  CORE_MIND_MAP_COMMAND_REGISTRY,
  type MindMapCommandRegistry,
} from './registry';
import type {
  AppliedMindMapCommand,
  MindMapCommand,
  MindMapCommandExecution,
} from './types';

enablePatches();

export interface ExecuteMindMapCommandOptions {
  readOnly?: boolean;
  registry?: MindMapCommandRegistry;
}

const serializedByteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export interface PatchByteRecord {
  command: unknown;
  forwardPatches: readonly unknown[];
  inversePatches: readonly unknown[];
}

export const measureAppliedCommandBytes = (
  applied: PatchByteRecord,
): number => serializedByteLength({
  command: applied.command,
  forwardPatches: applied.forwardPatches,
  inversePatches: applied.inversePatches,
});

const assertEnvelope = (command: MindMapCommand): void => {
  const candidate = command as unknown as Record<string, unknown>;
  if (!candidate || typeof candidate !== 'object') {
    throw new CommandValidationError('Mind-map command must be an object.');
  }
  if (typeof candidate.commandId !== 'string' || candidate.commandId.length === 0) {
    throw new CommandValidationError('Mind-map command requires commandId.');
  }
  if (typeof candidate.type !== 'string' || candidate.type.length === 0) {
    throw new CommandValidationError('Mind-map command requires type.');
  }
  if (typeof candidate.sheetId !== 'string' || candidate.sheetId.length === 0) {
    throw new CommandValidationError('Mind-map command requires sheetId.');
  }
  if (!Number.isSafeInteger(candidate.baseRevision) || Number(candidate.baseRevision) < 0) {
    throw new CommandValidationError('Mind-map command requires a non-negative baseRevision.');
  }
  if (candidate.groupId !== undefined && typeof candidate.groupId !== 'string') {
    throw new CommandValidationError('Mind-map command groupId must be a string.');
  }
  if (typeof candidate.origin !== 'string' || candidate.origin.length === 0) {
    throw new CommandValidationError('Mind-map command requires origin.');
  }
  if (typeof candidate.timestamp !== 'string' || candidate.timestamp.length === 0) {
    throw new CommandValidationError('Mind-map command requires timestamp.');
  }
  if (typeof candidate.payload !== 'object' || candidate.payload === null) {
    throw new CommandValidationError('Mind-map command requires an object payload.');
  }
};

export const executeMindMapCommand = <TCommand extends MindMapCommand>(
  document: MindMapDocumentV1,
  command: TCommand,
  options: ExecuteMindMapCommandOptions = {},
): MindMapCommandExecution<TCommand> => {
  if (options.readOnly) throw new ReadOnlyCommandError();
  assertEnvelope(command);

  const registry = options.registry ?? CORE_MIND_MAP_COMMAND_REGISTRY;
  const definition = registry.get(command.type);
  if (!document.sheets[command.sheetId]) {
    throw new CommandValidationError(`Sheet ${command.sheetId} does not exist.`);
  }
  if (command.baseRevision !== document.contentRevision) {
    throw new CommandRevisionError(command.baseRevision, document.contentRevision);
  }

  definition.validate(
    { document, sheetId: command.sheetId },
    command,
  );

  const beforeRevision = document.contentRevision;
  const [nextDocument, forwardPatches, immerInversePatches] = produceWithPatches(
    document,
    (draft) => {
      const replacement = definition.apply(draft, command);
      if (replacement !== undefined) {
        replacement.contentRevision = beforeRevision + 1;
        return replacement;
      }
      draft.contentRevision = beforeRevision + 1;
    },
  );
  const inversePatches = definition.invert(command, immerInversePatches);
  const postconditions = validateMindMapDocument(nextDocument);
  if (!postconditions.valid) {
    throw new CommandPostconditionError(postconditions.issues);
  }
  const applied: AppliedMindMapCommand<TCommand> = {
    command,
    beforeRevision,
    afterRevision: nextDocument.contentRevision,
    forwardPatches,
    inversePatches,
    byteSize: 0,
  };
  applied.byteSize = measureAppliedCommandBytes(applied);

  return { document: nextDocument, applied };
};

export type EditableMindMapDispatch = <TCommand extends MindMapCommand>(
  document: MindMapDocumentV1,
  command: TCommand,
) => MindMapCommandExecution<TCommand>;

export type MindMapDispatch<ReadOnly extends boolean> =
  ReadOnly extends true ? never : EditableMindMapDispatch;

export interface MindMapCommandEngineOptions<ReadOnly extends boolean> {
  readOnly: ReadOnly;
  registry?: MindMapCommandRegistry;
}

/**
 * readOnly is reflected in the dispatch property type and checked again at
 * runtime, so JS callers and unsafe casts cannot bypass the policy.
 */
export class MindMapCommandEngine<ReadOnly extends boolean> {
  readonly dispatch: MindMapDispatch<ReadOnly>;
  readonly readOnly: ReadOnly;
  readonly registry: MindMapCommandRegistry;

  constructor(options: MindMapCommandEngineOptions<ReadOnly>) {
    this.readOnly = options.readOnly;
    this.registry = options.registry ?? CORE_MIND_MAP_COMMAND_REGISTRY;
    this.dispatch = ((document: MindMapDocumentV1, command: MindMapCommand) =>
      executeMindMapCommand(document, command, {
        readOnly: this.readOnly,
        registry: this.registry,
      })) as MindMapDispatch<ReadOnly>;
  }
}

export function createMindMapCommandEngine(
  options: MindMapCommandEngineOptions<true>,
): MindMapCommandEngine<true>;
export function createMindMapCommandEngine(
  options?: Partial<MindMapCommandEngineOptions<false>>,
): MindMapCommandEngine<false>;
export function createMindMapCommandEngine(
  options: Partial<MindMapCommandEngineOptions<boolean>> = {},
): MindMapCommandEngine<boolean> {
  return new MindMapCommandEngine({
    readOnly: options.readOnly ?? false,
    registry: options.registry,
  });
}
