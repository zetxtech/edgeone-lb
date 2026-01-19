/**
 * Export API - Generate standalone Middleware code with embedded rules
 * GET /api/export
 */

export async function onRequest({ request }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

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

    const rulesData = await lb_kv.get('rules', { type: 'json' }) || {}

    const code = `/**
 * EdgeOne Load Balancer - Standalone Middleware
 * Generated at: ${new Date().toISOString()}
 * 
 * Deploy this file as middleware.js to EdgeOne Pages for load balancing without admin panel.
 */

const RULES = ${JSON.stringify(rulesData, null, 2)};

export async function middleware(context) {
  const { request } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;
  
  const rule = RULES[hostname];
  if (!rule || !rule.targets || rule.targets.length === 0) {
    return new Response(JSON.stringify({ 
      error: 'No backend configured for this domain',
      hostname: hostname
    }), { 
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Force HTTPS redirect
  if (rule.forceHttps && url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  // Simple round-robin selection based on timestamp
  const targetIndex = Date.now() % rule.targets.length;
  const target = rule.targets[targetIndex];
  
  // Build backend URL
  const protocol = target.type === 'https' ? 'https' : 'http';
  const port = target.port ? \\\`:$\{target.port}\\\` : '';
  const backendUrl = \\\`$\{protocol}://$\{target.host}$\{port}$\{url.pathname}$\{url.search}\\\`;

  // Build proxy headers
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('X-Forwarded-Host', hostname);
  proxyHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  proxyHeaders.set('X-Real-IP', request.headers.get('cf-connecting-ip') || 
                                request.headers.get('x-forwarded-for')?.split(',')[0] || 
                                'unknown');

  // Create proxy request
  const proxyRequest = new Request(backendUrl, {
    method: request.method,
    headers: proxyHeaders,
    body: request.body,
    redirect: 'manual'
  });

  try {
    // Fetch from backend
    const response = await fetch(proxyRequest, {
      eo: {
        timeoutSetting: {
          connectTimeout: 10000,
          readTimeout: 30000,
          writeTimeout: 30000
        }
      }
    });

    // Build response with custom headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-LB-Backend', target.host);
    responseHeaders.set('X-LB-Powered-By', 'EdgeOne-LB');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Backend unavailable',
      message: error.message
    }), { 
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = {
  matcher: '/:path*'
};
`

    return new Response(code, {
      headers: {
        'Content-Type': 'application/javascript',
        'Content-Disposition': 'attachment; filename="middleware.js"'
      }
    })
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'Failed to export',
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
