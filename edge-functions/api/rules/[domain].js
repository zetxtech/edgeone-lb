// DELETE /api/rules/[domain] - Delete a rule

export async function onRequestDelete({ params }) {
  try {
    if (typeof lb_kv === 'undefined') {
      return new Response(JSON.stringify({ 
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const domain = decodeURIComponent(params.domain || '');
    
    if (!domain) {
      return new Response(JSON.stringify({ 
        error: 'Missing domain',
        params: params
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rules = await lb_kv.get('rules', { type: 'json' }) || {};
    delete rules[domain];
    await lb_kv.put('rules', JSON.stringify(rules));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to delete rule',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
