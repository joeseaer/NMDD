const { createClient } = require('@supabase/supabase-js');
const { WardrobeError } = require('./wardrobeBundle');
const { DEFAULT_USER_ID } = require('../config/currentUser');
const { unpackSmartDocumentContent } = require('./dbService');

const SUMMARY = 'id,title,research_type,content_revision,content_schema_version,updated_at';
const DETAIL = `${SUMMARY},content,content_json`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => { throw new WardrobeError(message, status); };

function createResearchDocumentService(client, { owner, siteUrl = '' } = {}) {
  function db() {
    if (!client || !owner) fail('科研文档连接未配置', 503);
    return client;
  }
  function check(result) {
    if (result.error) fail('科研文档服务暂时不可用，请确认数据库迁移已完成', 503);
    return result.data;
  }
  function allowed(fields) {
    return db().from('sops').select(fields).eq('user_id', owner)
      .eq('domain', 'research').eq('chatgpt_access', true);
  }
  function present(row) {
    return {
      ...row,
      details_url: `${siteUrl.replace(/\/$/, '')}/research?type=${encodeURIComponent(row.research_type || 'document')}&doc=${row.id}`,
    };
  }
  return {
    async list({ page = 1, page_size = 30 } = {}) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
          !Number.isSafeInteger(page_size) || page_size < 1 || page_size > 100) fail('分页参数无效');
      const rows = check(await allowed(SUMMARY).order('updated_at', { ascending: false })
        .order('id').range((page - 1) * page_size, page * page_size - 1));
      return { items: (rows || []).map(present), page, page_size };
    },
    async get(id) {
      if (!uuid.test(id)) fail('文档编号无效');
      const row = check(await allowed(DETAIL).eq('id', id).maybeSingle());
      if (!row) fail('文档不存在或未开放给 ChatGPT', 404);
      // Legacy databases stored editor JSON in a Markdown envelope. Decode it
      // just as the website does, without rewriting the original stored body.
      const unpacked = unpackSmartDocumentContent(row.content);
      return present({ ...row, content: unpacked.content, content_json: row.content_json || unpacked.contentJson });
    },
    async update({ id, expected_revision, patch }) {
      if (!uuid.test(id) || !Number.isSafeInteger(expected_revision) || expected_revision < 1) fail('文档编号或版本无效');
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
          Object.keys(patch).some(key => !['title', 'content', 'content_json'].includes(key))) fail('只能修改标题和正文');
      if ('title' in patch && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 500)) fail('标题无效');
      if ('content' in patch || 'content_json' in patch) {
        if (typeof patch.content !== 'string' || patch.content.length > 1000000 ||
            !patch.content_json || patch.content_json.type !== 'doc' || !Array.isArray(patch.content_json.content)) {
          fail('修改正文时须同时提交 Markdown content 和完整的 content_json 文档，保留未修改的节点');
        }
      }
      const result = check(await db().rpc('nmdd_research_document_update', {
        p_owner: owner, p_id: id, p_expected_revision: expected_revision, p_patch: patch,
      }));
      if (result?.error === 'not_found') fail('文档不存在或未开放给 ChatGPT', 404);
      if (result?.error === 'revision_conflict') fail('文档已在其他地方修改，请重新读取最新版本后再编辑', 409);
      if (!result?.id) fail('文档保存未完成', 503);
      return present(result);
    },
    // Only website session routes call this. No MCP tool can grant access.
    async setAccess(id, enabled) {
      if (!uuid.test(id) || typeof enabled !== 'boolean') fail('文档编号或授权开关无效');
      const row = check(await db().from('sops').update({ chatgpt_access: enabled })
        .eq('id', id).eq('user_id', owner).eq('domain', 'research')
        .select('id,chatgpt_access').maybeSingle());
      if (!row) fail('科研文档不存在', 404);
      return row;
    },
  };
}

let client;
function researchDocumentsForOwner(owner, siteUrl) {
  if (!client && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return createResearchDocumentService(client, { owner, siteUrl });
}
module.exports = {
  createResearchDocumentService,
  researchDocumentsForOwner,
  websiteResearchDocuments: () => researchDocumentsForOwner(DEFAULT_USER_ID, process.env.NMDD_SITE_URL),
};
