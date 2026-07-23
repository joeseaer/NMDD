'use strict';

const clone = (value) => (
  value === undefined ? undefined : JSON.parse(JSON.stringify(value))
);

/**
 * In-memory PostgREST/Supabase double used by document persistence tests.
 * It deliberately implements the fluent query surface used by dbService so
 * route tests exercise the real persistence implementation and stored rows.
 */
const createFakeSupabase = ({
  rows = [],
  supportsReliability = true,
  failVersionInsert = false,
  updateErrorOnce = null,
} = {}) => {
  const state = {
    rows: new Map(rows.map((row) => [row.id, clone(row)])),
    calls: [],
    supportsReliability,
    failVersionInsert,
    updateErrorOnce: updateErrorOnce ? clone(updateErrorOnce) : null,
    updateErrorConsumed: false,
    nextId: 1,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = 'select';
      this.payload = null;
      this.filters = [];
      this.selection = '*';
    }

    update(payload) {
      this.operation = 'update';
      this.payload = clone(payload);
      return this;
    }

    insert(payload) {
      this.operation = 'insert';
      this.payload = clone(Array.isArray(payload) ? payload[0] : payload);
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    select(selection = '*') {
      this.selection = selection;
      return this;
    }

    eq(field, value) {
      this.filters.push([field, value]);
      return this;
    }

    order() {
      return this;
    }

    single() {
      return Promise.resolve(this.execute(true));
    }

    maybeSingle() {
      return Promise.resolve(this.execute(true));
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute(false)).then(resolve, reject);
    }

    referencesReliabilityFields() {
      const selection = String(this.selection || '');
      return (
        Object.keys(this.payload || {}).some((key) => (
          key === 'content_revision' || key === 'content_schema_version'
        ))
        || this.filters.some(([field]) => (
          field === 'content_revision' || field === 'content_schema_version'
        ))
        || selection.includes('content_revision')
        || selection.includes('content_schema_version')
      );
    }

    matches(row) {
      return this.filters.every(([field, value]) => row?.[field] === value);
    }

    project(row) {
      if (!row) return null;
      if (
        String(this.selection).includes('sop_versions')
        || String(this.selection).trim() === '*'
      ) {
        return clone(row);
      }
      const fields = String(this.selection)
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean);
      return fields.reduce((result, field) => {
        result[field] = row[field];
        return result;
      }, {});
    }

    execute(single) {
      state.calls.push({
        table: this.table,
        operation: this.operation,
        payload: clone(this.payload),
        filters: clone(this.filters),
        selection: this.selection,
      });

      if (!state.supportsReliability && this.referencesReliabilityFields()) {
        return {
          data: null,
          error: {
            code: 'PGRST204',
            message: "Could not find the 'content_schema_version' column of 'sops' in the schema cache",
          },
        };
      }

      if (
        this.table === 'sops'
        && this.operation === 'update'
        && state.updateErrorOnce
        && !state.updateErrorConsumed
      ) {
        state.updateErrorConsumed = true;
        return { data: null, error: clone(state.updateErrorOnce) };
      }

      if (
        this.table === 'sop_versions'
        && this.operation === 'insert'
        && state.failVersionInsert
      ) {
        return { data: null, error: { message: 'simulated version history failure' } };
      }

      if (this.table !== 'sops') return { data: null, error: null };

      if (this.operation === 'insert') {
        const now = new Date().toISOString();
        const row = {
          id: this.payload.id || `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`,
          created_at: now,
          updated_at: now,
          sop_versions: [],
          sop_usage_logs: [],
          scene_sop_rel: [],
          people_sop_rel: [],
          ...clone(this.payload),
        };
        state.rows.set(row.id, row);
        return { data: this.project(row), error: null };
      }

      const matchingRows = Array.from(state.rows.values()).filter((row) => this.matches(row));
      if (this.operation === 'update') {
        const row = matchingRows[0];
        if (!row) return { data: null, error: null };
        const previousRevision = row.content_revision;
        Object.assign(row, clone(this.payload));
        if (state.supportsReliability) row.content_revision = previousRevision + 1;
        return { data: this.project(row), error: null };
      }

      const projected = matchingRows.map((row) => this.project(row));
      return { data: single ? (projected[0] || null) : projected, error: null };
    }
  }

  return {
    state,
    client: {
      from(table) {
        return new Query(table);
      },
    },
  };
};

module.exports = { createFakeSupabase };

