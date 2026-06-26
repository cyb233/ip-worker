import { Hono } from 'hono';

import { resolveDnsQuery } from './cache';
import { toDnsJsonResponse } from './json';
import { buildDnsQuery, decodeBase64Url, parseBinaryFlag, resolveRecordType } from './packet';
import { DnsBadGatewayError, DnsGatewayTimeoutError } from './upstream';

export const app = new Hono<{ Bindings: Env }>();

app.get('/dns-query', async (c) => {
  try {
    const encodedMessage = c.req.query('dns');
    if (!encodedMessage) {
      throw new HttpError(400, 'Missing dns query parameter');
    }

    const queryBytes = decodeBase64Url(encodedMessage);
    const result = await resolveDnsQuery(queryBytes, c.env);
    return c.body(result.responseBytes, 200, buildDnsHeaders(result));
  } catch (error) {
    return handleDnsError(error);
  }
});

app.post('/dns-query', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/dns-message')) {
      throw new HttpError(415, 'Content-Type must be application/dns-message');
    }

    const queryBytes = new Uint8Array(await c.req.arrayBuffer());
    if (queryBytes.byteLength === 0) {
      throw new HttpError(400, 'DNS request body must not be empty');
    }

    const result = await resolveDnsQuery(queryBytes, c.env);
    return c.body(result.responseBytes, 200, buildDnsHeaders(result));
  } catch (error) {
    return handleDnsError(error);
  }
});

app.all('/dns-query', () => methodNotAllowed(['GET', 'POST']));

app.get('/resolve', async (c) => {
  try {
    const name = c.req.query('name');
    if (!name) {
      throw new HttpError(400, 'Missing name query parameter');
    }

    const type = resolveRecordType(c.req.query('type'));
    const cd = parseBinaryFlag(c.req.query('cd'), 'cd');
    const dnssecOk = parseBinaryFlag(c.req.query('do'), 'do');
    const queryBytes = buildDnsQuery({
      id: crypto.getRandomValues(new Uint16Array(1))[0],
      name,
      type,
      cd,
      dnssecOk,
    });

    const result = await resolveDnsQuery(queryBytes, c.env);
    return c.json(toDnsJsonResponse(result.response), 200, {
      ...buildCacheHeaders(result),
      'Content-Type': 'application/dns-json; charset=utf-8',
    });
  } catch (error) {
    return handleDnsError(error);
  }
});

app.all('/resolve', () => methodNotAllowed(['GET']));

interface DnsRouteResult {
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  cacheTtl?: number;
  upstreamHost: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message);
  }
}

function buildDnsHeaders(result: DnsRouteResult): HeadersInit {
  return {
    ...buildCacheHeaders(result),
    'Content-Type': 'application/dns-message',
  };
}

function buildCacheHeaders(result: DnsRouteResult): HeadersInit {
  const headers: Record<string, string> = {
    'X-DNS-Cache': result.cacheStatus,
    'X-DoH-Upstream': result.upstreamHost,
  };

  if (result.cacheTtl !== undefined) {
    headers['X-DNS-Cache-TTL'] = String(result.cacheTtl);
  }

  return headers;
}

function methodNotAllowed(allowedMethods: string[]): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: allowedMethods.join(', '),
    },
  });
}

function handleDnsError(error: unknown): Response {
  if (error instanceof HttpError) {
    return new Response(error.message, {
      status: error.status,
      headers: error.headers,
    });
  }

  if (error instanceof DnsGatewayTimeoutError) {
    return new Response(error.message, { status: 504 });
  }

  if (error instanceof DnsBadGatewayError) {
    return new Response(error.message, { status: 502 });
  }

  if (error instanceof Error) {
    return new Response(error.message, { status: 400 });
  }

  return new Response('Internal Server Error', { status: 500 });
}
