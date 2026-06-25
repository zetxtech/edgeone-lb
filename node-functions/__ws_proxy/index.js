/**
 * Node Functions WebSocket proxy handler.
 *
 * Middleware rewrites WebSocket upgrades to this Node Function via
 * rewrite('/__ws_proxy?target=...&path=...&proto=...').
 *
 * The handler resolves the upstream target, opens an outbound WebSocket
 * connection, and proxies frames bidirectionally between the client
 * and the upstream server.
 *
 * Diagnostic records are ALWAYS written to KV (lb_kv) on connection
 * close, regardless of the _debug flag.  Key format: ws_diag_<uuid>
 * (only letters, numbers, underscores — no colons or hyphens).
 *
 * Query params (set by lb-proxy.js onWebSocketProxyRequest):
 *   target          upstream host:port
 *   path            upstream pathname (default "/")
 *   search          original query string
 *   proto           original protocol ("https" → wss)
 *   _debug          "1" for detailed step-by-step logs
 *   _h_origin       forwarded Origin header
 *   _h_protocol     forwarded Sec-WebSocket-Protocol header
 *   _h_ua           forwarded User-Agent header
 */

const DEBUG_LOG_KEY_PREFIX = 'ws_diag_';
const DEBUG_LOG_TTL = 60 * 60 * 24 * 7; // 7 days
const PROXY_VERSION = 'ws-proxy-v6';
const CONNECT_TIMEOUT_MS = 10000;
const DEBUG_HEADER = 'EdgeoneLBDebugger';

// ── Helpers ────────────────────────────────────────────────────────────────

function createDebugLogId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {}
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeSerialize(value, depth) {
  if (depth === undefined) depth = 0;
  if (value == null) return value;
  if (depth >= 5) return '[MaxDepth]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack,
      cause: value.cause ? safeSerialize(value.cause, depth + 1) : null };
  }
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) return value.map(function (i) { return safeSerialize(i, depth + 1); });
  if (typeof value === 'object') {
    var r = {};
    for (var k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) r[k] = safeSerialize(value[k], depth + 1); }
    return r;
  }
  return value;
}

function persistLog(record) {
  try {
    if (typeof lb_kv === 'undefined') return;
    var key = DEBUG_LOG_KEY_PREFIX + record.id;
    lb_kv.put(key, JSON.stringify(record), { expirationTtl: DEBUG_LOG_TTL }).catch(function () {});
  } catch {}
}

function stringifyErr(err) {
  if (!err) return null;
  try { return { name: err.name, message: err.message, stack: err.stack }; }
  catch (e) { return { message: String(err) }; }
}

function shouldExposeDebugInfo(request) {
  var ua = request.headers.get('user-agent') || '';
  return request.headers.has(DEBUG_HEADER) || ua.indexOf(DEBUG_HEADER) !== -1;
}

// ── WebSocket constructor resolution ───────────────────────────────────────

async function resolveWebSocketCtor() {
  // 1. Platform-native WebSocket (best — uses platform networking stack)
  if (typeof globalThis !== 'undefined' && typeof globalThis.WebSocket === 'function') {
    return { ctor: globalThis.WebSocket, source: 'globalThis.WebSocket' };
  }
  // 2. Bare WebSocket global (some runtimes expose it without globalThis)
  if (typeof WebSocket === 'function') {
    return { ctor: WebSocket, source: 'global.WebSocket' };
  }
  // 3. ws npm library (uses Node.js net.Socket — may not work in all edge envs)
  try {
    var mod = await import('ws');
    var ctor = mod && (mod.default || mod.WebSocket || mod);
    if (ctor && typeof ctor === 'function') return { ctor: ctor, source: 'ws-npm' };
  } catch {}
  return null;
}

// ── URL helpers ────────────────────────────────────────────────────────────

function buildUpstreamWsUrl(targetHost, originalUrl, originalPath, originalSearch, originalProto) {
  var base = new URL(originalUrl);
  var parts = String(targetHost).split(':');
  base.hostname = parts[0];
  base.port = parts[1] || '';

  var proto = String(originalProto || '').toLowerCase();
  if (proto === 'https' || proto === 'wss') base.protocol = 'wss:';
  else if (proto === 'http' || proto === 'ws') base.protocol = 'ws:';
  else base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

  base.pathname = originalPath || '/';
  base.search = originalSearch
    ? (originalSearch.charAt(0) === '?' ? originalSearch : '?' + originalSearch)
    : '';
  return base.toString();
}

// ── KV / candidate helpers ─────────────────────────────────────────────────

var METRICS_CACHE_NAME = 'cache-host-metrics';
var UNKNOWN_LATENCY = 999;

async function readHealthMetrics(cache, host) {
  try {
    var resp = await cache.match(new Request('https://' + host + '/_metric'));
    if (resp) return await resp.json();
  } catch {}
  return { status: 'unknown', latency: UNKNOWN_LATENCY, lastChecked: 0 };
}

async function getSortedCandidates(targets, cache) {
  var results = await Promise.all(targets.map(async function (t) {
    var data = await readHealthMetrics(cache, t.host);
    return { target: t, status: data.status, latency: data.latency };
  }));
  return results.sort(function (a, b) {
    var score = function (s) { return s === 'healthy' ? 0 : s === 'unknown' ? 1 : 2; };
    if (score(a.status) !== score(b.status)) return score(a.status) - score(b.status);
    return a.latency - b.latency;
  });
}

async function resolveTargetFromKV(hostname) {
  if (typeof lb_kv === 'undefined') return null;
  var rules = await lb_kv.get('rules', { type: 'json' }) || {};
  var rule = rules[hostname];
  if (!rule) return null;
  var targets = Array.isArray(rule.targets) ? rule.targets : [];
  if (targets.length === 0) return null;
  try {
    var cache = await caches.open(METRICS_CACHE_NAME);
    var candidates = await getSortedCandidates(targets, cache);
    return candidates[0] && candidates[0].target ? candidates[0].target : targets[0];
  } catch { return targets[0]; }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function onRequest(context) {
  var request = context.request;
  try {
    var url = new URL(request.url);
    var upgradeHeader = request.headers.get('upgrade');

    // Diagnostic HTTP endpoint: ?diag=1
    if (url.searchParams.get('diag') === '1') {
      var wsInfo = await resolveWebSocketCtor();
      return new Response(JSON.stringify({
        ok: true, version: PROXY_VERSION,
        upgrade: upgradeHeader || null,
        ws: wsInfo ? { available: true, source: wsInfo.source, name: wsInfo.ctor.name || null } : { available: false },
        globalThisWebSocket: typeof globalThis !== 'undefined' ? typeof globalThis.WebSocket : 'n/a',
        globalWebSocket: typeof WebSocket,
        lb_kv: typeof lb_kv,
      }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket. Add ?diag=1 for diagnostics.', {
        status: 426, headers: { 'Content-Type': 'text/plain', 'Upgrade': 'websocket' },
      });
    }

    var hostname = url.hostname;
    var debug = url.searchParams.get('_debug') === '1';

    // Resolve target: explicit param or KV lookup
    var targetHost = (url.searchParams.get('target') || '').trim();
    var originalPath = (url.searchParams.get('path') || '').trim();
    var originalSearch = (url.searchParams.get('search') || '').trim();
    var originalProto = (url.searchParams.get('proto') || '').trim();

    if (!targetHost) {
      var target = await resolveTargetFromKV(hostname);
      if (!target) {
        return new Response(JSON.stringify({ error: 'No backend for ' + hostname, version: PROXY_VERSION }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
      targetHost = target.host;
    }

    if (!originalPath) {
      originalPath = url.pathname === '/__ws_proxy' ? '/' : (url.pathname.replace(/^\/__ws_proxy/, '') || '/');
    }
    if (!originalProto) {
      originalProto = request.headers.get('x-forwarded-proto') || request.headers.get('X-Forwarded-Proto') || 'https';
    }

    var upstreamUrl = buildUpstreamWsUrl(targetHost, request.url, originalPath, originalSearch, originalProto);

    return { websocket: createProxyHandler(upstreamUrl, targetHost, request, debug) };
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal Error', version: PROXY_VERSION, detail: stringifyErr(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Proxy handler ──────────────────────────────────────────────────────────

function createProxyHandler(upstreamUrl, targetHost, originalRequest, debug) {
  var upstream = null;
  var client = null;
  var clientClosed = false;
  var pending = [];
  var MAX_PENDING = 256;
  var OPEN_STATE = 1;
  var ctorSource = 'unknown';
  var startedAt = Date.now();
  var msgSeq = 0;

  // Accumulate log entries — always collected, persisted on cleanup
  var steps = [];
  var step = function (name, detail) {
    steps.push({ t: new Date().toISOString(), n: name, d: detail });
  };

  var finalize = function (outcome, closeInfo) {
    if (clientClosed && outcome !== 'already_finalized') return; // prevent double
    var record = {
      id: createDebugLogId(),
      version: PROXY_VERSION,
      createdAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      outcome: outcome,
      ctorSource: ctorSource,
      request: { url: originalRequest.url },
      proxy: { upstreamUrl: upstreamUrl, targetHost: targetHost },
      close: closeInfo || null,
      messages: msgSeq,
      steps: steps,
    };
    persistLog(record);
  };

  var safeClose = function (ws, code, reason) {
    try { if (ws && typeof ws.close === 'function') ws.close(code, reason); } catch {}
  };

  var sanitizeCode = function (code) {
    if (typeof code !== 'number' || !isFinite(code)) return 1000;
    if (code === 1005 || code === 1006 || code === 1015) return 1000;
    if (code < 1000 || code > 4999) return 1000;
    return code;
  };

  var safeSend = function (ws, data) {
    try { if (ws && typeof ws.send === 'function') { ws.send(data); return true; } } catch {}
    return false;
  };

  var cleanup = function (outcome, closeInfo) {
    if (clientClosed) return;
    clientClosed = true;
    pending.length = 0;
    try { if (upstream && typeof upstream.terminate === 'function') upstream.terminate(); } catch {}
    try { if (upstream && typeof upstream.close === 'function') upstream.close(); } catch {}
    upstream = null;
    finalize(outcome, closeInfo);
  };

  return {
    async onopen(ws, request) {
      try {
        client = ws;
        step('onopen_enter', { url: originalRequest.url });

        // 1. Resolve WebSocket constructor
        var wsInfo;
        try {
          wsInfo = await resolveWebSocketCtor();
        } catch (ctorErr) {
          step('ctor_error', stringifyErr(ctorErr));
          safeClose(ws, 1011, 'WS ctor error');
          cleanup('error', { code: 1011, reason: 'ctor_error' });
          return;
        }

        if (!wsInfo) {
          step('ctor_unavailable');
          safeClose(ws, 1011, 'No WebSocket available');
          cleanup('error', { code: 1011, reason: 'ctor_unavailable' });
          return;
        }

        ctorSource = wsInfo.source;
        var Ctor = wsInfo.ctor;
        OPEN_STATE = typeof Ctor.OPEN === 'number' ? Ctor.OPEN : 1;
        var isWsLib = typeof Ctor.prototype !== 'undefined' && typeof Ctor.prototype.on === 'function';
        step('ctor_resolved', { source: ctorSource, isWsLib: isWsLib });

        // 2. Extract forwarded client headers from URL params
        var reqUrl = new URL(originalRequest.url);
        var clientOrigin = reqUrl.searchParams.get('_h_origin')
          || (request && request.headers && request.headers.get && request.headers.get('origin'))
          || undefined;
        var clientProtocol = reqUrl.searchParams.get('_h_protocol')
          || (request && request.headers && request.headers.get && request.headers.get('sec-websocket-protocol'))
          || undefined;

        step('client_headers', { origin: clientOrigin || null, protocol: clientProtocol || null });

        // 3. Create upstream WebSocket
        var options = { perMessageDeflate: false };
        if (clientOrigin && isWsLib) {
          options.origin = clientOrigin;
        }

        step('upstream_creating', { url: upstreamUrl, origin: options.origin || null });

        try {
          upstream = clientProtocol
            ? new Ctor(upstreamUrl, clientProtocol, options)
            : new Ctor(upstreamUrl, options);
        } catch (newErr) {
          step('upstream_new_failed', stringifyErr(newErr));
          safeClose(ws, 1011, 'Upstream create failed');
          cleanup('error', { code: 1011, reason: 'upstream_new_failed', error: stringifyErr(newErr) });
          return;
        }

        step('upstream_created', { readyState: upstream ? upstream.readyState : null });

        // 4. Connect timeout
        var timeoutFired = false;
        var connectTimer = setTimeout(function () {
          if (upstream && upstream.readyState !== OPEN_STATE) {
            timeoutFired = true;
            step('connect_timeout', { readyState: upstream.readyState });
            try { upstream.terminate(); } catch {}
          }
        }, CONNECT_TIMEOUT_MS);

        var clearTimeoutOnce = function () { clearTimeout(connectTimer); };

        // 5. Upstream event handlers
        var flushPending = function () {
          while (pending.length > 0) {
            var item = pending.shift();
            try { upstream.send(item.data); } catch { break; }
          }
        };

        if (isWsLib) {
          upstream.on('open', function () {
            clearTimeoutOnce();
            step('upstream_open');
            flushPending();
          });
          upstream.on('message', function (data) {
            if (!safeSend(client, data)) {
              try { upstream.close(); } catch {}
            }
          });
          upstream.on('close', function (code, reason) {
            clearTimeoutOnce();
            var r = reason && typeof reason.toString === 'function' ? reason.toString() : '';
            step('upstream_close', { code: code, reason: r });
            safeClose(client, sanitizeCode(code || 1000), r);
            cleanup('upstream_closed', { code: sanitizeCode(code || 1000), reason: r, timeout: timeoutFired });
          });
          upstream.on('error', function (err) {
            clearTimeoutOnce();
            step('upstream_error', stringifyErr(err));
            safeClose(client, 1011, 'Upstream error');
            cleanup('upstream_error', { code: 1011, error: stringifyErr(err), timeout: timeoutFired });
          });
        } else {
          upstream.addEventListener('open', function () {
            clearTimeoutOnce();
            step('upstream_open');
            flushPending();
          });
          upstream.addEventListener('message', function (ev) {
            if (!safeSend(client, ev && ev.data)) {
              try { upstream.close(); } catch {}
            }
          });
          upstream.addEventListener('close', function (ev) {
            clearTimeoutOnce();
            step('upstream_close', { code: ev && ev.code, reason: ev && ev.reason });
            safeClose(client, sanitizeCode(ev && ev.code || 1000), ev && ev.reason || '');
            cleanup('upstream_closed', { code: sanitizeCode(ev && ev.code || 1000), reason: ev && ev.reason || '', timeout: timeoutFired });
          });
          upstream.addEventListener('error', function (ev) {
            clearTimeoutOnce();
            step('upstream_error', { error: ev && ev.error ? stringifyErr(ev.error) : 'unknown' });
            safeClose(client, 1011, 'Upstream error');
            cleanup('upstream_error', { code: 1011, timeout: timeoutFired });
          });
        }

        step('handlers_registered');
      } catch (onopenErr) {
        step('onopen_unhandled', stringifyErr(onopenErr));
        safeClose(ws, 1011, 'Proxy error');
        cleanup('error', { code: 1011, reason: 'onopen_unhandled', error: stringifyErr(onopenErr) });
      }
    },

    async onmessage(ws, message, isBinary) {
      msgSeq++;
      var payload = message;
      if (!isBinary && typeof payload !== 'string') {
        payload = payload && typeof payload.toString === 'function' ? payload.toString() : String(payload);
      }
      if (!upstream || upstream.readyState !== OPEN_STATE) {
        if (pending.length >= MAX_PENDING) {
          safeClose(ws, 1013, 'Upstream not ready');
          cleanup('error', { code: 1013, reason: 'Pending overflow' });
          return;
        }
        pending.push({ data: payload, isBinary: isBinary });
        return;
      }
      try { upstream.send(payload); } catch {}
    },

    async onclose(ws, code, reason) {
      var r = reason && typeof reason.toString === 'function' ? reason.toString() : '';
      step('client_close', { code: code, reason: r });
      try { if (upstream && typeof upstream.close === 'function') upstream.close(sanitizeCode(code), r); } catch {}
      cleanup('client_closed', { code: sanitizeCode(code), reason: r });
    },

    async onerror(err) {
      step('client_error', stringifyErr(err));
      try { if (upstream && typeof upstream.close === 'function') upstream.close(1011, 'Client error'); } catch {}
      cleanup('error', { code: 1011, reason: 'Client error', error: stringifyErr(err) });
    },
  };
}

export { onRequest };
export default onRequest;
