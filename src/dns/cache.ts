import { DohConfig, getDohConfig, type WorkerConfigEnv } from '@/config';
import {
  decrementResourceRecordTtls,
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
      const cacheAgeSeconds = getCacheAgeSeconds(cachedResponse.headers.get('X-DNS-Cached-At'));
      const cacheTtl = getRemainingCacheTtl(cachedResponse.headers.get('Cache-Control'), cacheAgeSeconds);
      if (cacheTtl === undefined || cacheTtl <= 0) {
        await caches.default.delete(cacheRequest);
      } else {
        const normalizedResponse = decrementResourceRecordTtls(
          new Uint8Array(await cachedResponse.arrayBuffer()),
          cacheAgeSeconds,
        );
        const responseBytes = withTransactionId(normalizedResponse, requestId);
        const response = validateDnsResponse(query, responseBytes);
        return {
          responseBytes,
          response,
          cacheStatus: 'HIT',
          cacheTtl,
          upstreamHost: config.upstreamUrl.hostname,
        };
      }
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
      'X-DNS-Cached-At': String(Date.now()),
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
    return capCacheTtl(Math.min(...response.answers.map((record) => record.ttl)), config.cacheMaxTtl);
  }

  if (response.answers.length > 0 || (response.rcode !== 0 && response.rcode !== 3)) {
    return undefined;
  }

  const soa = response.authorities.find((record) => record.type === 6 && record.parsedData);
  if (!soa?.parsedData) {
    return undefined;
  }

  return capCacheTtl(
    Math.min(soa.ttl, soa.parsedData.minimum),
    Math.min(config.cacheMaxTtl, config.cacheNegativeMaxTtl),
  );
}

function getRemainingCacheTtl(cacheControl: string | null, cacheAgeSeconds: number): number | undefined {
  const maxAge = parseCacheControlTtl(cacheControl);
  return maxAge === undefined ? undefined : Math.max(maxAge - cacheAgeSeconds, 0);
}

function getCacheAgeSeconds(cachedAt: string | null): number {
  if (!cachedAt) {
    return 0;
  }

  const cachedAtMilliseconds = Number.parseInt(cachedAt, 10);
  if (!Number.isFinite(cachedAtMilliseconds) || Number.isNaN(cachedAtMilliseconds)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - cachedAtMilliseconds) / 1000));
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

function capCacheTtl(value: number, max: number): number | undefined {
  const ttl = Math.min(value, max);
  return ttl > 0 ? ttl : undefined;
}
