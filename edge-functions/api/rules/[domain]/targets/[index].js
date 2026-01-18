// DELETE /api/rules/[domain]/targets/[index] - Delete a target from a rule

export async function onRequestDelete({ params, env }) {
  try {
    const domain = decodeURIComponent(params.domain || '');
    const index = parseInt(params.index || '-1');
    
    if (!domain || index < 0) {
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

    if (index >= rules[domain].targets.length) {
      return new Response(JSON.stringify({ error: 'Target not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    rules[domain].targets.splice(index, 1);
    await env.lb_kv.put('rules', JSON.stringify(rules));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete target' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
