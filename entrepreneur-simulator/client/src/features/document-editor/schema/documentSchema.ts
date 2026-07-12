export interface DocumentMarkJson {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocumentNodeJson {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocumentNodeJson[];
  marks?: DocumentMarkJson[];
  text?: string;
  [key: string]: unknown;
}

export type DocumentFragmentJson = DocumentNodeJson | DocumentNodeJson[];

export const isDocumentNodeJson = (value: unknown): value is DocumentNodeJson => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (
    typeof (value as DocumentNodeJson).type === 'string'
    || Array.isArray((value as DocumentNodeJson).content)
  )
);

export const CURRENT_DOCUMENT_SCHEMA_VERSION = 2;

export interface VersionedDocumentJson {
  schemaVersion: number;
  document: DocumentNodeJson;
}
