// GET /api/rules - Get all rules
// POST /api/rules - Create/update a rule

export async function onRequestGet({ env }) {
  try {
    if (!env.lb_kv) {
      return new Response(JSON.stringify({ 
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    return new Response(JSON.stringify(rules), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to get rules',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.lb_kv) {
      return new Response(JSON.stringify({ 
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    
    if (!body.domain || !body.rule) {
      return new Response(JSON.stringify({ 
        error: 'Missing domain or rule',
        received: { domain: body.domain, rule: body.rule }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    rules[body.domain] = body.rule;
    await env.lb_kv.put('rules', JSON.stringify(rules));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to save rule',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
