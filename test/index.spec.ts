import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { buildDnsQuery, decodeBase64Url, encodeBase64Url, encodeDomainName } from '../src/dns/packet';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DNS over HTTPS worker', () => {
  it('handles GET /dns-query and reuses cache across transaction IDs', async () => {
    const queryOne = buildDnsQuery({ id: 0x1111, name: 'cache-test.example', type: 1 });
    const queryTwo = buildDnsQuery({ id: 0x2222, name: 'cache-test.example', type: 1 });
    const upstreamResponse = buildAResponse('cache-test.example', 0x1111, '203.0.113.10', 120);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstreamResponse, {
        headers: { 'Content-Type': 'application/dns-message' },
      }),
    );

    const first = await dispatch(`/dns-query?dns=${encodeBase64Url(queryOne)}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toContain('application/dns-message');
    expect(first.headers.get('X-DNS-Cache')).toBe('MISS');
    expect(first.headers.get('X-DNS-Cache-TTL')).toBe('120');
    expect(new Uint8Array(await first.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x11, 0x11]));

    const second = await dispatch(`/dns-query?dns=${encodeBase64Url(queryTwo)}`);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-DNS-Cache')).toBe('HIT');
    expect(new Uint8Array(await second.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x22, 0x22]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles POST /dns-query with application/dns-message', async () => {
    const query = buildDnsQuery({ id: 0x3333, name: 'post-test.example', type: 1 });
    const upstreamResponse = buildAResponse('post-test.example', 0x3333, '203.0.113.20', 60);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstreamResponse, {
        headers: { 'Content-Type': 'application/dns-message' },
      }),
    );

    const response = await dispatch('/dns-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/dns-message' },
      body: query,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-DNS-Cache')).toBe('MISS');
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x33, 0x33]));
  });

  it('returns 400 for invalid base64url input', async () => {
    const response = await dispatch('/dns-query?dns=***');
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid base64url');
  });

  it('returns 415 for POST /dns-query with the wrong content type', async () => {
    const response = await dispatch('/dns-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(415);
  });

  it('returns 405 for unsupported /dns-query methods', async () => {
    const response = await dispatch('/dns-query', { method: 'PUT' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, POST');
  });

  it('handles /resolve and returns dns-json payload', async () => {
    const upstreamResponse = buildAResponse('resolve-test.example', 0x4444, '198.51.100.7', 180);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      const parsed = decodeQuestion(body);
      expect(parsed.name).toBe('resolve-test.example.');
      expect(parsed.type).toBe(1);
      return new Response(buildAResponse('resolve-test.example', getId(body), '198.51.100.7', 180), {
        headers: { 'Content-Type': 'application/dns-message' },
      });
    });

    const response = await dispatch('/resolve?name=resolve-test.example&type=A');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/dns-json');
    expect(response.headers.get('X-DNS-Cache')).toBe('MISS');

    const payload = await response.json<any>();
    expect(payload.Status).toBe(0);
    expect(payload.Question).toEqual([{ name: 'resolve-test.example.', type: 1 }]);
    expect(payload.Answer[0]).toMatchObject({
      name: 'resolve-test.example.',
      type: 1,
      TTL: 180,
      data: '198.51.100.7',
    });
  });

  it('returns 400 for invalid /resolve query parameters', async () => {
    const missingName = await dispatch('/resolve');
    expect(missingName.status).toBe(400);

    const invalidType = await dispatch('/resolve?name=example.com&type=BADTYPE');
    expect(invalidType.status).toBe(400);

    const invalidFlag = await dispatch('/resolve?name=example.com&cd=2');
    expect(invalidFlag.status).toBe(400);
  });

  it('returns 502 when the upstream response is invalid', async () => {
    const query = buildDnsQuery({ id: 0x5555, name: 'bad-upstream.example', type: 1 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(query, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );

    const response = await dispatch(`/dns-query?dns=${encodeBase64Url(query)}`);
    expect(response.status).toBe(502);
  });

  it('returns 504 when the upstream request times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    const query = buildDnsQuery({ id: 0x6666, name: 'timeout.example', type: 1 });
    const response = await dispatch(`/dns-query?dns=${encodeBase64Url(query)}`, undefined, {
      DOH_TIMEOUT_MS: '1',
    });

    expect(response.status).toBe(504);
  });

  it('keeps the legacy /api IP route working', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (!url.startsWith('http://ip-api.com/json/8.8.8.8')) {
        throw new Error(`Unexpected upstream URL: ${url}`);
      }

      return Response.json({
        status: 'success',
        message: undefined,
        continent: 'North America',
        continentCode: 'NA',
        country: 'United States',
        countryCode: 'US',
        region: 'CA',
        regionName: 'California',
        city: 'Mountain View',
        district: '',
        zip: '94043',
        lat: 37.386,
        lon: -122.084,
        timezone: 'America/Los_Angeles',
        offset: -25200,
        currency: 'USD',
        isp: 'Google',
        org: 'Google Public DNS',
        as: 'AS15169',
        asname: 'GOOGLE',
        reverse: 'dns.google',
        mobile: false,
        proxy: false,
        hosting: true,
        query: '8.8.8.8',
      });
    });

    const response = await dispatch('/api/ip/8.8.8.8?format=json');
    expect(response.status).toBe(200);

    const payload = await response.json<any>();
    expect(payload).toMatchObject({
      ip: '8.8.8.8',
      country: 'US',
      city: 'Mountain View',
    });
  });

  it('negative responses can be cached from SOA TTL', async () => {
    const firstQuery = buildDnsQuery({ id: 0x7777, name: 'nxdomain-test.example', type: 1 });
    const secondQuery = buildDnsQuery({ id: 0x8888, name: 'nxdomain-test.example', type: 1 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = new Uint8Array(init?.body as ArrayBuffer);
      return new Response(buildNxDomainResponse('nxdomain-test.example', getId(body), 45), {
        headers: { 'Content-Type': 'application/dns-message' },
      });
    });

    const first = await dispatch(`/dns-query?dns=${encodeBase64Url(firstQuery)}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-DNS-Cache')).toBe('MISS');
    expect(first.headers.get('X-DNS-Cache-TTL')).toBe('45');

    const second = await dispatch(`/dns-query?dns=${encodeBase64Url(secondQuery)}`);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-DNS-Cache')).toBe('HIT');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

async function dispatch(path: string, init?: RequestInit, envOverride?: Partial<Env>): Promise<Response> {
  const request = new IncomingRequest(`https://example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, { ...env, ...envOverride }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function buildAResponse(name: string, id: number, ip: string, ttl: number): Uint8Array {
  const question = buildQuestion(name, 1);
  const answer = new Uint8Array(16);
  const view = new DataView(answer.buffer);
  answer[0] = 0xc0;
  answer[1] = 0x0c;
  view.setUint16(2, 1);
  view.setUint16(4, 1);
  view.setUint32(6, ttl);
  view.setUint16(10, 4);
  const octets = ip.split('.').map((value) => Number.parseInt(value, 10));
  answer.set(octets, 12);
  return concatBytes(buildHeader(id, 0x8180, 1, 1, 0, 0), question, answer);
}

function buildNxDomainResponse(name: string, id: number, ttl: number): Uint8Array {
  const question = buildQuestion(name, 1);
  const authorityName = new Uint8Array([0xc0, 0x0c]);
  const mname = encodeDomainName('ns1.example.');
  const rname = encodeDomainName('hostmaster.example.');
  const soaTail = new Uint8Array(20);
  const soaView = new DataView(soaTail.buffer);
  soaView.setUint32(0, 2024062601);
  soaView.setUint32(4, 3600);
  soaView.setUint32(8, 600);
  soaView.setUint32(12, 86400);
  soaView.setUint32(16, ttl);
  const soaData = concatBytes(mname, rname, soaTail);

  const authority = new Uint8Array(authorityName.length + 10 + soaData.length);
  authority.set(authorityName, 0);
  const authorityView = new DataView(authority.buffer);
  authorityView.setUint16(authorityName.length, 6);
  authorityView.setUint16(authorityName.length + 2, 1);
  authorityView.setUint32(authorityName.length + 4, ttl);
  authorityView.setUint16(authorityName.length + 8, soaData.length);
  authority.set(soaData, authorityName.length + 10);

  return concatBytes(buildHeader(id, 0x8183, 1, 0, 1, 0), question, authority);
}

function buildQuestion(name: string, type: number): Uint8Array {
  const encodedName = encodeDomainName(name);
  const question = new Uint8Array(encodedName.length + 4);
  question.set(encodedName, 0);
  const view = new DataView(question.buffer);
  view.setUint16(encodedName.length, type);
  view.setUint16(encodedName.length + 2, 1);
  return question;
}

function buildHeader(
  id: number,
  flags: number,
  questionCount: number,
  answerCount: number,
  authorityCount: number,
  additionalCount: number,
): Uint8Array {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint16(0, id);
  view.setUint16(2, flags);
  view.setUint16(4, questionCount);
  view.setUint16(6, answerCount);
  view.setUint16(8, authorityCount);
  view.setUint16(10, additionalCount);
  return header;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function getId(message: Uint8Array): number {
  return new DataView(message.buffer, message.byteOffset, message.byteLength).getUint16(0);
}

function decodeQuestion(message: Uint8Array): { name: string; type: number } {
  const decoded = decodeBase64Url(encodeBase64Url(message));
  let offset = 12;
  const labels: string[] = [];
  while (decoded[offset] !== 0) {
    const length = decoded[offset];
    offset += 1;
    labels.push(new TextDecoder().decode(decoded.subarray(offset, offset + length)));
    offset += length;
  }
  offset += 1;
  const type = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength).getUint16(offset);
  return {
    name: `${labels.join('.')}.`,
    type,
  };
}
