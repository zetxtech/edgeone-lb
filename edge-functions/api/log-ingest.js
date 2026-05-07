
function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function readEnvValue(env, name) {
  if (env && name in env) {
    return env[name];
  }
  return undefined;
}

function isDebugEnabled(env) {
  const rawLevel = readEnvValue(env, 'LB_LOG_LEVEL');
  if (typeof rawLevel === 'string') {
    const normalizedLevel = rawLevel.trim().toLowerCase();
    if (normalizedLevel === 'debug' || normalizedLevel === 'trace') {
      return true;
    }
    if (['off', 'false', '0'].includes(normalizedLevel)) {
      return false;
    }
  }

  return parseBooleanLike(readEnvValue(env, 'LB_TRACE')) || parseBooleanLike(readEnvValue(env, 'LB_DEBUG'));
}

export async function onRequestPost({ request, env }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500 });
    }

    const body = await request.json();
    const { message, data, source } = body;
    
    if (!isDebugEnabled(env)) {
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
    return new Response(JSON.stringify({ 
      error: e.message,
      name: e.name,
      stack: e.stack 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
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
