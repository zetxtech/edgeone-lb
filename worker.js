// =================================================================
// Global Configuration
// =================================================================
const LOAD_BALANCING_RULES = {
  "solver.zetx.site": {
    forceHttps: true, // Force 302 Redirect to HTTPS
    healthPath: "/",  // Path used for background health checks (must return 200 OK)
    targets: [
      { host: "cfsolver-sf.zetx.tech", type: "frp" },
      { host: "cfsolver-me.zetx.tech", type: "frp" },
      { host: "cfsolver-fo.zetx.tech", type: "frp" },
      { host: "cfsolver-ch.zetx.tech", type: "frp" },
      { host: "cfsolver-cf.zetx.tech", type: "tunnel" },
      { host: "cfsolver-00.zetx.tech", type: "frp" },
      { host: "cfsolver-v6.zetx.tech:1443", type: "direct" },
    ],
  },
};

export default {
  /**
   * HTTP Request Handler
   * Handles incoming traffic and routes to healthy backends.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    const rule = LOAD_BALANCING_RULES[hostname];
    if (!rule) return new Response("Not Found", { status: 404 });

    // Enforce HTTPS
    if (rule.forceHttps && url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 302);
    }

    const cache = await caches.open("cache:host-metrics");

    // Debugging Interface
    if (url.pathname === "/_health") {
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
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*" 
        },
      });
    }

    // Retrieve and sort candidates based on cache metrics
    const candidates = await getSortedCandidates(rule.targets, cache);

    // Serial Failover Mode
    const response = await handleFailover(request, candidates, url, ctx, cache, rule.healthPath);

    return response || new Response("Service Unavailable", { status: 503 });
  },

  /**
   * Scheduled Event Handler
   * Performs periodic background health checks to maintain cache freshness.
   */
  async scheduled(event, env, ctx) {
    const cache = await caches.open("cache:host-metrics");
    
    // Iterate over all configured services
    const maintenanceTasks = Object.values(LOAD_BALANCING_RULES).map(async (rule) => {
      // Skip services without a health check path
      if (!rule.healthPath) return;

      // Construct target objects for the health checker
      const targetsToCheck = rule.targets.map(t => ({ target: t }));
      
      // Execute health checks without blocking (fire-and-forget within the scheduled event context)
      await runBackgroundHealthCheck(targetsToCheck, rule.healthPath, cache);
    });

    await Promise.allSettled(maintenanceTasks);
  }
};

// =================================================================
// Core Logic Functions
// =================================================================

/**
 * Fetch metrics from cache and sort targets.
 */
async function getSortedCandidates(targets, cache) {
  const statusPromises = targets.map(async (t) => {
    const key = new Request(`https://${t.host}/_metric`);
    const resp = await cache.match(key);
    let data = { status: 'unknown', latency: 9999, lastChecked: 0 };
    if (resp) {
      try { data = await resp.json(); } catch {}
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

/**
 * Serial Failover Mode
 * Tries candidates sequentially based on health status and latency.
 */
async function handleFailover(request, candidatesWithStats, url, ctx, cache, healthPath) {
  const REQUEST_TIMEOUT = 10000;
  const FAST_FAIL_TIMEOUT = 3000; // Faster timeout for unhealthy nodes
  const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  let response = null;

  // Serial Failover Logic
  for (const item of candidatesWithStats) {
    const start = Date.now();
    // Use shorter timeout for known unhealthy nodes
    const timeout = item.status === 'unhealthy' ? FAST_FAIL_TIMEOUT : REQUEST_TIMEOUT;
    
    try {
      const result = await probeTarget(item.target, request.clone(), url, isWebSocket, AbortSignal.timeout(timeout));
      const duration = Date.now() - start;
      
      if (result && result.ok) {
        updateMetrics(ctx, cache, item.target.host, 'healthy', duration);
        response = result.response;
        break; 
      } else {
        updateMetrics(ctx, cache, item.target.host, 'unhealthy', duration, result?.reason);
      }
    } catch (e) {
      const duration = Date.now() - start;
      const reason = e.name === 'TimeoutError' ? 'Timeout' : e.message;
      updateMetrics(ctx, cache, item.target.host, 'unhealthy', duration, reason);
    }
  }

  // Evaluate if background refresh is needed
  const HEALTH_CHECK_INTERVAL = 600000; // 10 minutes, aligned with cache TTL
  const needsHealthCheck = candidatesWithStats.some(c => {
     return (Date.now() - (c.lastChecked || 0) > HEALTH_CHECK_INTERVAL) || c.status === 'unknown';
  });

  if (needsHealthCheck && healthPath) {
    ctx.waitUntil(runBackgroundHealthCheck(candidatesWithStats, healthPath, cache));
  }

  return response;
}

/**
 * Execution Engine: Probes health endpoints
 * Uses the same FRP/Tunnel detection logic as real requests
 */
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
        headers: { "User-Agent": "Cloudflare-Worker-Health-Monitor" },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT)
      });

      const resp = await fetch(req);
      const duration = Date.now() - start;

      // Use the same FRP/Tunnel detection logic as real requests
      const judged = await judgeAndMaybeTransformResponse({
        resp,
        target,
        isWebSocket: false,
        originalUrl: checkUrl,
      });

      if (judged.ok) {
        await updateMetrics(null, cache, target.host, 'healthy', duration);
      } else {
        await updateMetrics(null, cache, target.host, 'unhealthy', duration, judged.reason);
      }
    } catch (e) {
      const duration = Date.now() - start;
      const reason = e.name === 'TimeoutError' ? 'Timeout' : e.message;
      await updateMetrics(null, cache, target.host, 'unhealthy', 9999, reason);
    }
  });

  await Promise.allSettled(checks);
}

// =================================================================
// Helper Utilities
// =================================================================

async function updateMetrics(ctx, cache, host, status, latency, reason = null) {
  const key = new Request(`https://${host}/_metric`);
  const data = {
    status,
    latency,
    reason,
    lastChecked: Date.now()
  };
  
  // Cache TTL configuration (10 minutes, aligned with health check frequency)
  const ttl = 600; 
  
  const promise = cache.put(key, new Response(JSON.stringify(data), {
    headers: { 
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}`
    }
  }));

  if (ctx) ctx.waitUntil(promise);
  else await promise;
}

/**
 * Protocol Handler: Manages upstream connections
 * Handles FRP and Tunnel specific protocol signatures.
 */
async function probeTarget(target, request, originalUrl, isWebSocket, signal) {
  try {
    const upstreamUrl = new URL(originalUrl);
    const parts = target.host.split(":");
    upstreamUrl.hostname = parts[0];
    if (parts[1]) upstreamUrl.port = parts[1];

    const upstreamReq = new Request(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: isWebSocket ? null : request.body,
      redirect: "manual",
      signal: signal
    });

    const resp = await fetch(upstreamReq);

    const judged = await judgeAndMaybeTransformResponse({
      resp,
      target,
      isWebSocket,
      originalUrl,
    });

    if (!judged.ok) {
      return { ok: false, reason: judged.reason };
    }

    // For WebSocket, return the original response directly to preserve the connection
    if (isWebSocket) {
      return {
        ok: true,
        response: judged.response
      };
    }

    const headers = new Headers(judged.response.headers);
    headers.set('CF-Balancing-Origin', upstreamUrl.toString());

    return { 
      ok: true, 
      response: new Response(judged.response.body, {
        status: judged.response.status,
        statusText: judged.response.statusText,
        headers: headers,
      })
    };

  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { ok: false, reason: e.message };
  }
}

/**
 * Response Validator
 * Detects proxy error signatures (FRP/Tunnel) vs legitimate application responses.
 */
async function judgeAndMaybeTransformResponse({ resp, target, isWebSocket, originalUrl }) {
  const status = resp.status;

  // WebSocket Validation
  if (isWebSocket) {
    // WebSocket upgrade should return 101 Switching Protocols
    if (status === 101) {
      return { ok: true, response: resp };
    }
    
    // Proxy-specific error detection
    if (target.type === "frp" && (status === 404 || status === 525 || status === 530)) {
      return { ok: false, reason: `FRP returned ${status} for WebSocket` };
    }
    if (target.type === "tunnel" && (status === 530 || status === 502)) {
      return { ok: false, reason: `Tunnel returned ${status} for WebSocket` };
    }
    
    // Any 5xx error indicates failure, 4xx errors (except auth) also indicate failure
    if (status >= 500 || (status >= 400 && status !== 401 && status !== 403)) {
      return { ok: false, reason: `WS Status ${status}` };
    }
    
    // For WebSocket, return response directly without redirect handling
    return { ok: true, response: resp };
  }

  // HTTP Validation (for health checks and regular requests)
  if (target.type === "tunnel" && (status === 530 || status === 502)) {
    return { ok: false, reason: `Tunnel returned ${status}` };
  }

  if (target.type === "frp" && (status === 525 || status === 530)) {
    return { ok: false, reason: "FRP returned 525 (SSL Handshake Failed)" };
  }

  // FRP Signature Inspection
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
          for(const c of chunks) { tempBuf.set(c, offset); offset += c.length; }
          
          const text = new TextDecoder().decode(tempBuf);
          if (text.includes("Faithfully yours, frp.")) {
            signatureFound = true;
            break; 
          }
        }
    } catch (e) {
        try { await reader.cancel(); } catch {}
        return { ok: false, reason: "Stream read error" };
    }

    if (signatureFound) {
       try { await reader.cancel(); } catch {}
       return { ok: false, reason: "FRP 404 signature matched" };
    }

    // If no chunks were read (empty body), treat as legitimate 404
    if (chunks.length === 0) {
      try { await reader.cancel(); } catch {}
      return { ok: true, response: handleRedirect(resp, originalUrl) };
    }

    // Replay the response body
    const replay = new ReadableStream({
      async start(controller) {
        try {
          // Enqueue already-read chunks
          for (const c of chunks) {
            controller.enqueue(c);
          }
          
          // Continue reading remaining data only if stream hasn't ended
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

/**
 * Redirect Header Rewriter
 */
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