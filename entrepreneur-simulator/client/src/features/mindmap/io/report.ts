import type {
  MindMapImportDiagnostic,
  MindMapImportDiagnosticDisposition,
  MindMapImportDiagnosticSeverity,
  MindMapImportReport,
  MindMapOutlineFormat,
} from './types';

export interface AddImportDiagnosticInput {
  readonly code: string;
  readonly count?: number;
  readonly disposition: MindMapImportDiagnosticDisposition;
  readonly message: string;
  readonly path?: string;
  readonly severity: MindMapImportDiagnosticSeverity;
}

export class MindMapImportReportBuilder {
  private readonly diagnostics: MindMapImportDiagnostic[] = [];

  private degradedItems = 0;

  private ignoredItems = 0;

  private importedSheets = 0;

  private importedTopics = 0;

  private preservedAttributes = 0;

  constructor(
    private readonly format: MindMapOutlineFormat,
    private readonly inputBytes: number,
  ) {}

  add(input: AddImportDiagnosticInput): void {
    const count = Math.max(1, Math.floor(input.count ?? 1));
    if (input.disposition === 'degraded') this.degradedItems += count;
    if (input.disposition === 'ignored') this.ignoredItems += count;
    if (input.disposition === 'preserved') this.preservedAttributes += count;
    this.diagnostics.push({
      code: input.code,
      disposition: input.disposition,
      message: input.message,
      ...(input.path === undefined ? {} : { path: input.path }),
      severity: input.severity,
    });
  }

  setImportedCounts(sheets: number, topics: number): void {
    this.importedSheets = sheets;
    this.importedTopics = topics;
  }

  hasErrors(): boolean {
    return this.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  }

  build(success: boolean): MindMapImportReport {
    return {
      degradedItems: this.degradedItems,
      diagnostics: [...this.diagnostics],
      format: this.format,
      ignoredItems: this.ignoredItems,
      importedSheets: this.importedSheets,
      importedTopics: this.importedTopics,
      inputBytes: this.inputBytes,
      preservedAttributes: this.preservedAttributes,
      success,
    };
  }
}
