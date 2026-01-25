
export async function onRequestPost({ request }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500 });
    }

    const body = await request.json();
    const { message, data, source } = body;
    
    const debugEnabled = await lb_kv.get('config:debug');
    if (debugEnabled !== 'true') {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      source: source || 'unknown',
      message,
      data: data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null
    };

    const DEBUG_LOG_KEY = 'debug:logs';
    const MAX_LOG_ENTRIES = 1000;

    // Optimistic concurrency control is hard here, just read-modify-write
    // In high traffic this might lose logs, but for debugging it's fine
    let logs = [];
    try {
      const existing = await lb_kv.get(DEBUG_LOG_KEY, { type: 'json' });
      if (Array.isArray(existing)) {
        logs = existing;
      }
    } catch {}

    logs.unshift(logEntry);
    if (logs.length > MAX_LOG_ENTRIES) {
      logs = logs.slice(0, MAX_LOG_ENTRIES);
    }

    await lb_kv.put(DEBUG_LOG_KEY, JSON.stringify(logs));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
