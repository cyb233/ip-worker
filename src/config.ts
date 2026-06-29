export interface DohEnv {
  DOH_UPSTREAM_URL?: string;
  DOH_TIMEOUT_MS?: string;
  DOH_CACHE_ENABLED?: string;
  DOH_CACHE_MIN_TTL?: string;
  DOH_CACHE_MAX_TTL?: string;
  DOH_CACHE_NEGATIVE_MAX_TTL?: string;
  DNS_API_KEY?: string;
}

export type WorkerConfigEnv = Env & DohEnv;

export interface DohConfig {
  upstreamUrl: URL;
  timeoutMs: number;
  cacheEnabled: boolean;
  cacheMinTtl: number;
  cacheMaxTtl: number;
  cacheNegativeMaxTtl: number;
}

const DEFAULT_DOH_UPSTREAM_URL = 'https://cloudflare-dns.com/dns-query';
const DEFAULT_DOH_TIMEOUT_MS = 5000;
const DEFAULT_DOH_CACHE_ENABLED = true;
const DEFAULT_DOH_CACHE_MIN_TTL = 0;
const DEFAULT_DOH_CACHE_MAX_TTL = 86400;
const DEFAULT_DOH_CACHE_NEGATIVE_MAX_TTL = 300;

export function getDohConfig(env: WorkerConfigEnv): DohConfig {
  const upstreamUrl = parseHttpsUrl(env.DOH_UPSTREAM_URL, DEFAULT_DOH_UPSTREAM_URL);
  const timeoutMs = parseInteger(env.DOH_TIMEOUT_MS, DEFAULT_DOH_TIMEOUT_MS, 'DOH_TIMEOUT_MS', 1);
  const cacheEnabled = parseBoolean(env.DOH_CACHE_ENABLED, DEFAULT_DOH_CACHE_ENABLED, 'DOH_CACHE_ENABLED');
  const cacheMinTtl = parseInteger(env.DOH_CACHE_MIN_TTL, DEFAULT_DOH_CACHE_MIN_TTL, 'DOH_CACHE_MIN_TTL', 0);
  const cacheMaxTtl = parseInteger(env.DOH_CACHE_MAX_TTL, DEFAULT_DOH_CACHE_MAX_TTL, 'DOH_CACHE_MAX_TTL', 0);
  const cacheNegativeMaxTtl = parseInteger(
    env.DOH_CACHE_NEGATIVE_MAX_TTL,
    DEFAULT_DOH_CACHE_NEGATIVE_MAX_TTL,
    'DOH_CACHE_NEGATIVE_MAX_TTL',
    0,
  );

  if (cacheMinTtl > cacheMaxTtl) {
    throw new Error('DOH_CACHE_MIN_TTL must be less than or equal to DOH_CACHE_MAX_TTL');
  }

  return {
    upstreamUrl,
    timeoutMs,
    cacheEnabled,
    cacheMinTtl,
    cacheMaxTtl,
    cacheNegativeMaxTtl,
  };
}

export function getDnsApiKey(env: WorkerConfigEnv): string | undefined {
  const dnsApiKey = env.DNS_API_KEY;
  if (dnsApiKey === undefined || dnsApiKey === '') {
    return undefined;
  }

  if (dnsApiKey.includes('/')) {
    throw new Error('DNS_API_KEY must not contain /');
  }

  return dnsApiKey;
}

function parseHttpsUrl(value: string | undefined, fallback: string): URL {
  const url = new URL(value || fallback);
  if (url.protocol !== 'https:') {
    throw new Error('DOH_UPSTREAM_URL must use HTTPS');
  }
  return url;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  if (value === '1' || value.toLowerCase() === 'true') {
    return true;
  }

  if (value === '0' || value.toLowerCase() === 'false') {
    return false;
  }

  throw new Error(`${name} must be 0, 1, true, or false`);
}
