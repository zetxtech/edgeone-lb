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

    // Force HTTPS redirect if configured
    if (rule.forceHttps && url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 302);
    }

    // Health check endpoint - return backend status (similar to worker.js)
    if (url.pathname === '/_health') {
      const statusReport = {};
      
      // Format similar to worker.js for consistency
      rule.targets.forEach(t => {
        statusReport[t.host] = {
          type: t.type,
          status: 'configured',
          latency: 'N/A',
          last_update: 'EdgeOne uses simple round-robin (no active health checks)',
          reason: 'OK'
        };
      });

      // Add metadata
      statusReport['_metadata'] = {
        domain: hostname,
        platform: rule.platform || 'edgeone',
        healthPath: rule.healthPath || '/',
        forceHttps: rule.forceHttps || false,
        loadBalancingStrategy: 'round-robin',
        note: 'EdgeOne version uses simple round-robin without active health monitoring'
      };

      return new Response(JSON.stringify(statusReport, null, 2), {
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Trigger health check endpoint - actively probe all backends
    if (url.pathname === '/_trigger_health_check') {
      const healthPath = rule.healthPath || '/';
      
      // Actively probe all backends
      const checkPromises = rule.targets.map(async (target) => {
        const start = Date.now();
        try {
          const checkUrl = new URL(`https://${target.host}${healthPath}`);
          if (target.host.includes(":")) {
            const parts = target.host.split(":");
            checkUrl.hostname = parts[0];
            checkUrl.port = parts[1];
          }

          const checkReq = new Request(checkUrl, {
            method: "GET",
            headers: { "User-Agent": "EdgeOne-LB-Health-Monitor" },
            signal: AbortSignal.timeout(5000)
          });

          const resp = await fetch(checkReq);
          const duration = Date.now() - start;

          return {
            host: target.host,
            type: target.type,
            status: resp.ok ? 'healthy' : 'unhealthy',
            statusCode: resp.status,
            latency: `${duration}ms`,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          };
        } catch (e) {
          const duration = Date.now() - start;
          return {
            host: target.host,
            type: target.type,
            status: 'unhealthy',
            statusCode: null,
            latency: duration >= 5000 ? 'TimeOut' : `${duration}ms`,
            error: e.message,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          };
        }
      });

      const results = await Promise.allSettled(checkPromises);
      const healthReport = {
        domain: hostname,
        platform: rule.platform || 'edgeone',
        healthPath: healthPath,
        checkTime: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        totalTargets: rule.targets.length,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Unknown error' })
      };

      return new Response(JSON.stringify(healthReport, null, 2), {
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
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
    responseHeaders.set('X-LB-Platform', rule.platform || 'edgeone');

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
