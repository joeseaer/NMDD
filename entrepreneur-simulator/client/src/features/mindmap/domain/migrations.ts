import {
  migrateLegacyV0ToCanonical,
  type LegacyMigrationOptions,
  type LegacyMigrationResult,
} from './legacy';

export const LEGACY_V0_TO_SCHEMA_V1 = 'legacy-0.x->schema-1' as const;

export interface MindMapMigrationDefinition<TOptions, TResult> {
  readonly id: string;
  readonly from: string;
  readonly toSchemaVersion: number;
  migrate(input: unknown, options?: TOptions): TResult;
}

export const MIND_MAP_MIGRATIONS = Object.freeze({
  [LEGACY_V0_TO_SCHEMA_V1]: Object.freeze({
    id: LEGACY_V0_TO_SCHEMA_V1,
    from: 'legacy-v0',
    toSchemaVersion: 1,
    migrate: migrateLegacyV0ToCanonical,
  } satisfies MindMapMigrationDefinition<LegacyMigrationOptions, LegacyMigrationResult>),
});

export type MindMapMigrationId = keyof typeof MIND_MAP_MIGRATIONS;

export const getMindMapMigration = <Id extends MindMapMigrationId>(id: Id) =>
  MIND_MAP_MIGRATIONS[id];

