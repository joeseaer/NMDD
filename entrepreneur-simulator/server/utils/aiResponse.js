class AIJsonParseError extends Error {
  constructor(message, options = {}) {
    super(message || 'Model output is not valid JSON');
    this.name = 'AIJsonParseError';
    this.stage = options.stage || 'json_parse';
    this.rawExcerpt = options.rawExcerpt;
  }
}

function cleanJsonText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findJsonCandidate(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  const end = text.lastIndexOf(closeChar);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

function extractJsonValue(text) {
  const cleaned = cleanJsonText(text);
  if (!cleaned) return null;

  const direct = tryParseJson(cleaned);
  if (direct !== null) return direct;

  const objectCandidate = findJsonCandidate(cleaned, '{', '}');
  if (objectCandidate) {
    const parsed = tryParseJson(objectCandidate);
    if (parsed !== null) return parsed;
  }

  const arrayCandidate = findJsonCandidate(cleaned, '[', ']');
  if (arrayCandidate) {
    const parsed = tryParseJson(arrayCandidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractJsonObject(text) {
  const parsed = extractJsonValue(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function parseJsonObject(text, message = 'Model output is not valid JSON') {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    throw new AIJsonParseError(message, {
      rawExcerpt: typeof text === 'string' ? text.slice(0, 300) : '',
    });
  }
  return parsed;
}

function getErrorDetail(err, fallback = 'Unknown error') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.message) return String(err.message);
  return fallback;
}

function sendApiError(reply, request, options = {}) {
  const statusCode = options.statusCode || 500;
  const body = {
    error: options.error || 'Request failed',
    detail: options.detail || getErrorDetail(options.err),
  };

  const stage = options.stage || options.err?.stage;
  if (stage) body.stage = stage;
  if (request?.id) body.requestId = String(request.id);

  return reply.code(statusCode).send(body);
}

module.exports = {
  AIJsonParseError,
  cleanJsonText,
  extractJsonValue,
  extractJsonObject,
  parseJsonObject,
  sendApiError,
};
