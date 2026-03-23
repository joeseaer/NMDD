function firstNonEmpty(...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function getLlmApiKey() {
  return firstNonEmpty(
    process.env.ARK_API_KEY,
    process.env.VOLCENGINE_ARK_API_KEY,
    process.env.OPENAI_API_KEY
  );
}

function getLlmBaseUrl() {
  return firstNonEmpty(
    process.env.ARK_BASE_URL,
    process.env.VOLCENGINE_ARK_BASE_URL,
    process.env.OPENAI_BASE_URL,
    'https://ark.cn-beijing.volces.com/api/v3'
  );
}

function getLlmModel() {
  return firstNonEmpty(
    process.env.ARK_MODEL,
    process.env.VOLCENGINE_ARK_MODEL,
    process.env.OPENAI_MODEL,
    'doubao-seed-2-0-pro-260215'
  );
}

function getOpenAIClientOptions() {
  const apiKey = getLlmApiKey();
  const baseURL = getLlmBaseUrl();
  return { apiKey, baseURL };
}

module.exports = {
  getLlmApiKey,
  getLlmBaseUrl,
  getLlmModel,
  getOpenAIClientOptions,
};
