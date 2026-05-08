const ADMIN_HOSTNAMES = [
  'elb.zetx.tech',
];
const INTERNAL_HTTP_PROXY_PREFIX = '/__proxy';
const DEBUG_HEADER = 'EdgeoneLBDebugger';
const GENERIC_ERROR_RESPONSE_BODY = {
  error: 'Internal server error',
};
const DEBUG_LOG_INDEX_KEY = 'debug-log:index';
const DEBUG_LOG_KEY_PREFIX = 'debug-log:';
const DEBUG_LOG_RETENTION_SECONDS = 60 * 60 * 24 * 7;
const DEBUG_LOG_MAX_RECORDS = 50;
const DEBUG_LOG_HEADER_VALUE_LIMIT = 2048;
const DEBUG_LOG_REDACTED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);
const METRICS_CACHE_NAME = 'cache-host-metrics';
const HEALTH_METRIC_TTL_SECONDS = 600;
const UNKNOWN_LATENCY = 999;
const REQUEST_TIMEOUT = 10000;
const FAST_FAIL_TIMEOUT = 3000;
const HEALTH_CHECK_TIMEOUT = 5000;
const HEALTH_CHECK_INTERVAL = 600000;
export function isAdminHostname(hostname) {
  return ADMIN_HOSTNAMES.includes(hostname)
    || hostname.endsWith('.edgeone.run')
    || hostname.endsWith('.edgeone.site');
}
function getOriginalProxyPath(pathname) {
  if (pathname === INTERNAL_HTTP_PROXY_PREFIX) {
    return '/';
  }
  if (pathname.startsWith(`${INTERNAL_HTTP_PROXY_PREFIX}/`)) {
    return pathname.slice(INTERNAL_HTTP_PROXY_PREFIX.length);
  }
  return pathname;
}
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
  const userAgent = request.headers.get('user-agent') || '';
  return request.headers.has(DEBUG_HEADER) || userAgent.includes(DEBUG_HEADER);
}
function createDebugLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function truncateLogText(value, maxLength = DEBUG_LOG_HEADER_VALUE_LIMIT) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…[truncated]`;
}
function serializeHeadersForLog(headers) {
  const result = {};
  if (!headers) {
    return result;
  }
  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();
    result[key] = DEBUG_LOG_REDACTED_HEADERS.has(lowerKey)
      ? '[Redacted]'
      : truncateLogText(value);
  }
  return result;
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
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const responsePayload = { ...payload };
  if (logs.length > 0) {
    responsePayload.logs = logs;
  }
  return new Response(JSON.stringify(responsePayload, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function classifyResponseStatus(status) {
  if (!Number.isInteger(status)) return 'unknown';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  if (status >= 300) return 'redirect';
  if (status >= 200) return 'success';
  return 'unknown';
}
function queueBackgroundTask(waitUntil, task) {
  const wrappedTask = Promise.resolve(task).catch(() => {});
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(wrappedTask);
      return;
    } catch {}
  }
  wrappedTask.catch(() => {});
}
async function persistDebugLogRecord(record) {
  if (typeof lb_kv === 'undefined') {
    return;
  }
  const normalizedRecord = {
    ...record,
    id: record.id || createDebugLogId(),
  };
  const storageKey = `${DEBUG_LOG_KEY_PREFIX}${normalizedRecord.id}`;
  const indexEntry = {
    id: normalizedRecord.id,
    createdAt: normalizedRecord.createdAt,
    completedAt: normalizedRecord.completedAt,
    phase: normalizedRecord.phase,
    outcome: normalizedRecord.outcome,
    request: {
      method: normalizedRecord.request?.method || null,
      url: normalizedRecord.request?.url || null,
      hostname: normalizedRecord.request?.hostname || null,
      pathname: normalizedRecord.request?.pathname || null,
    },
    response: {
      status: normalizedRecord.response?.status ?? null,
      statusText: normalizedRecord.response?.statusText || '',
    },
    logCount: Array.isArray(normalizedRecord.logs) ? normalizedRecord.logs.length : 0,
  };
  await lb_kv.put(storageKey, JSON.stringify(normalizedRecord), {
    expirationTtl: DEBUG_LOG_RETENTION_SECONDS,
  });
  const currentIndex = await lb_kv.get(DEBUG_LOG_INDEX_KEY, { type: 'json' }) || [];
  const nextIndex = [
    indexEntry,
    ...currentIndex.filter((entry) => entry?.id !== normalizedRecord.id),
  ].slice(0, DEBUG_LOG_MAX_RECORDS);
  await lb_kv.put(DEBUG_LOG_INDEX_KEY, JSON.stringify(nextIndex), {
    expirationTtl: DEBUG_LOG_RETENTION_SECONDS,
  });
}
async function judgeAndMaybeTransformResponse({ resp, target, originalUrl }) {
  const status = resp.status;
  const statusText = resp.statusText;
  const targetInfo = { host: target.host, type: target.type };
  if (target.type === 'tunnel' && (status === 530 || status === 502)) {
    return { ok: false, reason: `Tunnel returned ${status}`, status, statusText, target: targetInfo };
  }
  if (target.type === 'frp' && (status === 525 || status === 530)) {
    return { ok: false, reason: 'FRP returned 525 (SSL Handshake Failed)', status, statusText, target: targetInfo };
  }
  if (target.type === 'frp' && status === 404) {
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
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const buffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
        }
        const text = new TextDecoder().decode(buffer);
        if (text.includes('Faithfully yours, frp.')) {
          signatureFound = true;
          break;
        }
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {}
      return {
        ok: false,
        reason: 'Stream read error',
        status,
        statusText,
        target: targetInfo,
        error: error.message,
      };
    }
    if (signatureFound) {
      try {
        await reader.cancel();
      } catch {}
      return { ok: false, reason: 'FRP 404 signature matched', status, statusText, target: targetInfo };
    }
    if (chunks.length === 0) {
      try {
        await reader.cancel();
      } catch {}
      return { ok: true, response: handleRedirect(resp, originalUrl) };
    }
    const replay = new ReadableStream({
      async start(controller) {
        try {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          if (!streamEnded) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
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
function handleRedirect(response, originalUrl) {
  const status = response.status;
  if (status >= 300 && status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      let redirectUrl;
      try {
        redirectUrl = new URL(location);
        redirectUrl.hostname = originalUrl.hostname;
        if (originalUrl.port) {
          redirectUrl.port = originalUrl.port;
        }
        redirectUrl.protocol = originalUrl.protocol;
      } catch {
        redirectUrl = new URL(location, originalUrl.origin);
      }
      const headers = new Headers(response.headers);
      headers.set('Location', redirectUrl.toString());
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
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
  const platformHeaders = [
    'cdn-loop',
    'x-nws-log-uuid',
  ];
  for (const header of hopByHopHeaders) {
    sanitized.delete(header);
  }
  for (const header of platformHeaders) {
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
function getChunkByteLength(chunk) {
  if (chunk == null) {
    return 0;
  }
  if (typeof chunk.byteLength === 'number') {
    return chunk.byteLength;
  }
  if (typeof chunk.length === 'number') {
    return chunk.length;
  }
  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk).byteLength;
  }
  return null;
}
function shouldDisableResponseTransform(contentType) {
  if (!contentType) {
    return false;
  }

  const normalizedContentType = contentType.toLowerCase();
  return normalizedContentType.includes('text/event-stream')
    || normalizedContentType.includes('application/grpc')
    || normalizedContentType.includes('application/grpc-web')
    || normalizedContentType.includes('application/x-ndjson')
    || normalizedContentType.includes('application/stream+json');
}
function createStreamingProxyResponse(response, injectedHeaders = {}, options = {}) {
  const headers = sanitizeProxyResponseHeaders(response.headers);
  const contentType = response.headers.get('content-type') || null;

  if (shouldDisableResponseTransform(contentType)) {
    headers.set('Cache-Control', 'no-cache, no-transform');
  }

  for (const [key, value] of Object.entries(injectedHeaders)) {
    if (value != null) {
      headers.set(key, value);
    }
  }
  let body = null;
  if (response.body) {
    let settled = false;
    let firstUpstreamChunkObserved = false;
    let firstDownstreamChunkObserved = false;
    const streamStartedAt = Date.now();
    const settle = (type, detail = undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof options.onComplete === 'function') {
        try {
          options.onComplete({ type, detail: serializeLogValue(detail) });
        } catch {}
      }
    };
    const transformer = new TransformStream({
      transform(chunk, controller) {
        const chunkBytes = getChunkByteLength(chunk);
        if (!firstUpstreamChunkObserved && typeof options.onFirstUpstreamChunk === 'function') {
          firstUpstreamChunkObserved = true;
          try {
            options.onFirstUpstreamChunk({
              chunkBytes,
              contentType,
              elapsedMs: Date.now() - streamStartedAt,
            });
          } catch {}
        }
        controller.enqueue(chunk);
        if (!firstDownstreamChunkObserved && typeof options.onFirstDownstreamChunk === 'function') {
          firstDownstreamChunkObserved = true;
          try {
            options.onFirstDownstreamChunk({
              chunkBytes,
              contentType,
              elapsedMs: Date.now() - streamStartedAt,
            });
          } catch {}
        }
      },
    });
    body = transformer.readable;
    response.body.pipeTo(transformer.writable).then(() => {
      settle('completed');
    }).catch((error) => {
      if (error?.name === 'AbortError') {
        settle('canceled', error);
        return;
      }
      settle('errored', error);
    });
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
async function updateMetrics(cache, host, status, latency, reason = null) {
  const key = new Request(`https://${host}/_metric`);
  const data = {
    status,
    latency,
    reason,
    lastChecked: Date.now(),
  };
  await cache.put(key, new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${HEALTH_METRIC_TTL_SECONDS}`,
    },
  }));
  try {
    if (typeof lb_kv !== 'undefined') {
      await lb_kv.put(`health:${host}`, JSON.stringify(data), {
        expirationTtl: HEALTH_METRIC_TTL_SECONDS,
      });
    }
  } catch (error) {
    console.error('Failed to write health metrics to KV:', error);
  }
}
async function readHealthMetrics(cache, host, options = {}) {
  const {
    defaultValue = { status: 'unknown', latency: UNKNOWN_LATENCY, lastChecked: 0 },
    addLog = null,
    logPrefix = 'health_metrics',
  } = options;
  const key = new Request(`https://${host}/_metric`);
  let data = { ...defaultValue };
  try {
    if (addLog) {
      addLog(`${logPrefix}_cache_lookup_start`, {
        target: host,
        cacheKey: key.url,
      });
    }
    const response = await cache.match(key);
    if (addLog) {
      addLog(`${logPrefix}_cache_lookup_done`, {
        target: host,
        cacheKey: key.url,
        hit: !!response,
      });
    }
    if (response) {
      try {
        data = await response.json();
      } catch {}
      return data;
    }
    try {
      if (addLog) {
        addLog(`${logPrefix}_kv_lookup_start`, {
          target: host,
          kvKey: `health:${host}`,
        });
      }
      if (typeof lb_kv !== 'undefined') {
        const kvData = await lb_kv.get(`health:${host}`, { type: 'json' });
        if (kvData) {
          data = kvData;
          try {
            await cache.put(key, new Response(JSON.stringify(kvData), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${HEALTH_METRIC_TTL_SECONDS}`,
              },
            }));
            if (addLog) {
              addLog(`${logPrefix}_cache_refill_done`, {
                target: host,
                cacheKey: key.url,
                kvKey: `health:${host}`,
              });
            }
          } catch (cacheWriteError) {
            if (addLog) {
              addLog(`${logPrefix}_cache_refill_failed`, {
                target: host,
                cacheKey: key.url,
                kvKey: `health:${host}`,
                error: cacheWriteError,
              });
            }
            console.error('Failed to refill health metrics cache:', cacheWriteError);
          }
        }
      }
      if (addLog) {
        addLog(`${logPrefix}_kv_lookup_done`, {
          target: host,
          kvKey: `health:${host}`,
          found: data !== null && data.status !== defaultValue.status,
        });
      }
    } catch (kvError) {
      if (addLog) {
        addLog(`${logPrefix}_kv_lookup_failed`, {
          target: host,
          kvKey: `health:${host}`,
          error: kvError,
        });
      }
      console.error('Failed to read health metrics from KV:', kvError);
    }
  } catch (cacheError) {
    if (addLog) {
      addLog(`${logPrefix}_cache_lookup_failed`, {
        target: host,
        cacheKey: key.url,
        error: cacheError,
      });
    }
    console.error('Failed to read health metrics from cache:', cacheError);
  }
  return data;
}
async function getSortedCandidates(targets, cache, addLog = null) {
  const statusPromises = targets.map(async (target) => {
    const data = await readHealthMetrics(cache, target.host, {
      defaultValue: { status: 'unknown', latency: UNKNOWN_LATENCY, lastChecked: 0 },
      addLog,
      logPrefix: 'candidate',
    });
    return { target, ...data };
  });
  const results = await Promise.all(statusPromises);
  return results.sort((a, b) => {
    const score = (status) => (status === 'healthy' ? 0 : status === 'unknown' ? 1 : 2);
    if (score(a.status) !== score(b.status)) {
      return score(a.status) - score(b.status);
    }
    return a.latency - b.latency;
  });
}
async function requestTarget(target, request, originalUrl, signal, requestMeta = {}, addLog = null) {
  try {
    const upstreamUrl = new URL(originalUrl);
    const parts = target.host.split(':');
    upstreamUrl.hostname = parts[0];
    upstreamUrl.port = parts[1] || '';
    if (addLog) {
      addLog('upstream_prepare_request', {
        target: target.host,
        targetType: target.type,
        upstreamUrl: upstreamUrl.toString(),
        method: request.method,
        isWebSocket: false,
        streamingRequest: true,
      });
    }
    const upstreamHeaders = sanitizeUpstreamRequestHeaders(request.headers);
    upstreamHeaders.set('Host', buildUpstreamHostHeader(target, upstreamUrl.protocol));
    upstreamHeaders.set('Accept-Encoding', 'identity');
    upstreamHeaders.set('Cache-Control', 'no-cache, no-transform');
    const realClientIP = requestMeta.clientIp || '';
    const realCountry = requestMeta.geo?.countryCodeAlpha2 || 'XX';
    const realAsn = requestMeta.geo?.asn;
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
    if (realAsn != null && realAsn !== '') {
      upstreamHeaders.set('LB-IPASN', String(realAsn));
    }
    const requestBody = request.body ?? undefined;
    const upstreamRequestInit = {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'manual',
      signal,
    };
    if (requestBody !== undefined) {
      upstreamRequestInit.body = requestBody;
      upstreamRequestInit.duplex = 'half';
    }
    if (addLog) {
      addLog('upstream_request_ready', {
        target: target.host,
        upstreamUrl: upstreamUrl.toString(),
        method: request.method,
        hasBody: requestBody !== undefined,
        headers: serializeHeadersForLog(upstreamHeaders),
      });
    }
    const upstreamRequest = new Request(upstreamUrl, upstreamRequestInit);
    let response;
    try {
      if (addLog) {
        addLog('upstream_fetch_start', {
          target: target.host,
          upstreamUrl: upstreamUrl.toString(),
          method: request.method,
        });
      }
      response = await fetch(upstreamRequest);
    } catch (fetchError) {
      if (addLog) {
        addLog('upstream_fetch_failed', {
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
          method: request.method,
        },
      };
    }
    if (addLog) {
      addLog('upstream_fetch_completed', {
        target: target.host,
        upstreamUrl: upstreamUrl.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: serializeHeadersForLog(response.headers),
      });
    }
    const judged = await judgeAndMaybeTransformResponse({
      resp: response,
      target,
      originalUrl,
    });
    if (!judged.ok) {
      if (addLog) {
        addLog('upstream_response_rejected', {
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
        error: judged.error,
      };
    }
    if (addLog) {
      addLog('upstream_response_accepted', {
        target: target.host,
        upstreamUrl: upstreamUrl.toString(),
        status: judged.response.status,
        statusText: judged.response.statusText,
      });
    }
    return {
      ok: true,
      response: judged.response,
    };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (addLog) {
      addLog('upstream_request_unhandled_error', {
        target: target.host,
        url: originalUrl.toString(),
        error,
      });
    }
    return {
      ok: false,
      reason: error.message,
      errorDetail: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        target: target.host,
        url: originalUrl.toString(),
      },
    };
  }
}
async function runBackgroundHealthCheck(candidatesWithStats, healthPath, cache) {
  const checks = candidatesWithStats.map(async (item) => {
    const target = item.target;
    const start = Date.now();
    try {
      const checkUrl = new URL(`https://${target.host}${healthPath}`);
      if (target.host.includes(':')) {
        const parts = target.host.split(':');
        checkUrl.hostname = parts[0];
        checkUrl.port = parts[1];
      }
      const request = new Request(checkUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'EdgeOne-LB-Health-Monitor' },
      });
      const result = await requestTarget(
        target,
        request,
        checkUrl,
        createTimeoutSignal(HEALTH_CHECK_TIMEOUT),
        {},
      );
      const duration = Date.now() - start;
      if (result.ok) {
        await updateMetrics(cache, target.host, 'healthy', duration);
      } else {
        await updateMetrics(cache, target.host, 'unhealthy', duration, result.reason);
      }
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? 'Timeout' : error.message;
      await updateMetrics(cache, target.host, 'unhealthy', UNKNOWN_LATENCY, reason);
    }
  });
  await Promise.allSettled(checks);
}
function formatHealthStatusEntry(target, info) {
  return {
    type: target.type,
    status: info.status,
    latency: info.latency === UNKNOWN_LATENCY ? 'TimeOut' : info.latency == null ? null : `${info.latency}ms`,
    last_update: info.lastChecked
      ? new Date(info.lastChecked).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      : 'Never',
    reason: info.reason || 'OK',
  };
}
async function buildGroupedHealthReport(domainTargets, cache) {
  const statusReport = {};
  for (const [domain, targets] of Object.entries(domainTargets)) {
    statusReport[domain] = {};
    await Promise.all(targets.map(async (target) => {
      const info = await readHealthMetrics(cache, target.host, {
        defaultValue: { status: 'pending', latency: null, lastChecked: null, reason: null },
      });
      statusReport[domain][target.host] = formatHealthStatusEntry(target, info);
    }));
  }
  return statusReport;
}
async function buildSingleDomainHealthReport(targets, cache) {
  const statusReport = {};
  await Promise.all(targets.map(async (target) => {
    const info = await readHealthMetrics(cache, target.host, {
      defaultValue: { status: 'pending', latency: null, lastChecked: null, reason: null },
    });
    statusReport[target.host] = formatHealthStatusEntry(target, info);
  }));
  return statusReport;
}
function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}
export async function onAdminHealthRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (!isAdminHostname(url.hostname)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    if (typeof lb_kv === 'undefined') {
      return jsonResponse({
        error: 'KV namespace not bound',
        message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings',
      }, 503);
    }
    const rules = await lb_kv.get('rules', { type: 'json' }) || {};
    const domainTargets = {};
    for (const [domain, rule] of Object.entries(rules)) {
      if (Array.isArray(rule?.targets) && rule.targets.length > 0) {
        domainTargets[domain] = rule.targets;
      }
    }
    if (Object.keys(domainTargets).length === 0) {
      return jsonResponse({
        message: 'No targets configured in any domain',
        domains: Object.keys(rules),
      });
    }
    const cache = await caches.open(METRICS_CACHE_NAME);
    const mode = url.searchParams.get('mode') === 'trigger' ? 'trigger' : 'report';
    if (mode === 'trigger') {
      for (const rule of Object.values(rules)) {
        if (Array.isArray(rule?.targets) && rule.targets.length > 0) {
          const healthPath = rule.healthPath || '/';
          const candidates = rule.targets.map((target) => ({ target }));
          await runBackgroundHealthCheck(candidates, healthPath, cache);
        }
      }
    }
    const report = await buildGroupedHealthReport(domainTargets, cache);
    return jsonResponse(report, 200, {
      'Access-Control-Allow-Origin': '*',
    });
  } catch (error) {
    const status = extractErrorStatus(error);
    return jsonResponse({
      error: status === 500 ? 'Internal server error' : `HTTP ${status}`,
      message: error.message,
    }, status);
  }
}
export async function onWebSocketProxyRequest(context) {
  const { request, rewrite } = context;
  const originalUrl = new URL(request.url);
  const hostname = originalUrl.hostname;

  if (isAdminHostname(hostname)) {
    return new Response('Not found', { status: 404 });
  }

  if (typeof rewrite !== 'function') {
    return jsonResponse({
      error: 'Middleware rewrite is unavailable',
    }, 500);
  }

  if (typeof lb_kv === 'undefined') {
    return jsonResponse({
      error: 'KV namespace not bound',
      message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings',
    }, 503);
  }

  const rules = await lb_kv.get('rules', { type: 'json' }) || {};
  const rule = rules[hostname];

  if (!rule) {
    return jsonResponse({
      error: `Domain ${hostname} not configured`,
      hostname,
      availableDomains: Object.keys(rules),
    }, 404);
  }

  if (rule.forceHttps && originalUrl.protocol === 'http:') {
    originalUrl.protocol = 'https:';
    return Response.redirect(originalUrl.toString(), 302);
  }

  const targets = Array.isArray(rule.targets) ? rule.targets : [];
  if (targets.length === 0) {
    return jsonResponse({
      error: 'No WebSocket backend available',
    }, 503);
  }

  const cache = await caches.open(METRICS_CACHE_NAME);
  const candidates = await getSortedCandidates(targets, cache);
  const wsTarget = candidates[0]?.target;

  if (!wsTarget) {
    return jsonResponse({
      error: 'No WebSocket backend available',
    }, 503);
  }

  const proxyUrl = new URL(originalUrl);
  proxyUrl.pathname = '/__ws_proxy';
  proxyUrl.search = '';
  proxyUrl.searchParams.set('target', wsTarget.host);
  proxyUrl.searchParams.set('path', originalUrl.pathname);
  proxyUrl.searchParams.set('search', originalUrl.search);
  proxyUrl.searchParams.set(
    'proto',
    request.headers.get('x-forwarded-proto')
      || request.headers.get('X-Forwarded-Proto')
      || originalUrl.protocol.replace(':', ''),
  );
  proxyUrl.protocol = 'https:';

  return rewrite(proxyUrl.toString());
}
export async function onProxyRequest(context) {
  const { request, clientIp, geo, waitUntil } = context;
  const requestStartedAt = Date.now();
  const originalUrl = new URL(request.url);
  originalUrl.pathname = getOriginalProxyPath(originalUrl.pathname);
  const hostname = originalUrl.hostname;
  const debugUserAgent = request.headers.get('user-agent') || '';
  const debugRequestedByHeader = request.headers.has(DEBUG_HEADER);
  const debugRequestedByUserAgent = debugUserAgent.includes(DEBUG_HEADER);
  const exposeDebugInfo = shouldExposeDebugInfo(request);
  const debugLogId = exposeDebugInfo ? createDebugLogId() : null;
  const requestMeta = {
    clientIp: clientIp || '',
    geo: geo || request.eo?.geo || null,
  };
  let phase = 'init';
  const requestLogs = [];
  const failedAttempts = [];
  let finalResponseStatus = null;
  let finalResponseStatusText = '';
  const requestKind = 'proxy';
  let deferDebugLogPersistence = false;
  let realtimeDebugLogPersistence = false;
  let debugLogPersistenceClosed = false;
  let debugLogPersistChain = Promise.resolve();
  let pendingStreamCompletion = null;
  let responseCompletionPromise = null;
  const complete = (responseOrPromise) => {
    responseCompletionPromise = Promise.resolve(responseOrPromise).then((resolved) => {
      finalResponseStatus = resolved?.status ?? null;
      finalResponseStatusText = resolved?.statusText || '';
      return resolved;
    });
    return responseCompletionPromise;
  };
  const resolvePendingStreamCompletion = (streamResult) => {
    if (!pendingStreamCompletion) {
      return;
    }
    pendingStreamCompletion(streamResult);
    pendingStreamCompletion = null;
  };
  const buildDebugLogRecord = () => {
    const completedAt = new Date().toISOString();
    return {
      id: debugLogId,
      createdAt: new Date(requestStartedAt).toISOString(),
      completedAt,
      durationMs: Date.now() - requestStartedAt,
      phase,
      kind: requestKind,
      outcome: classifyResponseStatus(finalResponseStatus),
      request: {
        method: request.method,
        url: originalUrl.toString(),
        hostname,
        pathname: originalUrl.pathname,
        userAgent: debugUserAgent || null,
        debugRequestedByHeader,
        debugRequestedByUserAgent,
        headers: serializeHeadersForLog(request.headers),
      },
      response: {
        status: finalResponseStatus,
        statusText: finalResponseStatusText,
      },
      attempts: serializeLogValue(failedAttempts),
      logs: serializeLogValue(requestLogs),
    };
  };
  const persistDebugLog = ({ finalize = false } = {}) => {
    if (!exposeDebugInfo || debugLogPersistenceClosed) {
      return null;
    }
    if (finalize) {
      debugLogPersistenceClosed = true;
    }
    const logRecord = buildDebugLogRecord();
    const persistTask = debugLogPersistChain
      .catch(() => {})
      .then(() => persistDebugLogRecord(logRecord))
      .catch((persistError) => {
        console.error('Failed to persist debug logs:', persistError);
      });
    debugLogPersistChain = persistTask;
    queueBackgroundTask(waitUntil, persistTask);
    return persistTask;
  };
  const addLog = exposeDebugInfo
    ? (message, detail) => {
        pushRequestLog(requestLogs, phase, message, detail);
        if (realtimeDebugLogPersistence) {
          const persistTask = persistDebugLog();
          if (persistTask) {
            persistTask.catch(() => {});
          }
        }
      }
    : () => {};
  const setPhase = (nextPhase, message, detail) => {
    phase = nextPhase;
    if (exposeDebugInfo) {
      pushRequestLog(requestLogs, phase, message, detail);
      if (realtimeDebugLogPersistence) {
        const persistTask = persistDebugLog();
        if (persistTask) {
          persistTask.catch(() => {});
        }
      }
    }
  };
  addLog('request_received', {
    url: originalUrl.toString(),
    method: request.method,
    hostname,
    pathname: originalUrl.pathname,
    userAgent: debugUserAgent || null,
    headers: serializeHeadersForLog(request.headers),
    debugRequestedByHeader,
    debugRequestedByUserAgent,
  });
  try {
    if (isAdminHostname(hostname)) {
      addLog('proxy_admin_hostname_blocked', { hostname });
      return complete(new Response('Not found', { status: 404 }));
    }
    setPhase('read_rules', 'proxy_read_rules_start', { hostname });
    let rules = {};
    try {
      if (typeof lb_kv === 'undefined') {
        addLog('proxy_kv_missing');
        return complete(createJsonErrorResponse(503, {
          error: 'KV namespace not bound',
          message: 'Please bind KV namespace with variable name "lb_kv" in EdgeOne Pages settings',
        }, requestLogs, exposeDebugInfo));
      }
      rules = await lb_kv.get('rules', { type: 'json' }) || {};
      addLog('proxy_read_rules_done', {
        domainCount: Object.keys(rules).length,
      });
    } catch (error) {
      console.error('Failed to read KV:', error);
      addLog('proxy_read_rules_failed', { error });
      return complete(createJsonErrorResponse(503, {
        error: 'KV storage error',
        message: error.message,
      }, requestLogs, exposeDebugInfo));
    }
    const rule = rules[hostname];
    if (!rule) {
      addLog('proxy_rule_missing', {
        hostname,
        availableDomains: Object.keys(rules),
      });
      return complete(createJsonErrorResponse(404, {
        error: `Domain ${hostname} not configured`,
        hostname,
        availableDomains: Object.keys(rules),
      }, requestLogs, exposeDebugInfo));
    }
    addLog('proxy_rule_loaded', {
      hostname,
      forceHttps: !!rule.forceHttps,
      healthPath: rule.healthPath || '/',
      targetCount: Array.isArray(rule.targets) ? rule.targets.length : 0,
      platform: rule.platform || 'edgeone',
    });
    if (rule.forceHttps && originalUrl.protocol === 'http:') {
      addLog('proxy_force_https_redirect', {
        from: originalUrl.toString(),
      });
      originalUrl.protocol = 'https:';
      return complete(Response.redirect(originalUrl.toString(), 302));
    }
    if (originalUrl.pathname === '/_health') {
      setPhase('health_report', 'proxy_health_report_start', {
        targetCount: Array.isArray(rule.targets) ? rule.targets.length : 0,
      });
      const cache = await caches.open(METRICS_CACHE_NAME);
      const statusReport = await buildSingleDomainHealthReport(rule.targets || [], cache);
      return complete(jsonResponse(statusReport, 200, {
        'Access-Control-Allow-Origin': '*',
      }));
    }
    if (originalUrl.pathname === '/_trigger_health_check') {
      setPhase('trigger_health_check', 'proxy_trigger_health_check_start', {
        targetCount: Array.isArray(rule.targets) ? rule.targets.length : 0,
      });
      const healthPath = rule.healthPath || '/';
      const cache = await caches.open(METRICS_CACHE_NAME);
      const candidates = (rule.targets || []).map((target) => ({ target }));
      await runBackgroundHealthCheck(candidates, healthPath, cache);
      const statusReport = await buildSingleDomainHealthReport(rule.targets || [], cache);
      return complete(jsonResponse(statusReport, 200, {
        'Access-Control-Allow-Origin': '*',
      }));
    }
    const targets = rule.targets || [];
    if (targets.length === 0) {
      addLog('proxy_no_targets_configured');
      return complete(createJsonErrorResponse(503, {
        error: 'No backend targets configured',
      }, requestLogs, exposeDebugInfo));
    }
    addLog('proxy_open_metrics_cache_start', {
      cacheName: METRICS_CACHE_NAME,
    });
    const cache = await caches.open(METRICS_CACHE_NAME);
    addLog('proxy_open_metrics_cache_done', {
      cacheName: METRICS_CACHE_NAME,
    });
    const healthPath = rule.healthPath || '/';
    addLog('proxy_request_mode', {
      isWebSocket: false,
      healthPath,
      targetCount: targets.length,
    });
    setPhase('load_candidates', 'proxy_load_candidates_start', {
      targetCount: targets.length,
    });
    const candidates = await getSortedCandidates(targets, cache, addLog);
    addLog('proxy_load_candidates_done', candidates.map((candidate) => ({
      host: candidate?.target?.host || null,
      type: candidate?.target?.type || null,
      status: candidate?.status || 'unknown',
      latency: candidate?.latency ?? null,
      lastChecked: candidate?.lastChecked || 0,
      reason: candidate?.reason || null,
    })));
    let response = null;
    if (exposeDebugInfo) {
      realtimeDebugLogPersistence = true;
    }
    for (const item of candidates) {
      const start = Date.now();
      const timeout = item.status === 'unhealthy' ? FAST_FAIL_TIMEOUT : REQUEST_TIMEOUT;
      setPhase(`attempt:${item.target.host}`, 'proxy_attempt_start', {
        target: item.target.host,
        targetType: item.target.type,
        candidateStatus: item.status,
        timeout,
      });
      try {
        const result = await requestTarget(
          item.target,
          request.clone(),
          originalUrl,
          createTimeoutSignal(timeout),
          requestMeta,
          addLog,
        );
        const duration = Date.now() - start;
        if (result && result.ok) {
          addLog('proxy_attempt_succeeded', {
            target: item.target.host,
            duration,
            isWebSocket: false,
            status: result.response?.status || null,
          });
          await updateMetrics(cache, item.target.host, 'healthy', duration);
          if (exposeDebugInfo && result.response.body) {
            deferDebugLogPersistence = true;
            pendingStreamCompletion = (streamResult) => {
              phase = 'response_stream';
              pushRequestLog(requestLogs, phase, 'proxy_stream_settled', streamResult);
              const persistTask = persistDebugLog({ finalize: true });
              if (persistTask) {
                persistTask.catch(() => {});
              }
            };
          }
          response = createStreamingProxyResponse(result.response, {
            'X-LB-Backend': item.target.host,
            'X-LB-Powered-By': 'EdgeOne-LB',
            'X-LB-Platform': rule.platform || 'edgeone',
            'X-Accel-Buffering': 'no',
          }, {
            onFirstUpstreamChunk: (streamResult) => {
              phase = 'response_stream';
              pushRequestLog(requestLogs, phase, 'proxy_stream_first_upstream_chunk', streamResult);
              const persistTask = persistDebugLog();
              if (persistTask) {
                persistTask.catch(() => {});
              }
            },
            onFirstDownstreamChunk: (streamResult) => {
              phase = 'response_stream';
              pushRequestLog(requestLogs, phase, 'proxy_stream_first_downstream_chunk', streamResult);
              const persistTask = persistDebugLog();
              if (persistTask) {
                persistTask.catch(() => {});
              }
            },
            onComplete: (streamResult) => {
              resolvePendingStreamCompletion(streamResult);
            },
          });
          finalResponseStatus = response.status;
          finalResponseStatusText = response.statusText;
          addLog('proxy_response_selected', {
            target: item.target.host,
            status: result.response.status,
            statusText: result.response.statusText,
          });
          break;
        }
        addLog('proxy_attempt_failed', {
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
      } catch (error) {
        const duration = Date.now() - start;
        const reason = error.name === 'TimeoutError' ? 'Timeout' : error.message;
        addLog('proxy_attempt_threw', {
          target: item.target.host,
          duration,
          reason,
          error,
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
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        });
        await updateMetrics(cache, item.target.host, 'unhealthy', duration, reason);
      }
    }
    const needsHealthCheck = candidates.some((candidate) => {
      return (Date.now() - (candidate.lastChecked || 0) > HEALTH_CHECK_INTERVAL) || candidate.status === 'unknown';
    });
    if (needsHealthCheck && healthPath) {
      setPhase('background_health_check', 'proxy_background_health_check_scheduled', {
        healthPath,
      });
      queueBackgroundTask(waitUntil, runBackgroundHealthCheck(candidates, healthPath, cache));
    }
    if (response) {
      addLog('proxy_request_completed_successfully');
      return complete(response);
    }
    setPhase('all_backends_failed', 'proxy_all_backends_failed', {
      attempts: failedAttempts.length,
    });
    return complete(createJsonErrorResponse(503, {
      error: 'Service Unavailable - All backends failed',
      message: 'Every candidate backend failed during proxying. See logs for the full request trace.',
      request: {
        url: originalUrl.toString(),
        method: request.method,
        hostname,
        pathname: originalUrl.pathname,
        isWebSocket: false,
        healthPath,
      },
      attempts: failedAttempts,
    }, requestLogs, exposeDebugInfo));
  } catch (error) {
    console.error('Load balancer error:', error);
    const status = extractErrorStatus(error);
    addLog('proxy_unhandled_error', { error });
    return complete(createJsonErrorResponse(status, {
      error: status === 500 ? 'Internal server error' : `HTTP ${status}`,
      message: error.message,
      request: {
        url: originalUrl.toString(),
        method: request.method,
        hostname: originalUrl.hostname,
        pathname: originalUrl.pathname,
      },
      exception: serializeLogValue(error),
      attempts: failedAttempts,
    }, requestLogs, exposeDebugInfo));
  } finally {
    if (responseCompletionPromise) {
      try {
        await responseCompletionPromise;
      } catch {}
    }
    if (exposeDebugInfo && !deferDebugLogPersistence) {
      const persistTask = persistDebugLog({ finalize: true });
      if (persistTask) {
        await persistTask;
      }
    }
  }
}
