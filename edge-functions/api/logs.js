
export async function onRequestGet() {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound (lb_kv is undefined)' }), { status: 500 });
    }
    const logs = await lb_kv.get('debug:logs', { type: 'json' }) || [];
    const debugEnabled = await lb_kv.get('config:debug');
    const traceEnabled = await lb_kv.get('config:trace');
    
    return new Response(JSON.stringify({
      enabled: debugEnabled === 'true',
      traceEnabled: traceEnabled === 'true',
      kv_status: 'bound',
      debug_value: debugEnabled,
      logs: logs
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
  }
}

export async function onRequestPost({ request }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500 });
    }

    const body = await request.json();
    
    if (typeof body.enabled !== 'undefined') {
      await lb_kv.put('config:debug', body.enabled ? 'true' : 'false');
    }

    if (typeof body.traceEnabled !== 'undefined') {
      await lb_kv.put('config:trace', body.traceEnabled ? 'true' : 'false');
    }
    
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
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
