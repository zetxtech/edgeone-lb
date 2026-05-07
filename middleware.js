// EdgeOne Pages Middleware
// Determines whether request goes to admin panel (Nuxt) or load balancer
// Health check and failover logic ported from worker.js

// Admin panel hostnames - requests to these hosts go to Nuxt
// All other hostnames are treated as proxied domains and go to load balancer
const ADMIN_HOSTNAMES = [
  'elb.zetx.tech'
];
let runtimeEnv = null;

// =================================================================
// Debug Logging (writes to KV when environment variables enable it)
// =================================================================
const DEBUG_LOG_KEY = 'debug:logs';
const MAX_LOG_ENTRIES = 1000;

function bindRuntimeEnv(env) {
  if (env) {
    runtimeEnv = env;
  }
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function readRuntimeEnvValue(name) {
  if (runtimeEnv && name in runtimeEnv) {
    return runtimeEnv[name];
  }
  return undefined;
}

function getDebugSettings() {
  const rawLevel = readRuntimeEnvValue('LB_LOG_LEVEL');
  if (typeof rawLevel === 'string') {
    const normalizedLevel = rawLevel.trim().toLowerCase();
    if (normalizedLevel === 'trace') {
      return { enabled: true, traceEnabled: true, level: 'trace' };
    }
    if (normalizedLevel === 'debug') {
      return { enabled: true, traceEnabled: false, level: 'debug' };
    }
    if (['off', 'false', '0'].includes(normalizedLevel)) {
      return { enabled: false, traceEnabled: false, level: 'off' };
    }
  }

  const traceEnabled = parseBooleanLike(readRuntimeEnvValue('LB_TRACE'));
  const debugEnabled = traceEnabled || parseBooleanLike(readRuntimeEnvValue('LB_DEBUG'));

  return {
    enabled: debugEnabled,
    traceEnabled,
    level: traceEnabled ? 'trace' : debugEnabled ? 'debug' : 'off',
  };
}

async function debugLog(message, data = null, level = 'debug') {
  try {
    if (typeof lb_kv === 'undefined') return;

    const { enabled, traceEnabled } = getDebugSettings();
    
    if (!enabled) {
      return;
    }
    if (level === 'trace' && !traceEnabled) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      message: level === 'trace' ? `[TRACE] ${message}` : message,
      data: data ? JSON.stringify(data) : null
    };
    
    // Get existing logs
    let logs = [];
    try {
      const existing = await lb_kv.get(DEBUG_LOG_KEY, { type: 'json' });
      if (Array.isArray(existing)) {
        logs = existing;
      }
    } catch {}
    
    // Add new entry and trim to max size
    logs.unshift(logEntry);
    if (logs.length > MAX_LOG_ENTRIES) {
      logs = logs.slice(0, MAX_LOG_ENTRIES);
    }
    
    // Save back to KV
    await lb_kv.put(DEBUG_LOG_KEY, JSON.stringify(logs));
  } catch (e) {
    // Silently fail - don't break the request
  }
}

// =================================================================
// Utility: Create AbortSignal with timeout (compatibility wrapper)
// =================================================================
function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

// =================================================================
// Response Validator (ported from worker.js)
// Detects proxy error signatures (FRP/Tunnel) vs legitimate responses.
// =================================================================
async function judgeAndMaybeTransformResponse({ resp, target, isWebSocket, originalUrl }) {
  const status = resp.status;
  const statusText = resp.statusText;
  const targetInfo = { host: target.host, type: target.type };

  // WebSocket Validation
  if (isWebSocket) {
    if (status === 101) {
      return { ok: true, response: resp };
    }
    
    if (target.type === "frp" && (status === 404 || status === 525 || status === 530)) {
      return { ok: false, reason: `FRP returned ${status} for WebSocket`, status, statusText, target: targetInfo };
    }
    if (target.type === "tunnel" && (status === 530 || status === 502)) {
      return { ok: false, reason: `Tunnel returned ${status} for WebSocket`, status, statusText, target: targetInfo };
    }
    
    if (status >= 500 || (status >= 400 && status !== 401 && status !== 403)) {
      return { ok: false, reason: `WS Status ${status}`, status, statusText, target: targetInfo };
    }
    
    return { ok: true, response: resp };
  }

  // HTTP Validation
  if (target.type === "tunnel" && (status === 530 || status === 502)) {
    return { ok: false, reason: `Tunnel returned ${status}`, status, statusText, target: targetInfo };
  }

  if (target.type === "frp" && (status === 525 || status === 530)) {
    return { ok: false, reason: "FRP returned 525 (SSL Handshake Failed)", status, statusText, target: targetInfo };
  }

  // FRP Signature Inspection for 404 responses
  if (target.type === "frp" && status === 404) {
    if (!resp.body) {
      return { ok: true, response: handleRedirect(resp, originalUrl) };
    }
    
    const reader = resp.body.getReader();
    const maxBytes = 1024;
    let bytesRead = 0;
    const chunks = [];
    let signatureFound = false;
    let streamEnded = false;
    
    try {
      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) {
          streamEnded = true;
          break;
        }
        chunks.push(value);
        bytesRead += value.byteLength;
        
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const tempBuf = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { tempBuf.set(c, offset); offset += c.length; }
        
        const text = new TextDecoder().decode(tempBuf);
        if (text.includes("Faithfully yours, frp.")) {
          signatureFound = true;
          break;
        }
      }
    } catch (e) {
      try { await reader.cancel(); } catch {}
      return { ok: false, reason: "Stream read error", status, statusText, target: targetInfo, error: e.message };
    }

    if (signatureFound) {
      try { await reader.cancel(); } catch {}
      return { ok: false, reason: "FRP 404 signature matched", status, statusText, target: targetInfo };
    }

    if (chunks.length === 0) {
      try { await reader.cancel(); } catch {}
      return { ok: true, response: handleRedirect(resp, originalUrl) };
    }

    // Replay the response body
    const replay = new ReadableStream({
      async start(controller) {
        try {
          for (const c of chunks) {
            controller.enqueue(c);
          }
          if (!streamEnded) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    const rebuilt = new Response(replay, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
    return { ok: true, response: handleRedirect(rebuilt, originalUrl) };
  }

  return { ok: true, response: handleRedirect(resp, originalUrl) };
}

// Redirect Header Rewriter (ported from worker.js)
function handleRedirect(response, originalUrl) {
  const status = response.status;
  if (status >= 300 && status < 400) {
    const loc = response.headers.get("Location");
    if (loc) {
      let redirectUrl;
      try {
        redirectUrl = new URL(loc);
        redirectUrl.hostname = originalUrl.hostname;
        if (originalUrl.port) {
          redirectUrl.port = originalUrl.port;
        }
        redirectUrl.protocol = originalUrl.protocol;
      } catch {
        redirectUrl = new URL(loc, originalUrl.origin);
      }
      const h = new Headers(response.headers);
      h.set("Location", redirectUrl.toString());
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: h,
      });
    }
  }
  return response;
}

function sanitizeProxyResponseHeaders(headers) {
  const sanitized = new Headers(headers);
  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ];

  for (const header of hopByHopHeaders) {
    sanitized.delete(header);
  }

  sanitized.delete('content-length');
  sanitized.delete('content-encoding');

  return sanitized;
}

function sanitizeUpstreamRequestHeaders(headers) {
  const sanitized = new Headers(headers);
  const hopByHopHeaders = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ];
  const platformHeaders = [
    'cdn-loop',
    'eo-pages-dataset',
    'eo-pages-language',
    'x-nws-log-uuid',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
  ];

  for (const header of hopByHopHeaders) {
    sanitized.delete(header);
  }

  for (const header of platformHeaders) {
    sanitized.delete(header);
  }

  sanitized.delete('content-length');

  return sanitized;
}

function buildUpstreamHostHeader(target, protocol) {
  const [hostname, port] = target.host.split(':');
  if (!port) return hostname;
  if ((protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80')) {
    return hostname;
  }
  return `${hostname}:${port}`;
}

// Update metrics cache and KV storage
async function updateMetrics(cache, host, status, latency, reason = null) {
  const key = new Request(`https://${host}/_metric`);
  const data = {
    status,
    latency,
    reason,
    lastChecked: Date.now()
  };
  
  // Write to Cache API (for same-domain access)
  await cache.put(key, new Response(JSON.stringify(data), {
    headers: { 
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600"
    }
  }));
  
  // Write to KV storage (for cross-domain access)
  try {
    if (typeof lb_kv !== 'undefined') {
      await lb_kv.put(`health:${host}`, JSON.stringify(data), {
        expirationTtl: 600
      });
    }
  } catch (e) {
    console.error('Failed to write health metrics to KV:', e);
  }
}

// Get sorted candidates by health status and latency (ported from worker.js)
async function getSortedCandidates(targets, cache) {
  const statusPromises = targets.map(async (t) => {
    const key = new Request(`https://${t.host}/_metric`);
    const resp = await cache.match(key);
    let data = { status: 'unknown', latency: 9999, lastChecked: 0 };
    
    // Try Cache API first
    if (resp) {
      try { data = await resp.json(); } catch {}
    } else {
      // Fallback to KV storage for cross-domain access
      try {
        if (typeof lb_kv !== 'undefined') {
          const kvData = await lb_kv.get(`health:${t.host}`, { type: 'json' });
          if (kvData) {
            data = kvData;
          }
        }
      } catch (e) {
        console.error('Failed to read health metrics from KV:', e);
      }
    }
    
    return { target: t, ...data };
  });

  const results = await Promise.all(statusPromises);

  return results.sort((a, b) => {
    // Priority: Healthy(0) < Unknown(1) < Unhealthy(2)
    const score = (s) => (s === 'healthy' ? 0 : s === 'unknown' ? 1 : 2);
    if (score(a.status) !== score(b.status)) {
      return score(a.status) - score(b.status);
    }
    // Secondary Priority: Latency (ASC)
    return a.latency - b.latency;
  });
}

// Probe a single target (ported from worker.js)
async function probeTarget(target, request, originalUrl, isWebSocket, signal) {
  try {
    const upstreamUrl = new URL(originalUrl);
    const parts = target.host.split(":");
    upstreamUrl.hostname = parts[0];
    if (parts[1]) upstreamUrl.port = parts[1];

    const upstreamHeaders = sanitizeUpstreamRequestHeaders(request.headers);
    if (!isWebSocket) {
      upstreamHeaders.set('Host', buildUpstreamHostHeader(target, upstreamUrl.protocol));
    }
    
    const realClientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP');
    const realCountry = request.headers.get('CF-IPCountry') || 'XX';
    const cfRay = request.headers.get('CF-Ray');
    
    if (realClientIP) {
      upstreamHeaders.set('LB-Connecting-IP', realClientIP);
      upstreamHeaders.set('X-Real-IP', realClientIP);
      
      const existingXFF = request.headers.get('X-Forwarded-For');
      if (existingXFF) {
        upstreamHeaders.set('X-Forwarded-For', existingXFF);
      } else {
        upstreamHeaders.set('X-Forwarded-For', realClientIP);
      }
    }
    
    upstreamHeaders.set('X-Forwarded-Proto', originalUrl.protocol.replace(':', ''));
    upstreamHeaders.set('LB-IPCountry', realCountry);
    
    if (cfRay) {
      upstreamHeaders.set('LB-Ray', cfRay);
    }

    if (isWebSocket) {
      // For WebSocket, keep all original headers including WebSocket handshake headers
      // The runtime should handle the upgrade automatically
      upstreamHeaders.set('Host', buildUpstreamHostHeader(target, upstreamUrl.protocol));
    }

    const requestBody = isWebSocket || request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : request.body;

    const upstreamReq = new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: requestBody,
      redirect: "manual",
      signal: signal
    });

    let resp;
    try {
      resp = await fetch(upstreamReq);
    } catch (fetchError) {
      return {
        ok: false,
        reason: `Fetch failed: ${fetchError.message}`,
        errorDetail: {
          name: fetchError.name,
          message: fetchError.message,
          stack: fetchError.stack,
          target: target.host,
          upstreamUrl: upstreamUrl.toString(),
          originalUrl: originalUrl.toString(),
          method: request.method
        }
      };
    }

    if (isWebSocket) {
      // Strategy 1: If runtime provides resp.webSocket (Cloudflare Workers style)
      if (resp.webSocket) {
        return { 
          ok: true, 
          response: resp,
          isWebSocket: true 
        };
      }
      
      // Strategy 2: If response is 101 Switching Protocols, return as-is
      if (resp.status === 101) {
        return { ok: true, response: resp, isWebSocket: true };
      }
      
      // Strategy 3: Try using WebSocketPair if available
      if (typeof WebSocketPair !== 'undefined') {
        // Create a new WebSocket connection to upstream using WebSocket constructor
        const upstreamWsUrl = new URL(upstreamUrl);
        upstreamWsUrl.protocol = upstreamWsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        
        try {
          const upstreamSocket = new WebSocket(upstreamWsUrl.toString());
          const pair = new WebSocketPair();
          const [clientSocket, serverSocket] = Object.values(pair);
          
          return new Promise((resolve) => {
            let resolved = false;
            
            upstreamSocket.addEventListener('open', () => {
              if (resolved) return;
              resolved = true;
              
              serverSocket.accept();
              
              // Bidirectional message forwarding
              serverSocket.addEventListener('message', (event) => {
                try { upstreamSocket.send(event.data); } catch {}
              });
              
              upstreamSocket.addEventListener('message', (event) => {
                try { serverSocket.send(event.data); } catch {}
              });
              
              serverSocket.addEventListener('close', (event) => {
                try { upstreamSocket.close(event.code, event.reason); } catch {}
              });
              
              upstreamSocket.addEventListener('close', (event) => {
                try { serverSocket.close(event.code, event.reason); } catch {}
              });
              
              serverSocket.addEventListener('error', () => {
                try { upstreamSocket.close(1011, 'Client error'); } catch {}
              });
              
              upstreamSocket.addEventListener('error', () => {
                try { serverSocket.close(1011, 'Upstream error'); } catch {}
              });
              
              resolve({
                ok: true,
                response: new Response(null, {
                  status: 101,
                  webSocket: clientSocket
                }),
                isWebSocket: true
              });
            });
            
            upstreamSocket.addEventListener('error', (e) => {
              if (resolved) return;
              resolved = true;
              resolve({ ok: false, reason: `WebSocket connection failed: ${e.message || 'unknown error'}` });
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
              if (resolved) return;
              resolved = true;
              try { upstreamSocket.close(); } catch {}
              resolve({ ok: false, reason: 'WebSocket connection timeout' });
            }, 10000);
          });
        } catch (e) {
          return { ok: false, reason: `WebSocket error: ${e.message}` };
        }
      }
      
      // No WebSocket support available
      return { ok: false, reason: `WebSocket not supported by runtime (status ${resp.status})` };
    }

    // HTTP request handling
    const judged = await judgeAndMaybeTransformResponse({
      resp,
      target,
      isWebSocket: false,
      originalUrl,
    });

    if (!judged.ok) {
      return { 
        ok: false, 
        reason: judged.reason,
        status: judged.status,
        statusText: judged.statusText,
        target: judged.target,
        error: judged.error
      };
    }

    const headers = sanitizeProxyResponseHeaders(judged.response.headers);
    headers.set('X-LB-Backend', upstreamUrl.hostname);

    return { 
      ok: true, 
      response: new Response(judged.response.body, {
        status: judged.response.status,
        statusText: judged.response.statusText,
        headers: headers,
      }),
      isWebSocket: false
    };

  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { 
      ok: false, 
      reason: e.message,
      errorDetail: {
        name: e.name,
        message: e.message,
        stack: e.stack,
        target: target.host,
        url: originalUrl.toString()
      }
    };
  }
}

// Background health check (ported from worker.js)
async function runBackgroundHealthCheck(candidatesWithStats, healthPath, cache) {
  const HEALTH_CHECK_TIMEOUT = 5000;
  
  const checks = candidatesWithStats.map(async (item) => {
    const target = item.target;
    const start = Date.now();

    try {
      const checkUrl = new URL(`https://${target.host}${healthPath}`);
      if (target.host.includes(":")) {
        const parts = target.host.split(":");
        checkUrl.hostname = parts[0];
        checkUrl.port = parts[1];
      }

      const req = new Request(checkUrl, {
        method: "GET",
        headers: { "User-Agent": "EdgeOne-LB-Health-Monitor" }
      });

      const duration = Date.now() - start;

      const result = await probeTarget(
        target,
        req,
        checkUrl,
        false,
        createTimeoutSignal(HEALTH_CHECK_TIMEOUT)
      );

      if (result.ok) {
        await updateMetrics(cache, target.host, 'healthy', duration);
      } else {
        await updateMetrics(cache, target.host, 'unhealthy', duration, result.reason);
      }
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? 'Timeout' : e.message;
      await updateMetrics(cache, target.host, 'unhealthy', 9999, reason);
    }
  });

  await Promise.allSettled(checks);
}

export async function middleware(context) {
  const { request, next, rewrite } = context;
  bindRuntimeEnv(context.env);
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Trace log for every request
  await debugLog('Incoming Request', {
    method: request.method,
    url: url.toString(),
    headers: Object.fromEntries(request.headers)
  }, 'trace');

  // Allow internal WebSocket proxy handler to run (avoid recursion in middleware)
  if (url.pathname === '/__ws_proxy') {
    return next();
  }

  // Check if this is the admin panel
  const isAdmin = ADMIN_HOSTNAMES.includes(hostname) ||
                  hostname.endsWith('.edgeone.run') || 
                  hostname.endsWith('.edgeone.site');

  if (isAdmin) {
    // Debug log endpoints
    if (url.pathname === '/_debug/logs') {
      try {
        if (typeof lb_kv === 'undefined') {
          return new Response(JSON.stringify({ error: 'KV not bound' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        const logs = await lb_kv.get(DEBUG_LOG_KEY, { type: 'json' }) || [];
        return new Response(JSON.stringify(logs, null, 2), {
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    if (url.pathname === '/_debug/enable') {
      return new Response(JSON.stringify({
        error: 'Debug level is controlled by environment variables',
        configSource: 'env',
        ...getDebugSettings(),
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/_debug/disable') {
      return new Response(JSON.stringify({
        error: 'Debug level is controlled by environment variables',
        configSource: 'env',
        ...getDebugSettings(),
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/_debug/clear') {
      try {
        if (typeof lb_kv === 'undefined') {
          return new Response(JSON.stringify({ error: 'KV not bound' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        await lb_kv.delete(DEBUG_LOG_KEY);
        return new Response(JSON.stringify({ status: 'Debug logs cleared' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle special endpoints for admin panel
    if (url.pathname === '/_trigger_health_check' || url.pathname === '/_health') {
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

        const rules = await lb_kv.get('rules', { type: 'json' }) || {};
        const allTargets = [];
        const domainTargets = {};

        // Collect all targets from all domains
        for (const [domain, rule] of Object.entries(rules)) {
          if (rule.targets && rule.targets.length > 0) {
            domainTargets[domain] = rule.targets;
            allTargets.push(...rule.targets.map(t => ({ ...t, domain })));
          }
        }

        if (allTargets.length === 0) {
          return new Response(JSON.stringify({ 
            message: 'No targets configured in any domain',
            domains: Object.keys(rules)
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const cache = await caches.open('cache-host-metrics');

        // Handle /_trigger_health_check
        if (url.pathname === '/_trigger_health_check') {
          await debugLog('Manual health check triggered', { source: 'admin-panel' });

          // Run health check for all domains
          for (const [domain, rule] of Object.entries(rules)) {
            if (rule.targets && rule.targets.length > 0) {
              const healthPath = rule.healthPath || '/';
              const candidates = rule.targets.map(t => ({ target: t }));
              await runBackgroundHealthCheck(candidates, healthPath, cache);
            }
          }

          // Return status report grouped by domain
          const statusReport = {};
          for (const [domain, targets] of Object.entries(domainTargets)) {
            statusReport[domain] = {};
            await Promise.all(targets.map(async (t) => {
              const key = new Request(`https://${t.host}/_metric`);
              const resp = await cache.match(key);
              
              let info = { status: 'pending', latency: null, lastChecked: null, reason: null };
              
              // Try Cache API first
              if (resp) {
                try { info = await resp.json(); } catch {}
              } else {
                // Fallback to KV storage for cross-domain access
                try {
                  if (typeof lb_kv !== 'undefined') {
                    const kvData = await lb_kv.get(`health:${t.host}`, { type: 'json' });
                    if (kvData) {
                      info = kvData;
                    }
                  }
                } catch (e) {
                  console.error('Failed to read health metrics from KV:', e);
                }
              }

              statusReport[domain][t.host] = {
                type: t.type,
                status: info.status,
                latency: info.latency === 9999 ? 'TimeOut' : `${info.latency}ms`,
                last_update: info.lastChecked 
                  ? new Date(info.lastChecked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) 
                  : 'Never',
                reason: info.reason || 'OK'
              };
            }));
          }

          await debugLog('Health check completed', { report: statusReport });

          return new Response(JSON.stringify(statusReport, null, 2), {
            headers: { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // Handle /_health
        if (url.pathname === '/_health') {
          const statusReport = {};
          for (const [domain, targets] of Object.entries(domainTargets)) {
            statusReport[domain] = {};
            await Promise.all(targets.map(async (t) => {
              const key = new Request(`https://${t.host}/_metric`);
              const resp = await cache.match(key);
              
              let info = { status: 'pending', latency: null, lastChecked: null };
              
              // Try Cache API first
              if (resp) {
                try { info = await resp.json(); } catch {}
              } else {
                // Fallback to KV storage for cross-domain access
                try {
                  if (typeof lb_kv !== 'undefined') {
                    const kvData = await lb_kv.get(`health:${t.host}`, { type: 'json' });
                    if (kvData) {
                      info = kvData;
                    }
                  }
                } catch (e) {
                  console.error('Failed to read health metrics from KV:', e);
                }
              }

              statusReport[domain][t.host] = {
                type: t.type,
                status: info.status,
                latency: info.latency === 9999 ? 'TimeOut' : `${info.latency}ms`,
                last_update: info.lastChecked 
                  ? new Date(info.lastChecked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) 
                  : 'Never',
                reason: info.reason || 'OK'
              };
            }));
          }

          return new Response(JSON.stringify(statusReport, null, 2), {
            headers: { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (error) {
        console.error('Health check error:', error);
        return new Response(JSON.stringify({ 
          error: 'Internal server error', 
          message: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

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

    // Health report endpoint - return backend status (same format as worker.js)
    if (url.pathname === '/_health') {
      const cache = await caches.open('cache-host-metrics');
      const statusReport = {};
      
      await Promise.all(rule.targets.map(async (t) => {
        const key = new Request(`https://${t.host}/_metric`);
        const resp = await cache.match(key);
        
        let info = { status: 'pending', latency: null, lastChecked: null };
        
        // Try Cache API first
        if (resp) {
          try { info = await resp.json(); } catch {}
        } else {
          // Fallback to KV storage for cross-domain access
          try {
            if (typeof lb_kv !== 'undefined') {
              const kvData = await lb_kv.get(`health:${t.host}`, { type: 'json' });
              if (kvData) {
                info = kvData;
              }
            }
          } catch (e) {
            console.error('Failed to read health metrics from KV:', e);
          }
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

    // Trigger health check endpoint - actively probe all backends using worker.js logic
    if (url.pathname === '/_trigger_health_check') {
      const healthPath = rule.healthPath || '/';
      const cache = await caches.open('cache-host-metrics');
      
      // Build candidates list
      const candidates = rule.targets.map(t => ({ target: t }));
      
      // Run health check using the same logic as worker.js
      await runBackgroundHealthCheck(candidates, healthPath, cache);
      
      // Read updated metrics and return status report
      const statusReport = {};
      await Promise.all(rule.targets.map(async (t) => {
        const key = new Request(`https://${t.host}/_metric`);
        const resp = await cache.match(key);
        
        let info = { status: 'pending', latency: null, lastChecked: null, reason: null };
        
        // Try Cache API first
        if (resp) {
          try { info = await resp.json(); } catch {}
        } else {
          // Fallback to KV storage for cross-domain access
          try {
            if (typeof lb_kv !== 'undefined') {
              const kvData = await lb_kv.get(`health:${t.host}`, { type: 'json' });
              if (kvData) {
                info = kvData;
              }
            }
          } catch (e) {
            console.error('Failed to read health metrics from KV:', e);
          }
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

    // Get available targets
    const targets = rule.targets || [];
    if (targets.length === 0) {
      return new Response(JSON.stringify({ error: 'No backend targets configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cache = await caches.open('cache-host-metrics');
    const healthPath = rule.healthPath || '/';
    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    
    // Get sorted candidates by health status and latency
    const candidates = await getSortedCandidates(targets, cache);
    
    await debugLog('Request received', {
      hostname,
      path: url.pathname,
      method: request.method,
      isWebSocket,
      upgradeHeader: request.headers.get("Upgrade"),
      candidatesCount: candidates.length,
      clientIP: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP'),
      sortedCandidates: candidates.map(c => ({
        host: c.target.host,
        status: c.status,
        latency: c.latency
      }))
    });

    // WebSocket requests: delegate to Node Functions WebSocket proxy handler.
    // Middleware runtime does not provide WebSocketPair, and rewrite() does not keep WS upgraded.
    // Node Functions do NOT have access to KV, so we pass the selected target directly via query params.
    if (isWebSocket) {
      // candidates is already sorted by: 1) health status (healthy < unknown < unhealthy), 2) latency (ASC)
      // So candidates[0] is always the best choice (healthiest with lowest latency)
      const wsCandidate = candidates[0];
      const wsTarget = wsCandidate?.target;
      
      if (!wsTarget) {
        await debugLog('WebSocket: No target available', { hostname, candidatesCount: candidates.length });
        return new Response(JSON.stringify({ error: 'No WebSocket backend available' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Log all candidates for debugging
      await debugLog('WebSocket: All candidates', {
        hostname,
        candidates: candidates.map(c => ({
          host: c.target.host,
          type: c.target.type,
          status: c.status,
          latency: c.latency,
          lastChecked: c.lastChecked
        }))
      });

      // Warn if selected target is unhealthy
      if (wsCandidate.status === 'unhealthy') {
        await debugLog('WebSocket: WARNING - Selected unhealthy target', {
          target: wsTarget.host,
          reason: 'All targets are unhealthy, using best available'
        });
      }

      await debugLog('WebSocket request detected (delegating to Node Function)', {
        url: url.toString(),
        hostname,
        path: url.pathname,
        candidatesCount: candidates.length,
        selectedTarget: wsTarget.host,
        selectedStatus: wsCandidate.status,
        selectedLatency: wsCandidate.latency
      });

      const proxyUrl = new URL(url);
      proxyUrl.pathname = '/__ws_proxy';
      // Pass target info directly so Node Function doesn't need KV
      proxyUrl.searchParams.set('target', wsTarget.host);
      proxyUrl.searchParams.set('path', url.pathname);
      proxyUrl.searchParams.set('search', url.search);
      proxyUrl.searchParams.set('proto', request.headers.get('x-forwarded-proto') || request.headers.get('X-Forwarded-Proto') || url.protocol.replace(':', ''));

      // In some environments, request.url may be represented as http even when the external scheme is https/wss.
      // Force internal rewrite URL to https to avoid platform handshake issues.
      proxyUrl.protocol = 'https:';

      await debugLog('WebSocket rewrite URL', {
        originalUrl: url.toString(),
        proxyUrl: proxyUrl.toString(),
        target: wsTarget.host,
        targetType: wsTarget.type,
        candidateStatus: wsCandidate.status,
        candidateLatency: wsCandidate.latency
      });

      return rewrite(proxyUrl.toString());
    }
    
    const REQUEST_TIMEOUT = 10000;
    const FAST_FAIL_TIMEOUT = 3000;
    let response = null;

    // Serial Failover Logic (ported from worker.js)
    for (const item of candidates) {
      const start = Date.now();
      const timeout = item.status === 'unhealthy' ? FAST_FAIL_TIMEOUT : REQUEST_TIMEOUT;
      
      try {
        await debugLog('Attempting connection', { 
          target: item.target.host, 
          timeout,
          status: item.status,
          url: url.toString()
        });

        const result = await probeTarget(item.target, request.clone(), url, isWebSocket, createTimeoutSignal(timeout));
        const duration = Date.now() - start;
        
        if (result && result.ok) {
          await updateMetrics(cache, item.target.host, 'healthy', duration);
      
          await debugLog('Connection successful', {
            target: item.target.host,
            duration,
            status: result.response.status,
            contentLength: result.response.headers.get('content-length'),
            contentType: result.response.headers.get('content-type'),
            transferEncoding: result.response.headers.get('transfer-encoding')
          });

          // WebSocket: return original response directly without modification
          // Wrapping WebSocket 101 response would break the connection
          if (result.isWebSocket) {
            response = result.response;
            break;
          }
          
          // HTTP: Add custom headers
          const responseHeaders = sanitizeProxyResponseHeaders(result.response.headers);
          responseHeaders.set('X-LB-Backend', item.target.host);
          responseHeaders.set('X-LB-Powered-By', 'EdgeOne-LB');
          responseHeaders.set('X-LB-Platform', rule.platform || 'edgeone');
          
          // Pass through the response body stream directly
          response = new Response(result.response.body, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: responseHeaders
          });
          break;
        } else {
          await debugLog('Connection failed', {
            target: item.target.host,
            duration,
            reason: result?.reason,
            errorDetail: result?.errorDetail,
            requestUrl: url.toString(),
            method: request.method
          });
          await updateMetrics(cache, item.target.host, 'unhealthy', duration, result?.reason);
        }
      } catch (e) {
        const duration = Date.now() - start;
        const reason = e.name === 'TimeoutError' ? 'Timeout' : e.message;
        
        await debugLog('Connection error', {
          target: item.target.host,
          duration,
          error: reason,
          errorName: e.name,
          stack: e.stack,
          requestUrl: url.toString(),
          method: request.method
        });
        
        await updateMetrics(cache, item.target.host, 'unhealthy', duration, reason);
      }
    }

    // Trigger background health check if needed
    const HEALTH_CHECK_INTERVAL = 600000; // 10 minutes
    const needsHealthCheck = candidates.some(c => {
      return (Date.now() - (c.lastChecked || 0) > HEALTH_CHECK_INTERVAL) || c.status === 'unknown';
    });

    if (needsHealthCheck && healthPath) {
      // Fire-and-forget background health check
      runBackgroundHealthCheck(candidates, healthPath, cache).catch(() => {});
    }

    if (response) {
      await debugLog('Returning response to client', {
        status: response.status,
        hasBody: !!response.body,
        headers: Object.fromEntries(response.headers)
      });
      return response;
    }

    await debugLog('All backends failed', {
      hostname,
      candidatesCount: candidates.length,
      targets: candidates.map(c => ({ host: c.target.host, status: c.status }))
    });

    return new Response(JSON.stringify({ error: 'Service Unavailable - All backends failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Load balancer error:', error);
    
    const errorContext = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      url: request.url,
      method: request.method,
      hostname: url?.hostname,
      pathname: url?.pathname,
      timestamp: new Date().toISOString(),
      cause: error.cause ? String(error.cause) : null
    };
    
    await debugLog('Critical Internal Error', errorContext);

    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      ...errorContext
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
