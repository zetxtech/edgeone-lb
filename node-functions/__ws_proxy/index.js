/**
 * Node Functions WebSocket proxy handler.
 *
 * The platform routes WebSocket upgrades directly to this Node Function
 * (middleware rewrite does NOT preserve the Upgrade header).
 *
 * The Node Function looks up the upstream target from KV (lb_kv) based
 * on the request hostname, then opens an upstream WebSocket and proxies
 * frames bidirectionally.
 *
 * Query params (optional, used for path/proxy hints):
 * - path:  original pathname to forward to the upstream (default: "/")
 * - search: original search string (including leading '?')
 * - _debug: "1" to enable debug-log persistence to KV
 */

const DEBUG_HEADER = 'EdgeoneLBDebugger';
const DEBUG_LOG_KEY_PREFIX = 'ws-debug:';
const DEBUG_LOG_RETENTION_SECONDS = 60 * 60 * 24 * 7;
const PROXY_VERSION = 'ws-proxy-v5';

// ── Debug-log helpers ──────────────────────────────────────────────────────

function shouldExposeDebugInfo(request) {
  const ua = request.headers.get('user-agent') || '';
  return request.headers.has(DEBUG_HEADER) || ua.includes(DEBUG_HEADER);
}

function createDebugLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serializeLogValue(value, depth = 0) {
  if (value == null) return value;
  if (depth >= 5) return '[MaxDepth]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, cause: value.cause ? serializeLogValue(value.cause, depth + 1) : null };
  }
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) return value.map((i) => serializeLogValue(i, depth + 1));
  if (typeof value === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(value)) r[k] = serializeLogValue(v, depth + 1);
    return r;
  }
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  return value;
}

function serializeHeadersForLog(headers) {
  const result = {};
  if (!headers) return result;
  const redacted = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);
  for (const [key, value] of headers.entries()) {
    result[key] = redacted.has(key.toLowerCase()) ? '[Redacted]' : String(value).slice(0, 512);
  }
  return result;
}

function pushLog(logs, phase, message, detail) {
  const entry = { time: new Date().toISOString(), phase, message };
  if (detail !== undefined) entry.detail = serializeLogValue(detail);
  logs.push(entry);
}

async function persistDebugLog(record) {
  try {
    if (typeof lb_kv === 'undefined') return;
    const key = `${DEBUG_LOG_KEY_PREFIX}${record.id}`;
    await lb_kv.put(key, JSON.stringify(record), { expirationTtl: DEBUG_LOG_RETENTION_SECONDS });
  } catch {}
}

function stringifyError(err) {
  try {
    if (!err) return null;
    return { name: err.name, message: err.message, stack: err.stack };
  } catch {
    return { message: String(err) };
  }
}

// ── WebSocket constructor resolution ───────────────────────────────────────

async function resolveWebSocketCtor() {
  // Prefer 'ws' library — it supports custom headers (Origin, etc.)
  // which are critical for upstream servers that validate Origin.
  try {
    const mod = await import('ws');
    const ctor = mod?.default || mod?.WebSocket || mod;
    if (ctor) return ctor;
  } catch {}
  // Fallback to global WebSocket (may not support custom headers)
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  return null;
}

// ── URL / header helpers ───────────────────────────────────────────────────

function buildUpstreamWsUrl(targetHost, originalUrl, originalPath, originalSearch, originalProto) {
  const base = new URL(originalUrl);
  const parts = String(targetHost).split(':');
  base.hostname = parts[0];
  if (parts[1]) base.port = parts[1];
  else base.port = '';

  const proto = String(originalProto || '').toLowerCase();
  if (proto === 'https' || proto === 'wss') base.protocol = 'wss:';
  else if (proto === 'http' || proto === 'ws') base.protocol = 'ws:';
  else base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

  base.pathname = originalPath || '/';
  if (originalSearch) {
    base.search = originalSearch.startsWith('?') ? originalSearch : `?${originalSearch}`;
  } else {
    base.search = '';
  }
  return base.toString();
}

function sanitizeUpstreamWebSocketHeaders(headers) {
  const sanitized = new Headers(headers || undefined);
  const drop = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
    'cdn-loop', 'eo-pages-dataset', 'eo-pages-language', 'x-nws-log-uuid',
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
    'content-length', 'host', 'origin',
    'sec-websocket-extensions', 'sec-websocket-key', 'sec-websocket-protocol', 'sec-websocket-version',
  ];
  for (const h of drop) sanitized.delete(h);
  return sanitized;
}

// ── KV / candidate helpers ─────────────────────────────────────────────────

const METRICS_CACHE_NAME = 'cache-host-metrics';
const UNKNOWN_LATENCY = 999;

async function readHealthMetrics(cache, host) {
  try {
    const key = new Request(`https://${host}/_metric`);
    const resp = await cache.match(key);
    if (resp) return await resp.json();
  } catch {}
  return { status: 'unknown', latency: UNKNOWN_LATENCY, lastChecked: 0 };
}

async function getSortedCandidates(targets, cache) {
  const results = await Promise.all(targets.map(async (target) => {
    const data = await readHealthMetrics(cache, target.host);
    return { target, ...data };
  }));
  return results.sort((a, b) => {
    const score = (s) => (s === 'healthy' ? 0 : s === 'unknown' ? 1 : 2);
    if (score(a.status) !== score(b.status)) return score(a.status) - score(b.status);
    return a.latency - b.latency;
  });
}

async function resolveTargetFromKV(hostname, addLog) {
  if (typeof lb_kv === 'undefined') {
    if (addLog) addLog('kv_missing');
    return null;
  }
  const rules = await lb_kv.get('rules', { type: 'json' }) || {};
  const rule = rules[hostname];
  if (!rule) {
    if (addLog) addLog('rule_missing', { hostname, available: Object.keys(rules) });
    return null;
  }
  const targets = Array.isArray(rule.targets) ? rule.targets : [];
  if (targets.length === 0) {
    if (addLog) addLog('no_targets', { hostname });
    return null;
  }
  try {
    const cache = await caches.open(METRICS_CACHE_NAME);
    const candidates = await getSortedCandidates(targets, cache);
    return candidates[0]?.target || targets[0];
  } catch {
    return targets[0];
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function onRequest(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('upgrade');
    const diag = url.searchParams.get('diag') === '1';

    // Diagnostic mode: always return HTTP (even for WebSocket) so the
    // browser can display the result.  Access with ?diag=1.
    if (diag) {
      const wsCtor = await resolveWebSocketCtor();
      return new Response(JSON.stringify({
        ok: true, version: PROXY_VERSION,
        upgrade: upgradeHeader || null,
        ws: {
          available: !!wsCtor,
          name: wsCtor?.name || null,
          isWsLibrary: typeof wsCtor?.prototype?.on === 'function',
          ctorType: wsCtor ? (typeof wsCtor) : null,
        },
        globalWs: typeof globalThis.WebSocket,
        lb_kv: typeof lb_kv,
        params: {
          target: url.searchParams.get('target'),
          path: url.searchParams.get('path'),
          proto: url.searchParams.get('proto'),
        },
      }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket. Add ?diag=1 for diagnostics.', {
        status: 426, headers: { 'Content-Type': 'text/plain', 'Upgrade': 'websocket' },
      });
    }

    const hostname = url.hostname;
    const debug = url.searchParams.get('_debug') === '1';
    const logs = [];
    const addLog = debug ? (msg, detail) => pushLog(logs, 'init', msg, detail) : () => {};

    // ── Resolve target: explicit param or KV lookup ────────────────────
    let targetHost = (url.searchParams.get('target') || '').trim();
    let originalPath = (url.searchParams.get('path') || '').trim();
    let originalSearch = (url.searchParams.get('search') || '').trim();
    let originalProto = (url.searchParams.get('proto') || '').trim();

    if (!targetHost) {
      addLog('kv_lookup_start', { hostname });
      const target = await resolveTargetFromKV(hostname, addLog);
      if (!target) {
        addLog('kv_lookup_failed');
        return new Response(JSON.stringify({ error: 'No backend available for ' + hostname, version: PROXY_VERSION }), {
          status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      targetHost = target.host;
      addLog('kv_lookup_done', { targetHost });
    }

    if (!originalPath) {
      originalPath = url.pathname === '/__ws_proxy' ? '/' : (url.pathname.replace(/^\/__ws_proxy/, '') || '/');
    }

    if (!originalProto) {
      originalProto = request.headers.get('x-forwarded-proto')
        || request.headers.get('X-Forwarded-Proto')
        || 'https';
    }

    addLog('building_upstream', { targetHost, originalPath, originalSearch, originalProto });

    const upstreamUrl = buildUpstreamWsUrl(targetHost, request.url, originalPath, originalSearch, originalProto);
    addLog('upstream_built', { upstreamUrl });

    if (debug && logs.length > 0) {
      // Persist init-phase logs immediately so we can see them even if onopen fails
      const initRecord = {
        id: createDebugLogId(),
        kind: 'websocket-init',
        createdAt: new Date().toISOString(),
        request: { url: request.url, headers: serializeHeadersForLog(request.headers) },
        proxy: { upstreamUrl, targetHost },
        logs: serializeLogValue(logs),
      };
      persistDebugLog(initRecord);
    }

    return { websocket: createProxyHandler(upstreamUrl, targetHost, request, debug) };
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal Error', version: PROXY_VERSION, detail: stringifyError(err) }, null, 2), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

// ── Proxy handler factory ──────────────────────────────────────────────────

function createProxyHandler(upstreamUrl, targetHost, originalRequest, debug) {
  let upstream = null;
  let client = null;
  let clientClosed = false;
  const pending = [];
  const MAX_PENDING = 256;

  let upstreamCtor = null;
  let OPEN_STATE = 1;
  let isWsLibrary = false;

  // ── Debug-log state ──────────────────────────────────────────────────
  const logs = [];
  let phase = 'init';
  let msgSeq = 0;
  const startedAt = Date.now();

  const setPhase = (next, message, detail) => {
    phase = next;
    if (debug) pushLog(logs, phase, message, detail);
  };

  const addLog = debug
    ? (message, detail) => { pushLog(logs, phase, message, detail); }
    : () => {};

  const finalizeDebugLog = (outcome, closeInfo) => {
    if (!debug) return;
    const record = {
      id: createDebugLogId(),
      kind: 'websocket',
      createdAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      phase,
      outcome,
      request: {
        url: originalRequest.url,
        method: originalRequest.method,
        headers: serializeHeadersForLog(originalRequest.headers),
      },
      proxy: { upstreamUrl, targetHost },
      close: closeInfo || null,
      messages: msgSeq,
      logs: serializeLogValue(logs),
    };
    persistDebugLog(record);
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  const safeClose = (ws, code, reason) => {
    try { ws?.close?.(code, reason); } catch {}
  };

  const sanitizeCloseCode = (code) => {
    if (typeof code !== 'number' || !Number.isFinite(code)) return 1000;
    if (code === 1005 || code === 1006 || code === 1015) return 1000;
    if (code < 1000 || code > 4999) return 1000;
    return code;
  };

  const safeSend = (ws, data) => {
    try { ws?.send?.(data); return true; } catch { return false; }
  };

  const cleanup = (outcome, closeInfo) => {
    if (clientClosed) return;
    clientClosed = true;
    pending.length = 0;
    try { upstream?.terminate?.(); } catch {}
    try { upstream?.close?.(); } catch {}
    upstream = null;
    finalizeDebugLog(outcome || 'closed', closeInfo);
  };

  // ── Handler object ───────────────────────────────────────────────────

  return {
    async onopen(ws, request) {
      try {
        client = ws;
        setPhase('onopen', 'client_ws_opened', { url: originalRequest.url });
        console.log('[ws-proxy] onopen entered, upstreamUrl=', upstreamUrl);

        // Diagnostic: fire-and-forget KV write (do NOT await — may hang in WS context)
        if (typeof lb_kv !== 'undefined') {
          lb_kv.put('ws_diag_onopen_ran', JSON.stringify({
            time: new Date().toISOString(),
            upstreamUrl,
            targetHost,
          }), { expirationTtl: 300 }).catch(() => {});
        }

        // Resolve WebSocket constructor
        try {
          upstreamCtor = await resolveWebSocketCtor();
        } catch (ctorErr) {
          addLog('ws_ctor_error', stringifyError(ctorErr));
          safeClose(ws, 1011, 'WS ctor error');
          cleanup('error', { code: 1011, reason: 'WS ctor error' });
          return;
        }
        OPEN_STATE = typeof upstreamCtor?.OPEN === 'number' ? upstreamCtor.OPEN : 1;
        isWsLibrary = typeof upstreamCtor?.prototype?.on === 'function';
        addLog('ws_ctor_resolved', { available: !!upstreamCtor, isWsLibrary, ctorName: upstreamCtor?.name || null });

        console.log('[ws-proxy] ws_ctor resolved:', !!upstreamCtor, 'isWsLibrary:', isWsLibrary);

        if (!upstreamCtor) {
          addLog('ws_ctor_unavailable');
          console.log('[ws-proxy] ABORT: ws_ctor unavailable');
          safeClose(ws, 1011, 'Upstream WebSocket unavailable');
          cleanup('error', { code: 1011, reason: 'WS ctor unavailable' });
          return;
        }

// Extract client headers — prefer URL params (_h_origin, _h_protocol,
        // _h_ua) because the platform's rewrite strips the original request
        // headers.  Fall back to request.headers for direct access scenarios.
        const reqUrl = new URL(originalRequest.url);
        const clientOrigin = reqUrl.searchParams.get('_h_origin')
          || request?.headers?.get?.('origin')
          || request?.headers?.get?.('Origin')
          || undefined;
        const clientProtocol = reqUrl.searchParams.get('_h_protocol')
          || request?.headers?.get?.('sec-websocket-protocol')
          || undefined;
        const clientUA = reqUrl.searchParams.get('_h_ua')
          || request?.headers?.get?.('user-agent')
          || undefined;
        console.log('[ws-proxy] client origin:', clientOrigin, 'protocol:', clientProtocol);

        addLog('client_headers', {
          origin: clientOrigin || null,
          protocol: clientProtocol || null,
          ua: clientUA ? 'present' : null,
          source: reqUrl.searchParams.has('_h_origin') ? 'url_params' : 'request_headers',
        });

        // Create upstream WebSocket
        try {
          setPhase('upstream_connect', 'upstream_creating', { upstreamUrl, isWsLibrary });
          if (isWsLibrary) {
            const options = { handshakeTimeout: 10000, perMessageDeflate: false };
            const headers = {};
            if (clientOrigin) {
              options.origin = clientOrigin;
              headers['Origin'] = clientOrigin;
            }
            if (clientUA) {
              headers['User-Agent'] = clientUA;
            }
            if (Object.keys(headers).length > 0) {
              options.headers = headers;
            }
            addLog('upstream_ws_options', { origin: options.origin || null, headerKeys: Object.keys(options.headers || {}) });
            console.log('[ws-proxy] creating upstream ws:', upstreamUrl, 'origin:', options.origin);
            upstream = clientProtocol
              ? new upstreamCtor(upstreamUrl, clientProtocol, options)
              : new upstreamCtor(upstreamUrl, options);
          } else {
            upstream = clientProtocol
              ? new upstreamCtor(upstreamUrl, clientProtocol)
              : new upstreamCtor(upstreamUrl);
          }
          console.log('[ws-proxy] upstream ws created, readyState:', upstream?.readyState);
          addLog('upstream_ws_created', { readyState: upstream?.readyState });
          // Delayed readyState check
          setTimeout(() => {
            console.log('[ws-proxy] upstream ws after 1s, readyState:', upstream?.readyState);
          }, 1000);
          setTimeout(() => {
            console.log('[ws-proxy] upstream ws after 5s, readyState:', upstream?.readyState);
          }, 5000);
        } catch (connErr) {
          console.log('[ws-proxy] upstream ws create FAILED:', connErr?.message || connErr);
          addLog('upstream_ws_create_failed', stringifyError(connErr));
          safeClose(ws, 1011, 'Upstream connect failed');
          cleanup('error', { code: 1011, reason: 'Upstream create failed', error: stringifyError(connErr) });
          return;
        }

        // Wire upstream events
        const flushPending = () => {
          while (pending.length > 0) {
            const item = pending.shift();
            try { upstream.send(item.data); } catch { break; }
          }
        };

        const onUpstreamMessage = (data) => {
          if (!safeSend(client, data)) {
            try { upstream.close(); } catch {}
          }
        };

        const onUpstreamClose = (code, reason) => {
          const safeCode = sanitizeCloseCode(code || 1000);
          const reasonStr = reason?.toString?.() || '';
          addLog('upstream_ws_closed', { code, safeCode, reason: reasonStr });
          safeClose(client, safeCode, reasonStr);
          cleanup('upstream_closed', { code: safeCode, reason: reasonStr, source: 'upstream' });
        };

        const onUpstreamError = (err) => {
          addLog('upstream_ws_error', stringifyError(err));
          safeClose(client, 1011, 'Upstream error');
          cleanup('error', { code: 1011, reason: 'Upstream error', error: stringifyError(err) });
        };

        if (isWsLibrary) {
          upstream.on('open', () => {
            console.log('[ws-proxy] upstream WS open!');
            setPhase('proxying', 'upstream_ws_open');
            flushPending();
          });
          upstream.on('message', onUpstreamMessage);
          upstream.on('close', (code, reason) => {
            console.log('[ws-proxy] upstream WS close:', code, reason?.toString?.());
            onUpstreamClose(code, reason);
          });
          upstream.on('error', (err) => {
            console.log('[ws-proxy] upstream WS error:', err?.message || err);
            onUpstreamError(err);
          });
          upstream.on('unexpected-response', (_req, res) => {
            console.log('[ws-proxy] upstream unexpected-response:', res?.statusCode, res?.statusMessage);
            addLog('unexpected_response', { statusCode: res?.statusCode, statusMessage: res?.statusMessage });
          });
          // Diagnostic: inspect underlying socket state
          try {
            const sock = upstream?._req?.socket || upstream?._socket;
            if (sock) {
              console.log('[ws-proxy] underlying socket:', sock.remoteAddress, sock.remotePort, 'connecting:', sock.connecting, 'pending:', sock.pending);
              sock.on('connect', () => console.log('[ws-proxy] socket CONNECT event'));
              sock.on('error', (e) => console.log('[ws-proxy] socket ERROR:', e?.message));
              sock.on('close', () => console.log('[ws-proxy] socket CLOSE event'));
              sock.on('timeout', () => console.log('[ws-proxy] socket TIMEOUT event'));
            } else {
              console.log('[ws-proxy] no underlying socket found on ws instance');
            }
          } catch (sockErr) {
            console.log('[ws-proxy] socket inspect error:', sockErr?.message);
          }
          // Manual timeout fallback (handshakeTimeout may not work in all envs)
          const connectTimeout = setTimeout(() => {
            if (upstream && upstream.readyState !== OPEN_STATE) {
              console.log('[ws-proxy] MANUAL TIMEOUT: upstream still not open after 15s, terminating');
              addLog('upstream_connect_timeout', { readyState: upstream?.readyState });
              try { upstream.terminate(); } catch {}
            }
          }, 15000);
          upstream.once('open', () => clearTimeout(connectTimeout));
          upstream.once('close', () => clearTimeout(connectTimeout));
          upstream.once('error', () => clearTimeout(connectTimeout));
        } else {
          upstream.addEventListener('open', () => {
            console.log('[ws-proxy] upstream WS open!');
            setPhase('proxying', 'upstream_ws_open');
            flushPending();
          });
          upstream.addEventListener('message', (ev) => { onUpstreamMessage(ev?.data); });
          upstream.addEventListener('close', (ev) => {
            console.log('[ws-proxy] upstream WS close:', ev?.code, ev?.reason);
            onUpstreamClose(ev?.code, ev?.reason);
          });
          upstream.addEventListener('error', (ev) => {
            console.log('[ws-proxy] upstream WS error:', ev?.error || ev);
            onUpstreamError(ev?.error || ev);
          });
        }
        console.log('[ws-proxy] upstream handlers registered');
        addLog('upstream_handlers_registered');
      } catch (onopenErr) {
        console.log('[ws-proxy] onopen UNHANDLED ERROR:', onopenErr?.message || onopenErr, onopenErr?.stack);
        addLog('onopen_unhandled_error', stringifyError(onopenErr));
        safeClose(ws, 1011, 'Proxy internal error');
        cleanup('error', { code: 1011, reason: 'onopen unhandled', error: stringifyError(onopenErr) });
      }
    },

    async onmessage(ws, message, isBinary) {
      msgSeq++;
      const len = message?.length ?? message?.byteLength ?? 0;
      if (msgSeq <= 5 || msgSeq % 100 === 0) {
        addLog('client_msg', { seq: msgSeq, len, isBinary });
      }
      let payload = message;
      if (!isBinary && typeof payload !== 'string') {
        payload = payload?.toString?.() ?? String(payload);
      }

      if (!upstream || upstream.readyState !== OPEN_STATE) {
        if (pending.length >= MAX_PENDING) {
          addLog('pending_overflow', { pending: pending.length });
          safeClose(ws, 1013, 'Upstream not ready');
          cleanup('error', { code: 1013, reason: 'Pending overflow' });
          return;
        }
        pending.push({ data: payload, isBinary });
        return;
      }

      try { upstream.send(payload); } catch {}
    },

    async onclose(ws, code, reason) {
      const reasonStr = reason?.toString?.() || '';
      addLog('client_ws_closed', { code, reason: reasonStr });
      try { upstream?.close?.(sanitizeCloseCode(code), reasonStr); } catch {}
      cleanup('client_closed', { code: sanitizeCloseCode(code), reason: reasonStr, source: 'client' });
    },

    async onerror(err) {
      addLog('client_ws_error', stringifyError(err));
      try { upstream?.close?.(1011, 'Client error'); } catch {}
      cleanup('error', { code: 1011, reason: 'Client error', error: stringifyError(err) });
    },
  };
}

export { onRequest };
export default onRequest;
