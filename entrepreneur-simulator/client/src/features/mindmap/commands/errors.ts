import type { ValidationIssue } from '../domain/validation';

export type MindMapCommandErrorCode =
  | 'COMMAND_INVALID'
  | 'COMMAND_POSTCONDITION'
  | 'COMMAND_READ_ONLY'
  | 'COMMAND_REVISION_CONFLICT'
  | 'COMMAND_UNKNOWN'
  | 'HISTORY_REVISION_CONFLICT';

export class MindMapCommandError extends Error {
  readonly code: MindMapCommandErrorCode;

  constructor(code: MindMapCommandErrorCode, message: string) {
    super(message);
    this.name = 'MindMapCommandError';
    this.code = code;
  }
}

export class CommandValidationError extends MindMapCommandError {
  constructor(message: string) {
    super('COMMAND_INVALID', message);
    this.name = 'CommandValidationError';
  }
}

export class ReadOnlyCommandError extends MindMapCommandError {
  constructor() {
    super('COMMAND_READ_ONLY', 'A read-only mind-map engine cannot dispatch content commands.');
    this.name = 'ReadOnlyCommandError';
  }
}

export class CommandPostconditionError extends MindMapCommandError {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      'COMMAND_POSTCONDITION',
      'Mind-map command violated a schema or domain postcondition.',
    );
    this.name = 'CommandPostconditionError';
    this.issues = issues;
  }
}

export class CommandRevisionError extends MindMapCommandError {
  readonly actualRevision: number;
  readonly baseRevision: number;

  constructor(baseRevision: number, actualRevision: number) {
    super(
      'COMMAND_REVISION_CONFLICT',
      `Command base revision ${baseRevision} does not match content revision ${actualRevision}.`,
    );
    this.name = 'CommandRevisionError';
    this.baseRevision = baseRevision;
    this.actualRevision = actualRevision;
  }
}

export class UnknownMindMapCommandError extends MindMapCommandError {
  readonly commandType: string;

  constructor(commandType: string) {
    super('COMMAND_UNKNOWN', `Unknown mind-map command type: ${commandType}`);
    this.name = 'UnknownMindMapCommandError';
    this.commandType = commandType;
  }
}

export class HistoryRevisionError extends MindMapCommandError {
  readonly actualRevision: number;
  readonly expectedRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      'HISTORY_REVISION_CONFLICT',
      `History expected content revision ${expectedRevision}, received ${actualRevision}.`,
    );
    this.name = 'HistoryRevisionError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
