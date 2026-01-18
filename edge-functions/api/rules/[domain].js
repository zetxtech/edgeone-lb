// DELETE /api/rules/[domain] - Delete a rule

export async function onRequestDelete({ params, env }) {
  try {
    const domain = decodeURIComponent(params.domain || '');
    
    if (!domain) {
      return new Response(JSON.stringify({ error: 'Missing domain' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    delete rules[domain];
    await env.lb_kv.put('rules', JSON.stringify(rules));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete rule' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
