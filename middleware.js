// EdgeOne Pages Middleware
// Determines whether request goes to admin panel (Nuxt) or load balancer

// Admin panel hostnames - requests to these hosts go to Nuxt
// All other hostnames are treated as proxied domains and go to load balancer
const ADMIN_HOSTNAMES = [
  'elb.zetx.tech'
];

export async function middleware(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Check if this is the admin panel
  const isAdmin = ADMIN_HOSTNAMES.includes(hostname) ||
                  hostname.endsWith('.edgeone.run') || 
                  hostname.endsWith('.edgeone.site');

  if (isAdmin) {
    // Admin panel request -> pass through to Nuxt
    return next();
  }

  // Proxied domain request -> handle load balancing directly in middleware
  try {
    // Get rules from KV
    let rules = {};
    try {
      if (typeof lb_kv === 'undefined') {
        return new Response(JSON.stringify({ 
          error: 'KV namespace not bound',
          message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      rules = await lb_kv.get('rules', { type: 'json' }) || {};
    } catch (error) {
      console.error('Failed to read KV:', error);
      return new Response(JSON.stringify({ 
        error: 'KV storage error',
        message: error.message
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if we have rules for this hostname
    const rule = rules[hostname];
    if (!rule) {
      return new Response(JSON.stringify({ 
        error: `Domain ${hostname} not configured`,
        hostname: hostname,
        availableDomains: Object.keys(rules)
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get available targets
    const targets = rule.targets || [];
    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: 'No backend targets configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Select target using simple round-robin based on timestamp
    const targetIndex = Date.now() % targets.length;
    const target = targets[targetIndex];

    // Build backend URL
    const protocol = target.type === 'https' ? 'https' : 'http';
    const port = target.port ? `:${target.port}` : '';
    const backendUrl = `${protocol}://${target.host}${port}${url.pathname}${url.search}`;

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
    console.error('Load balancer error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      message: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Match all routes
export const config = {
  matcher: '/:path*'
};
