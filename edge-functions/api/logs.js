
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

function getDebugSettings(env) {
  const rawLevel = readEnvValue(env, 'LB_LOG_LEVEL');
  if (typeof rawLevel === 'string') {
    const normalizedLevel = rawLevel.trim().toLowerCase();
    if (normalizedLevel === 'trace') {
      return { enabled: true, traceEnabled: true, level: 'trace' };
    }
    if (normalizedLevel === 'debug') {
      return { enabled: true, traceEnabled: false, level: 'debug' };
    }
    if (['off', 'false', '0'].includes(normalizedLevel)) {
      return { enabled: false, traceEnabled: false, level: 'off' };
    }
  }

  const traceEnabled = parseBooleanLike(readEnvValue(env, 'LB_TRACE'));
  const debugEnabled = traceEnabled || parseBooleanLike(readEnvValue(env, 'LB_DEBUG'));

  return {
    enabled: debugEnabled,
    traceEnabled,
    level: traceEnabled ? 'trace' : debugEnabled ? 'debug' : 'off',
  };
}

export async function onRequestGet({ env }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound (lb_kv is undefined)' }), { status: 500 });
    }
    const logs = await lb_kv.get('debug:logs', { type: 'json' }) || [];
    const debugSettings = getDebugSettings(env);
    
    return new Response(JSON.stringify({
      enabled: debugSettings.enabled,
      traceEnabled: debugSettings.traceEnabled,
      level: debugSettings.level,
      configSource: 'env',
      kv_status: 'bound',
      logs: logs
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500 });
    }

    const body = await request.json();
    const debugSettings = getDebugSettings(env);
    const attemptedConfigChange = typeof body.enabled !== 'undefined' || typeof body.traceEnabled !== 'undefined';
    
    if (body.clear) {
      await lb_kv.put('debug:logs', '[]');
    }

    if (body.test) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        source: 'api:test',
        message: 'Test log entry',
        data: 'If you see this, KV writing is working.'
      };
      
      let logs = [];
      try {
        const existing = await lb_kv.get('debug:logs', { type: 'json' });
        if (Array.isArray(existing)) logs = existing;
      } catch {}
      
      logs.unshift(logEntry);
      await lb_kv.put('debug:logs', JSON.stringify(logs));
    }

    return new Response(JSON.stringify({
      success: true,
      configSource: 'env',
      enabled: debugSettings.enabled,
      traceEnabled: debugSettings.traceEnabled,
      level: debugSettings.level,
      message: attemptedConfigChange ? 'Debug level is controlled by environment variables and cannot be changed via API.' : undefined,
    }), {
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
