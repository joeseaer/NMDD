const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/20261109_add_wardrobe.sql'), 'utf8');

// Executes production SQL in an embedded PostgreSQL engine; only PostgREST transport
// and binary Storage are substituted. No production credentials or network calls.
async function createWardrobeDatabase() {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
  await pg.exec(migration);
  const objects = new Map(); const state = { objects, uploads: 0, failUploadAt: 0, failRpc: false };
  class Query {
    constructor(table) { if (!['wardrobe_items','wardrobe_outfits','wardrobe_outfit_items'].includes(table)) throw new Error('Unexpected table'); this.table = table; this.filters = []; this.values = []; this.operation = 'select'; this.orders = []; }
    select(fields = '*') { this.fields = fields; return this; }
    eq(key,value) { this.values.push(value); this.filters.push(`"${key}"=$${this.values.length}`); return this; }
    is(key,value) { if (value !== null) throw new Error('Expected null'); this.filters.push(`"${key}" IS NULL`); return this; }
    in(key,values) { this.values.push(values); this.filters.push(`"${key}"=ANY($${this.values.length})`); return this; }
    order(key,options = {}) { this.orders.push(`"${key}" ${options.ascending === false ? 'DESC' : 'ASC'}`); return this; }
    range(start,end) { this.start = start; this.take = end-start+1; return this; }
    limit(limit) { this.take = limit; return this; }
    insert(input) { this.operation = 'insert'; this.input = input; return this; }
    delete() { this.operation = 'delete'; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    async run() {
      try {
        let sql, values = [...this.values];
        const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
        if (this.operation === 'insert') {
          const keys = Object.keys(this.input); values = keys.map(k => this.input[k]);
          sql = `INSERT INTO ${this.table}(${keys.map(k => `"${k}"`).join(',')}) VALUES(${keys.map((_,i) => `$${i+1}`).join(',')}) RETURNING *`;
        } else if (this.operation === 'delete') sql = `DELETE FROM ${this.table}${where} RETURNING *`;
        else sql = `SELECT * FROM ${this.table}${where}${this.orders.length ? ' ORDER BY '+this.orders.join(',') : ''}${this.take != null ? ` LIMIT ${this.take}` : ''}${this.start ? ` OFFSET ${this.start}` : ''}`;
        const { rows } = await pg.query(sql,values);
        if (this.fields?.includes('wardrobe_outfit_items')) for (const row of rows) row.wardrobe_outfit_items = (await pg.query('SELECT item_id,position FROM wardrobe_outfit_items WHERE outfit_id=$1',[row.id])).rows;
        return { data: this.one ? rows[0] || null : rows, error: null };
      } catch (error) { return { data: null, error }; }
    }
    then(resolve,reject) { return this.run().then(resolve,reject); }
  }
  const client = {
    from: name => new Query(name),
    async rpc(name, args) {
      if (state.failRpc) return { error: { code: 'XX000', message: 'simulated failure with SECRET' } };
      try {
        const casts = { wardrobe_import: ['text','jsonb','text'], wardrobe_patch_item: ['text','uuid','jsonb'], wardrobe_save_outfit: ['text','uuid','text','text','text','uuid[]'] };
        const cast = casts[name]; if (!cast) throw new Error('unexpected RPC');
        const values = Object.values(args).map((v,i) => cast[i] === 'jsonb' ? JSON.stringify(v) : v);
        const result = await pg.query(`SELECT ${name}(${cast.map((type,i) => `$${i+1}::${type}`).join(',')}) AS result`,values);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
    storage: { from(name) {
      if (name !== 'wardrobe-images') throw new Error('Unexpected bucket');
      return {
        async upload(key,bytes) { state.uploads++; if (state.uploads === state.failUploadAt) return { error: { message: 'simulated upload failure' } }; if (objects.has(key)) return { error: new Error('duplicate') }; objects.set(key,Buffer.from(bytes)); return { data: { path: key },error: null }; },
        async download(key) { return objects.has(key) ? { data: new Blob([objects.get(key)]),error: null } : { error: new Error('missing') }; },
        async remove(keys) { keys.forEach(key => objects.delete(key)); return { error: null }; },
      };
    } },
  };
  return { pg, client, state, migration };
}
module.exports = { createWardrobeDatabase };
