// EdgeOne Pages Middleware
// Determines whether request goes to admin panel (Nuxt) or load balancer
// Health check and failover logic ported from worker.js

// Admin panel hostnames - requests to these hosts go to Nuxt
// All other hostnames are treated as proxied domains and go to load balancer
const ADMIN_HOSTNAMES = [
  'elb.zetx.tech'
];

const DEBUG_HEADER = 'EdgeoneLBDebugger';
const GENERIC_ERROR_RESPONSE_BODY = {
  error: 'Internal server error',
};

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

function extractErrorStatus(error, fallback = 500) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value >= 400 && value <= 599) {
      return value;
    }
  }

  const message = String(error?.message || '').trim();
  if (/^\d{3}$/.test(message)) {
    const value = Number(message);
    if (value >= 400 && value <= 599) {
      return value;
    }
  }

  return fallback;
}

function shouldExposeDebugInfo(request) {
  return request.headers.has(DEBUG_HEADER);
}

function serializeLogValue(value, depth = 0) {
  if (value == null) return value;
  if (depth >= 5) return '[MaxDepth]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause ? serializeLogValue(value.cause, depth + 1) : null,
    };
  }

  if (value instanceof URL) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeLogValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serializeLogValue(item, depth + 1);
    }
    return result;
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  return value;
}

function pushRequestLog(logs, phase, message, detail = undefined) {
  const entry = {
    time: new Date().toISOString(),
    phase,
    message,
  };

  if (detail !== undefined) {
    entry.detail = serializeLogValue(detail);
  }

  logs.push(entry);
}

function createJsonErrorResponse(status, payload, logs = [], exposeDebugInfo = false) {
  if (!exposeDebugInfo) {
    return new Response(JSON.stringify(GENERIC_ERROR_RESPONSE_BODY), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const responsePayload = { ...payload };
  if (logs.length > 0) {
    responsePayload.logs = logs;
  }

  return new Response(JSON.stringify(responsePayload, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
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

function createStreamingProxyResponse(response, injectedHeaders = {}) {
  const headers = sanitizeProxyResponseHeaders(response.headers);

  for (const [key, value] of Object.entries(injectedHeaders)) {
    if (value != null) {
      headers.set(key, value);
    }
  }

  const body = response.body
    ? response.body.pipeThrough(new TransformStream())
    : null;

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
async function probeTarget(target, request, originalUrl, isWebSocket, signal, addLog = null) {
  try {
    const upstreamUrl = new URL(originalUrl);
    const parts = target.host.split(":");
    upstreamUrl.hostname = parts[0];
    if (parts[1]) upstreamUrl.port = parts[1];
    const streamingRequest = !isWebSocket;

    if (addLog) {
      addLog('probe_target_prepare_request', {
        target: target.host,
        targetType: target.type,
        upstreamUrl: upstreamUrl.toString(),
        method: request.method,
        isWebSocket,
        streamingRequest,
      });
    }

    const upstreamHeaders = sanitizeUpstreamRequestHeaders(request.headers);
    if (!isWebSocket) {
      upstreamHeaders.set('Host', buildUpstreamHostHeader(target, upstreamUrl.protocol));
    }
    if (streamingRequest) {
      upstreamHeaders.set('Accept-Encoding', 'identity');
      upstreamHeaders.set('Cache-Control', 'no-cache, no-transform');
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

    const requestBody = isWebSocket ? undefined : (request.body ?? undefined);
    const upstreamRequestInit = {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "manual",
      signal: signal,
    };

    if (requestBody !== undefined) {
      upstreamRequestInit.body = requestBody;
      upstreamRequestInit.duplex = 'half';
    }

    const upstreamReq = new Request(upstreamUrl, upstreamRequestInit);

    let resp;
    try {
      if (addLog) {
        addLog('probe_target_fetch_start', {
          target: target.host,
          upstreamUrl: upstreamUrl.toString(),
          method: request.method,
        });
      }
      resp = await fetch(upstreamReq);
    } catch (fetchError) {
      if (addLog) {
        addLog('probe_target_fetch_failed', {
          target: target.host,
          upstreamUrl: upstreamUrl.toString(),
          error: fetchError,
        });
      }
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

    if (addLog) {
      addLog('probe_target_fetch_completed', {
        target: target.host,
        upstreamUrl: upstreamUrl.toString(),
        status: resp.status,
        statusText: resp.statusText,
        hasWebSocket: !!resp.webSocket,
      });
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
              if (addLog) {
                addLog('probe_target_websocket_failed', {
                  target: target.host,
                  upstreamUrl: upstreamWsUrl.toString(),
                  error: e,
                });
              }
              resolve({ ok: false, reason: `WebSocket connection failed: ${e.message || 'unknown error'}` });
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
              if (resolved) return;
              resolved = true;
              try { upstreamSocket.close(); } catch {}
              if (addLog) {
                addLog('probe_target_websocket_timeout', {
                  target: target.host,
                  upstreamUrl: upstreamWsUrl.toString(),
                });
              }
              resolve({ ok: false, reason: 'WebSocket connection timeout' });
            }, 10000);
          });
        } catch (e) {
          if (addLog) {
            addLog('probe_target_websocket_error', {
              target: target.host,
              upstreamUrl: upstreamWsUrl.toString(),
              error: e,
            });
          }
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
      if (addLog) {
        addLog('probe_target_response_rejected', {
          target: target.host,
          upstreamUrl: upstreamUrl.toString(),
          reason: judged.reason,
          status: judged.status,
          statusText: judged.statusText,
          error: judged.error,
        });
      }
      return { 
        ok: false, 
        reason: judged.reason,
        status: judged.status,
        statusText: judged.statusText,
        target: judged.target,
        error: judged.error
      };
    }

    if (addLog) {
      addLog('probe_target_response_accepted', {
        target: target.host,
        upstreamUrl: upstreamUrl.toString(),
        status: judged.response.status,
        statusText: judged.response.statusText,
      });
    }

    return { 
      ok: true, 
      response: judged.response,
      isWebSocket: false,
    };

  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (addLog) {
      addLog('probe_target_unhandled_error', {
        target: target.host,
        url: originalUrl.toString(),
        error: e,
      });
    }
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
  const url = new URL(request.url);
  const hostname = url.hostname;
  const exposeDebugInfo = shouldExposeDebugInfo(request);
  let phase = 'init';
  const requestLogs = [];
  const failedAttempts = [];
  const addLog = exposeDebugInfo
    ? (message, detail) => pushRequestLog(requestLogs, phase, message, detail)
    : () => {};
  const setPhase = (nextPhase, message, detail) => {
    phase = nextPhase;
    if (exposeDebugInfo) {
      pushRequestLog(requestLogs, phase, message, detail);
    }
  };

  addLog('request_received', {
    url: request.url,
    method: request.method,
    hostname,
    pathname: url.pathname,
  });

  // Allow internal WebSocket proxy handler to run (avoid recursion in middleware)
  if (url.pathname === '/__ws_proxy') {
    addLog('internal_websocket_proxy_passthrough');
    return next();
  }

  // Check if this is the admin panel
  const isAdmin = ADMIN_HOSTNAMES.includes(hostname) ||
                  hostname.endsWith('.edgeone.run') || 
                  hostname.endsWith('.edgeone.site');
  addLog('request_classified', { isAdmin });

  if (isAdmin) {
    // Handle special endpoints for admin panel
    if (url.pathname === '/_trigger_health_check' || url.pathname === '/_health') {
      try {
        setPhase('admin_health_entry', 'admin_health_endpoint_requested', {
          pathname: url.pathname,
        });
        if (typeof lb_kv === 'undefined') {
          addLog('admin_health_kv_missing');
          return createJsonErrorResponse(503, { 
            error: 'KV namespace not bound',
            message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
          }, requestLogs, exposeDebugInfo);
        }

        addLog('admin_health_read_rules_start');
        const rules = await lb_kv.get('rules', { type: 'json' }) || {};
        addLog('admin_health_read_rules_done', {
          domainCount: Object.keys(rules).length,
        });
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
          addLog('admin_health_no_targets_configured', {
            domains: Object.keys(rules),
          });
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
          setPhase('admin_trigger_health_check', 'admin_trigger_health_check_start', {
            domainCount: Object.keys(rules).length,
          });
          // Run health check for all domains
          for (const [domain, rule] of Object.entries(rules)) {
            if (rule.targets && rule.targets.length > 0) {
              const healthPath = rule.healthPath || '/';
              const candidates = rule.targets.map(t => ({ target: t }));
              addLog('admin_trigger_health_check_domain', {
                domain,
                targetCount: rule.targets.length,
                healthPath,
              });
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

          return new Response(JSON.stringify(statusReport, null, 2), {
            headers: { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // Handle /_health
        if (url.pathname === '/_health') {
          setPhase('admin_health_report', 'admin_health_report_start', {
            domainCount: Object.keys(domainTargets).length,
          });
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
        const status = extractErrorStatus(error);
        addLog('admin_health_error', { error });
        return createJsonErrorResponse(status, { 
          error: status === 500 ? 'Internal server error' : `HTTP ${status}`,
          message: error.message 
        }, requestLogs, exposeDebugInfo);
      }
    }

    // Admin panel request -> pass through to Nuxt
    addLog('admin_panel_passthrough');
    return next();
  }

  // Proxied domain request -> handle load balancing directly in middleware
  try {
    // Get rules from KV
    setPhase('read_rules', 'proxy_read_rules_start', { hostname });
    let rules = {};
    try {
      if (typeof lb_kv === 'undefined') {
        addLog('proxy_kv_missing');
        return createJsonErrorResponse(503, { 
          error: 'KV namespace not bound',
          message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings'
        }, requestLogs, exposeDebugInfo);
      }
      rules = await lb_kv.get('rules', { type: 'json' }) || {};
      addLog('proxy_read_rules_done', {
        domainCount: Object.keys(rules).length,
      });
    } catch (error) {
      console.error('Failed to read KV:', error);
      addLog('proxy_read_rules_failed', { error });
      return createJsonErrorResponse(503, { 
        error: 'KV storage error',
        message: error.message
      }, requestLogs, exposeDebugInfo);
    }

    // Check if we have rules for this hostname
    const rule = rules[hostname];
    if (!rule) {
      addLog('proxy_rule_missing', {
        hostname,
        availableDomains: Object.keys(rules),
      });
      return createJsonErrorResponse(404, { 
        error: `Domain ${hostname} not configured`,
        hostname: hostname,
        availableDomains: Object.keys(rules)
      }, requestLogs, exposeDebugInfo);
    }

    addLog('proxy_rule_loaded', {
      hostname,
      forceHttps: !!rule.forceHttps,
      healthPath: rule.healthPath || '/',
      targetCount: Array.isArray(rule.targets) ? rule.targets.length : 0,
      platform: rule.platform || 'edgeone',
    });

    // Force HTTPS redirect if configured
    if (rule.forceHttps && url.protocol === 'http:') {
      addLog('proxy_force_https_redirect', {
        from: request.url,
      });
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 302);
    }

    // Health report endpoint - return backend status (same format as worker.js)
    if (url.pathname === '/_health') {
      setPhase('health_report', 'proxy_health_report_start', {
        targetCount: rule.targets.length,
      });
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
      setPhase('trigger_health_check', 'proxy_trigger_health_check_start', {
        targetCount: rule.targets.length,
      });
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
      addLog('proxy_no_targets_configured');
      return createJsonErrorResponse(503, { error: 'No backend targets configured' }, requestLogs, exposeDebugInfo);
    }

    const cache = await caches.open('cache-host-metrics');
    const healthPath = rule.healthPath || '/';
    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    addLog('proxy_request_mode', {
      isWebSocket,
      healthPath,
      targetCount: targets.length,
    });
    
    // Get sorted candidates by health status and latency
    setPhase('load_candidates', 'proxy_load_candidates_start', {
      targetCount: targets.length,
    });
    const candidates = await getSortedCandidates(targets, cache);
    addLog('proxy_load_candidates_done', candidates.map((candidate) => ({
      host: candidate?.target?.host || null,
      type: candidate?.target?.type || null,
      status: candidate?.status || 'unknown',
      latency: candidate?.latency ?? null,
      lastChecked: candidate?.lastChecked || 0,
      reason: candidate?.reason || null,
    })));

    // WebSocket requests: delegate to Node Functions WebSocket proxy handler.
    // Middleware runtime does not provide WebSocketPair, and rewrite() does not keep WS upgraded.
    // Node Functions do NOT have access to KV, so we pass the selected target directly via query params.
    if (isWebSocket) {
      // candidates is already sorted by: 1) health status (healthy < unknown < unhealthy), 2) latency (ASC)
      // So candidates[0] is always the best choice (healthiest with lowest latency)
      const wsCandidate = candidates[0];
      const wsTarget = wsCandidate?.target;
      
      if (!wsTarget) {
        addLog('proxy_no_websocket_backend_available');
        return createJsonErrorResponse(503, { error: 'No WebSocket backend available' }, requestLogs, exposeDebugInfo);
      }

      setPhase('websocket_rewrite', 'proxy_websocket_rewrite_start', {
        target: wsTarget.host,
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

      addLog('proxy_websocket_rewrite_done', {
        target: wsTarget.host,
        rewriteUrl: proxyUrl.toString(),
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
      setPhase(`probe:${item.target.host}`, 'proxy_probe_start', {
        target: item.target.host,
        targetType: item.target.type,
        candidateStatus: item.status,
        timeout,
      });
      
      try {
        const result = await probeTarget(
          item.target,
          request.clone(),
          url,
          isWebSocket,
          createTimeoutSignal(timeout),
          addLog,
        );
        const duration = Date.now() - start;
        
        if (result && result.ok) {
          addLog('proxy_probe_succeeded', {
            target: item.target.host,
            duration,
            isWebSocket: !!result.isWebSocket,
            status: result.response?.status || 101,
          });
          await updateMetrics(cache, item.target.host, 'healthy', duration);

          // WebSocket: return original response directly without modification
          // Wrapping WebSocket 101 response would break the connection
          if (result.isWebSocket) {
            response = result.response;
            break;
          }

          response = createStreamingProxyResponse(result.response, {
            'X-LB-Backend': item.target.host,
            'X-LB-Powered-By': 'EdgeOne-LB',
            'X-LB-Platform': rule.platform || 'edgeone',
            'X-Accel-Buffering': 'no',
          });
          addLog('proxy_response_selected', {
            target: item.target.host,
            status: result.response.status,
            statusText: result.response.statusText,
          });
          break;
        } else {
          addLog('proxy_probe_failed', {
            target: item.target.host,
            duration,
            reason: result?.reason || 'Unknown failure',
            status: result?.status || null,
            statusText: result?.statusText || null,
            error: result?.error || null,
            errorDetail: result?.errorDetail || null,
          });
          failedAttempts.push({
            target: item.target.host,
            type: item.target.type,
            candidateStatus: item.status,
            timeout,
            duration,
            reason: result?.reason || 'Unknown failure',
            status: result?.status || null,
            statusText: result?.statusText || null,
            error: result?.error || null,
            errorDetail: result?.errorDetail || null,
          });
          await updateMetrics(cache, item.target.host, 'unhealthy', duration, result?.reason);
        }
      } catch (e) {
        const duration = Date.now() - start;
        const reason = e.name === 'TimeoutError' ? 'Timeout' : e.message;
        addLog('proxy_probe_threw', {
          target: item.target.host,
          duration,
          reason,
          error: e,
        });
        failedAttempts.push({
          target: item.target.host,
          type: item.target.type,
          candidateStatus: item.status,
          timeout,
          duration,
          reason,
          status: null,
          statusText: null,
          error: {
            name: e.name,
            message: e.message,
            stack: e.stack,
          },
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
      setPhase('background_health_check', 'proxy_background_health_check_scheduled', {
        healthPath,
      });
      runBackgroundHealthCheck(candidates, healthPath, cache).catch(() => {});
    }

    if (response) {
      addLog('proxy_request_completed_successfully');
      return response;
    }

    setPhase('all_backends_failed', 'proxy_all_backends_failed', {
      attempts: failedAttempts.length,
    });
    return createJsonErrorResponse(503, {
      error: 'Service Unavailable - All backends failed',
      message: 'Every candidate backend failed during proxying. See logs for the full request trace.',
      request: {
        url: request.url,
        method: request.method,
        hostname,
        pathname: url.pathname,
        isWebSocket,
        healthPath,
      },
      attempts: failedAttempts,
    }, requestLogs, exposeDebugInfo);

  } catch (error) {
    console.error('Load balancer error:', error);
    const status = extractErrorStatus(error);
    addLog('proxy_unhandled_error', { error });

    return createJsonErrorResponse(status, { 
      error: status === 500 ? 'Internal server error' : `HTTP ${status}`,
      message: error.message,
      request: {
        url: request.url,
        method: request.method,
        hostname: url?.hostname,
        pathname: url?.pathname,
      },
      exception: serializeLogValue(error),
      attempts: failedAttempts,
    }, requestLogs, exposeDebugInfo);
  }
}

// Match all routes
export const config = {
  matcher: '/:path*'
};
