import { Context, Hono } from 'hono';

import { getDnsApiKey, type WorkerConfigEnv } from '@/config';
import { createSuccessCounterMiddleware } from '@/stats/middleware';
import { resolveDnsQuery } from './cache';
import { toDnsJsonResponse } from './json';
import { buildDnsQuery, decodeBase64Url, parseBinaryFlag, resolveRecordType } from './packet';
import { DnsBadGatewayError, DnsGatewayTimeoutError } from './upstream';

type DnsRouteContext = {
  Bindings: WorkerConfigEnv;
};

type DnsContext = Context<DnsRouteContext>;

export const app = new Hono<DnsRouteContext>();
app.use('/dns-query', createSuccessCounterMiddleware('dns'));
app.use('/:dnsApiKey/dns-query', createSuccessCounterMiddleware('dns'));
app.use('/resolve', createSuccessCounterMiddleware('dns'));
app.use('/:dnsApiKey/resolve', createSuccessCounterMiddleware('dns'));

app.get('/dns-query', handleGetDnsQuery);
app.post('/dns-query', handlePostDnsQuery);
app.all('/dns-query', (c) => handleMethodNotAllowed(c, ['GET', 'POST']));

app.get('/:dnsApiKey/dns-query', handleGetDnsQuery);
app.post('/:dnsApiKey/dns-query', handlePostDnsQuery);
app.all('/:dnsApiKey/dns-query', (c) => handleMethodNotAllowed(c, ['GET', 'POST']));

app.get('/resolve', handleResolve);
app.all('/resolve', (c) => handleMethodNotAllowed(c, ['GET']));

app.get('/:dnsApiKey/resolve', handleResolve);
app.all('/:dnsApiKey/resolve', (c) => handleMethodNotAllowed(c, ['GET']));

async function handleGetDnsQuery(c: DnsContext) {
  return handleDnsQuery(c, () => {
    const encodedMessage = c.req.query('dns');
    if (!encodedMessage) {
      throw new HttpError(400, 'Missing dns query parameter');
    }

    return decodeBase64Url(encodedMessage);
  });
}

async function handlePostDnsQuery(c: DnsContext) {
  return handleDnsQuery(c, async () => {
    const contentType = c.req.header('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/dns-message')) {
      throw new HttpError(415, 'Content-Type must be application/dns-message');
    }

    const queryBytes = new Uint8Array(await c.req.arrayBuffer());
    if (queryBytes.byteLength === 0) {
      throw new HttpError(400, 'DNS request body must not be empty');
    }

    return queryBytes;
  });
}

async function handleDnsQuery(c: DnsContext, readQueryBytes: () => Promise<Uint8Array> | Uint8Array) {
  const authError = ensureDnsAccess(c);
  if (authError) {
    return authError;
  }

  try {
    const queryBytes = await readQueryBytes();
    const result = await resolveDnsQuery(queryBytes, c.env);
    return c.body(result.responseBytes, 200, buildDnsHeaders(result));
  } catch (error) {
    return handleDnsError(error);
  }
}

async function handleResolve(c: DnsContext) {
  const authError = ensureDnsAccess(c);
  if (authError) {
    return authError;
  }

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
}

function ensureDnsAccess(c: DnsContext): Response | undefined {
  try {
    const configuredApiKey = getDnsApiKey(c.env);
    const routeApiKey = c.req.param('dnsApiKey');

    if (!configuredApiKey) {
      if (routeApiKey) {
        return new Response('Not Found', { status: 404 });
      }
      return undefined;
    }

    if (routeApiKey !== configuredApiKey) {
      return new Response('Unauthorized', { status: 401 });
    }

    return undefined;
  } catch (error) {
    return handleDnsError(error);
  }
}

function handleMethodNotAllowed(c: DnsContext, allowedMethods: string[]): Response {
  const authError = ensureDnsAccess(c);
  if (authError) {
    return authError;
  }

  return methodNotAllowed(allowedMethods);
}

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

function buildDnsHeaders(result: DnsRouteResult): Record<string, string> {
  return {
    ...buildCacheHeaders(result),
    'Content-Type': 'application/dns-message',
  };
}

function buildCacheHeaders(result: DnsRouteResult): Record<string, string> {
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
