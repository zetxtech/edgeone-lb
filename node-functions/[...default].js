/**
 * Catch-all Node Function — handles WebSocket proxying at any path.
 *
 * The EdgeOne Pages platform routes WebSocket upgrades directly to this
 * Node Function (bypassing middleware).  HTTP requests that reach here
 * (e.g. admin hostnames, internal paths passed via next()) get a 404.
 *
 * The upstream target is resolved from KV (lb_kv) based on the request
 * hostname.  Query params can override:
 *   target  — explicit upstream host (skip KV lookup)
 *   path    — path to forward (default: request path)
 *   search  — search string to forward
 *   proto   — protocol hint (default: from x-forwarded-proto)
 *   _debug  — "1" to persist debug logs to KV
 */

export { onRequest, default } from './__ws_proxy/index.js';
