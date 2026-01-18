// GET /api/rules - Get all rules
// POST /api/rules - Create/update a rule

export async function onRequestGet({ env }) {
  try {
    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    return new Response(JSON.stringify(rules), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to get rules' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    
    if (!body.domain || !body.rule) {
      return new Response(JSON.stringify({ error: 'Missing domain or rule' }), {
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
    return new Response(JSON.stringify({ error: 'Failed to save rule' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
