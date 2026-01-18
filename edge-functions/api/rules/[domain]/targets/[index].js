// DELETE /api/rules/[domain]/targets/[index] - Delete a target from a rule

export async function onRequestDelete({ params, env }) {
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

    const domain = decodeURIComponent(params.domain || '');
    const index = parseInt(params.index || '-1');
    
    if (!domain || index < 0) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields',
        received: { domain, index, params }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rules = await env.lb_kv.get('rules', { type: 'json' }) || {};
    
    if (!rules[domain]) {
      return new Response(JSON.stringify({ 
        error: 'Domain not found',
        domain: domain,
        availableDomains: Object.keys(rules)
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (index >= rules[domain].targets.length) {
      return new Response(JSON.stringify({ 
        error: 'Target not found',
        index: index,
        totalTargets: rules[domain].targets.length
      }), {
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
    return new Response(JSON.stringify({ 
      error: 'Failed to delete target',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
