import { onAdminHealthRequest } from '../lb-proxy.js';

export function onRequest(context) {
  const url = new URL(context.request.url);
  url.searchParams.set('mode', 'report');

  return onAdminHealthRequest({
    ...context,
    request: new Request(url.toString(), context.request),
  });
}