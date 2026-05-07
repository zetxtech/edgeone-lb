const DEBUG_LOG_INDEX_KEY = 'debug-log:index';
const DEBUG_LOG_KEY_PREFIX = 'debug-log:';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function parseLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}
export async function onRequestGet({ request }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return jsonResponse({
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings',
      }, 500);
    }
    const url = new URL(request.url);
    const id = (url.searchParams.get('id') || '').trim();
    if (id) {
      const record = await lb_kv.get(`${DEBUG_LOG_KEY_PREFIX}${id}`, { type: 'json' });
      if (!record) {
        return jsonResponse({
          error: 'Debug log not found',
          id,
        }, 404);
      }
      return jsonResponse(record);
    }
    const limit = parseLimit(url.searchParams.get('limit'));
    const index = await lb_kv.get(DEBUG_LOG_INDEX_KEY, { type: 'json' }) || [];
    return jsonResponse({
      items: index.slice(0, limit),
      total: index.length,
      limit,
    });
  } catch (error) {
    return jsonResponse({
      error: 'Failed to get debug logs',
      message: error.message,
      stack: error.stack,
    }, 500);
  }
}
