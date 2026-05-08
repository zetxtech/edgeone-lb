/**
 * Export API - Generate a rules snapshot for backup or migration
 * GET /api/export
 */

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export async function onRequest({ request }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    if (typeof lb_kv === 'undefined') {
      return jsonResponse({
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings',
      }, 500);
    }

    const rules = await lb_kv.get('rules', { type: 'json' }) || {};

    return jsonResponse({
      format: 'edgeone-lb-rules',
      version: 1,
      generatedAt: new Date().toISOString(),
      domainCount: Object.keys(rules).length,
      rules,
    }, 200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="edgeone-lb-rules.json"',
    });
  } catch (error) {
    return jsonResponse({
      error: 'Failed to export rules',
      message: error.message,
    }, 500);
  }
}
