// POST /api/rules/[domain]/targets - Add a target to a rule

export async function onRequestPost({ request, params, env }) {
  try {
    const domain = decodeURIComponent(params.domain || '');
    const body = await request.json();
    
    if (!domain || !body.host || !body.type) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    
    if (!rules[domain]) {
      return new Response(JSON.stringify({ error: 'Domain not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    rules[domain].targets.push({
      host: body.host,
      port: body.port,
      type: body.type
    });
    
    await env.lb_kv.put('rules', JSON.stringify(rules));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to add target' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
