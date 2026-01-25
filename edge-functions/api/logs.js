
export async function onRequestGet() {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ error: 'KV not bound' }), { status: 500 });
    }
    const logs = await lb_kv.get('debug:logs', { type: 'json' }) || [];
    const debugEnabled = await lb_kv.get('config:debug');
    
    return new Response(JSON.stringify({
      enabled: debugEnabled === 'true',
      logs: logs
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
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
    
    if (body.clear) {
      await lb_kv.put('debug:logs', '[]');
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
