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

    // Health check endpoint - return backend status (same format as worker.js)
    if (url.pathname === '/_health') {
      const cache = await caches.open('cache:host-metrics');
      const statusReport = {};
      
      await Promise.all(rule.targets.map(async (t) => {
        const key = new Request(`https://${t.host}/_metric`);
        const resp = await cache.match(key);
        
        let info = { status: 'pending', latency: null, lastChecked: null };
        if (resp) {
          try { info = await resp.json(); } catch {}
        }

        statusReport[t.host] = {
          type: t.type,
          status: info.status,
          latency: info.latency === 9999 ? 'TimeOut' : `${info.latency}ms`,
          last_update: info.lastChecked 
            ? new Date(info.lastChecked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) 
            : 'Never',
          reason: info.reason || 'OK'
        };
      }));

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
            latency: duration,
            latencyDisplay: `${duration}ms`,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            timestampMs: Date.now()
          };
        } catch (e) {
          const duration = Date.now() - start;
          return {
            host: target.host,
            type: target.type,
            status: 'unhealthy',
            statusCode: null,
            latency: 9999,
            latencyDisplay: duration >= 5000 ? 'TimeOut' : `${duration}ms`,
            error: e.message,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            timestampMs: Date.now()
          };
        }
      });

      const results = await Promise.allSettled(checkPromises);
      const healthResults = results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Unknown error' });
      
      // Cache health check results using Cache API (TTL: 10 minutes)
      const cache = await caches.open('cache:host-metrics');
      const statusReport = {};
      
      for (const result of healthResults) {
        if (result.host) {
          const cacheKey = new Request(`https://${result.host}/_metric`);
          const metricsData = {
            status: result.status,
            latency: result.latency,
            reason: result.error || (result.statusCode ? `HTTP ${result.statusCode}` : 'OK'),
            lastChecked: result.timestampMs
          };
          
          await cache.put(cacheKey, new Response(JSON.stringify(metricsData), {
            headers: { 
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=600'
            }
          }));
          
          // Build status report in same format as /_health
          statusReport[result.host] = {
            type: result.type,
            status: result.status,
            latency: result.latencyDisplay,
            last_update: result.timestamp,
            reason: metricsData.reason
          };
        }
      }

      return new Response(JSON.stringify(statusReport, null, 2), {
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
