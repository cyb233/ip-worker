import { DohConfig } from '../config';
import { DnsMessage, validateDnsQuery, validateDnsResponse } from './packet';

export class DnsGatewayTimeoutError extends Error {}

export class DnsBadGatewayError extends Error {}

export interface UpstreamDnsResponse {
  query: DnsMessage;
  response: DnsMessage;
  responseBytes: Uint8Array<ArrayBuffer>;
  upstreamHost: string;
}

export async function fetchUpstreamDnsResponse(
  queryBytes: Uint8Array,
  config: DohConfig,
): Promise<UpstreamDnsResponse> {
  const query = validateDnsQuery(queryBytes);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/dns-message',
        Accept: 'application/dns-message',
      },
      body: queryBytes,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new DnsBadGatewayError(`Upstream DoH request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/dns-message')) {
      throw new DnsBadGatewayError('Upstream DoH response did not return application/dns-message');
    }

    const responseBytes: Uint8Array<ArrayBuffer> = new Uint8Array(await response.arrayBuffer());
    const parsedResponse = validateDnsResponse(query, responseBytes);

    return {
      query,
      response: parsedResponse,
      responseBytes,
      upstreamHost: config.upstreamUrl.hostname,
    };
  } catch (error) {
    if (error instanceof DnsBadGatewayError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new DnsGatewayTimeoutError('Upstream DoH request timed out');
    }

    if (error instanceof Error) {
      throw new DnsBadGatewayError(error.message);
    }

    throw new DnsBadGatewayError('Unknown upstream DoH error');
  } finally {
    clearTimeout(timeout);
  }
}
