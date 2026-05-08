import { onProxyRequest } from '../../lb-proxy.js';

export function onRequest(context) {
  return onProxyRequest(context);
}