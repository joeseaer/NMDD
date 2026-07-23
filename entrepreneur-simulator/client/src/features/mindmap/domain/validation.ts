import { validateMindMapInvariants } from './invariants';
import {
  type MindMapSchemaError,
  validateMindMapSchema,
} from './schema';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  /** RFC 6901 JSON Pointer. The document root is represented by `/`. */
  readonly path: string;
  readonly severity: ValidationSeverity;
}

export interface ValidationResult {
  readonly invariantValid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly schemaValid: boolean;
  readonly valid: boolean;
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function appendPointer(pointer: string, segment: string): string {
  const base = pointer === '/' ? '' : pointer;
  return `${base}/${escapePointerSegment(segment)}`;
}

function schemaErrorPath(error: MindMapSchemaError): string {
  let path = error.instancePath || '/';

  if (error.keyword === 'required') {
    const missingProperty = error.params.missingProperty;
    if (typeof missingProperty === 'string') {
      path = appendPointer(path, missingProperty);
    }
  } else if (error.keyword === 'additionalProperties') {
    const additionalProperty = error.params.additionalProperty;
    if (typeof additionalProperty === 'string') {
      path = appendPointer(path, additionalProperty);
    }
  } else if (error.keyword === 'propertyNames') {
    const propertyName = error.params.propertyName;
    if (typeof propertyName === 'string') {
      path = appendPointer(path, propertyName);
    }
  }

  return path || '/';
}

function toSchemaIssue(error: MindMapSchemaError): ValidationIssue {
  return {
    code: `schema.${error.keyword}`,
    message: error.message,
    path: schemaErrorPath(error),
    severity: 'error',
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message) ||
    compareText(left.severity, right.severity)
  );
}

function uniqueSortedIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const sorted = [...issues].sort(compareIssues);
  return sorted.filter((issue, index) => {
    if (index === 0) {
      return true;
    }
    const previous = sorted[index - 1];
    return !(
      previous.code === issue.code &&
      previous.path === issue.path &&
      previous.message === issue.message &&
      previous.severity === issue.severity
    );
  });
}

export function validateMindMapSchemaIssues(value: unknown): ValidationIssue[] {
  return uniqueSortedIssues(validateMindMapSchema(value).errors.map(toSchemaIssue));
}

/**
 * Executes the two-stage validation contract. Invariants only run after the
 * machine schema passes, preventing malformed input from producing misleading
 * graph/reference errors.
 */
export function validateMindMapDocument(value: unknown): ValidationResult {
  const schemaIssues = validateMindMapSchemaIssues(value);
  if (schemaIssues.length > 0) {
    return {
      invariantValid: false,
      issues: schemaIssues,
      schemaValid: false,
      valid: false,
    };
  }

  const invariantIssues = uniqueSortedIssues(validateMindMapInvariants(value));
  const invariantValid = !invariantIssues.some((issue) => issue.severity === 'error');
  return {
    invariantValid,
    issues: invariantIssues,
    schemaValid: true,
    valid: invariantValid,
  };
}
