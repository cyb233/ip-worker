import { DohConfig, getDohConfig, type WorkerConfigEnv } from '@/config';
import {
  DnsMessage,
  encodeBase64Url,
  getTransactionId,
  validateDnsQuery,
  validateDnsResponse,
  zeroTransactionId,
  withTransactionId,
} from './packet';
import { fetchUpstreamDnsResponse } from './upstream';

type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export interface DnsResolutionResult {
  responseBytes: Uint8Array<ArrayBuffer>;
  response: DnsMessage;
  cacheStatus: CacheStatus;
  cacheTtl?: number;
  upstreamHost: string;
}

export async function resolveDnsQuery(
  queryBytes: Uint8Array,
  env: WorkerConfigEnv,
): Promise<DnsResolutionResult> {
  const config = getDohConfig(env);
  const query = validateDnsQuery(queryBytes);
  const requestId = getTransactionId(queryBytes);
  const normalizedQuery = zeroTransactionId(queryBytes);
  const cacheRequest = buildCacheRequest(normalizedQuery);

  if (config.cacheEnabled) {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      const normalizedResponse: Uint8Array<ArrayBuffer> = new Uint8Array(await cachedResponse.arrayBuffer());
      const responseBytes = withTransactionId(normalizedResponse, requestId);
      const response = validateDnsResponse(query, responseBytes);
      return {
        responseBytes,
        response,
        cacheStatus: 'HIT',
        cacheTtl: parseCacheControlTtl(cachedResponse.headers.get('Cache-Control')),
        upstreamHost: config.upstreamUrl.hostname,
      };
    }
  }

  const upstreamResult = await fetchUpstreamDnsResponse(queryBytes, config);
  const cacheTtl = getCacheTtl(upstreamResult.response, config);

  if (!config.cacheEnabled || !cacheTtl || cacheTtl <= 0) {
    return {
      responseBytes: upstreamResult.responseBytes,
      response: upstreamResult.response,
      cacheStatus: 'BYPASS',
      upstreamHost: upstreamResult.upstreamHost,
    };
  }

  const normalizedResponse = zeroTransactionId(upstreamResult.responseBytes);
  const cacheResponse = new Response(normalizedResponse, {
    headers: {
      'Content-Type': 'application/dns-message',
      'Cache-Control': `public, max-age=${cacheTtl}`,
    },
  });

  await caches.default.put(cacheRequest, cacheResponse);

  return {
    responseBytes: upstreamResult.responseBytes,
    response: upstreamResult.response,
    cacheStatus: 'MISS',
    cacheTtl,
    upstreamHost: upstreamResult.upstreamHost,
  };
}

function buildCacheRequest(queryBytes: Uint8Array): Request {
  const encoded = encodeBase64Url(queryBytes);
  return new Request(`https://cache.internal/dns-query?dns=${encoded}`);
}

function getCacheTtl(response: DnsMessage, config: DohConfig): number | undefined {
  if (response.rcode === 0 && response.answers.length > 0) {
    const rawTtl = Math.min(...response.answers.map((record) => record.ttl));
    const ttl = clamp(rawTtl, config.cacheMinTtl, config.cacheMaxTtl);
    return ttl > 0 ? ttl : undefined;
  }

  if (response.answers.length > 0 || (response.rcode !== 0 && response.rcode !== 3)) {
    return undefined;
  }

  const soa = response.authorities.find((record) => record.type === 6 && record.parsedData);
  if (!soa?.parsedData) {
    return undefined;
  }

  const rawTtl = Math.min(soa.ttl, soa.parsedData.minimum);
  const ttl = clamp(rawTtl, config.cacheMinTtl, Math.min(config.cacheMaxTtl, config.cacheNegativeMaxTtl));
  return ttl > 0 ? ttl : undefined;
}

function parseCacheControlTtl(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/max-age=(\d+)/i);
  if (!match) {
    return undefined;
  }

  const ttl = Number.parseInt(match[1], 10);
  return Number.isNaN(ttl) ? undefined : ttl;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
