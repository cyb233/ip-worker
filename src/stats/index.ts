import type { WorkerConfigEnv } from '@/config';

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STATS_START_AT_KEY = 'stats:startAt';
const DEFAULT_STATS_NAMESPACE = 'global';

export type RequestKind = 'ip' | 'dns';

export interface RequestStats {
  total: number;
  yesterday: number;
  today: number;
}

export interface StatsSummary {
  timezone: 'UTC+8';
  startAt: string | null;
  ip: RequestStats;
  dns: RequestStats;
}

export function getUtc8DateKey(timestamp: number): string {
  return new Date(timestamp + UTC8_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatUtc8DateTime(timestamp: number): string {
  return `${new Date(timestamp + UTC8_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')} UTC+8`;
}

export async function recordSuccessfulRequest(
  env: WorkerConfigEnv,
  kind: RequestKind,
  now = Date.now(),
): Promise<void> {
  const response = await getStatsStub(env).fetch('https://stats/increment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, now }),
  });

  if (!response.ok) {
    throw new Error(`Failed to increment ${kind} stats: ${response.status} ${response.statusText}`);
  }
}

export async function getStatsSummary(env: WorkerConfigEnv, now = Date.now()): Promise<StatsSummary> {
  const response = await getStatsStub(env).fetch(`https://stats/summary?now=${now}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to read stats summary: ${response.status} ${response.statusText}`);
  }

  return response.json<StatsSummary>();
}

export class StatsCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/increment') {
      const payload = await request.json<{ kind?: RequestKind; now?: number }>();
      const kind = payload.kind;
      const now = payload.now;

      if (!isRequestKind(kind)) {
        return new Response('Invalid request kind', { status: 400 });
      }

      if (typeof now !== 'number' || !Number.isFinite(now)) {
        return new Response('Invalid timestamp', { status: 400 });
      }

      await this.increment(kind, now);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'GET' && url.pathname === '/summary') {
      const now = Number.parseInt(url.searchParams.get('now') || '', 10);
      const summary = await this.buildSummary(Number.isFinite(now) ? now : Date.now());
      return Response.json(summary);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async increment(kind: RequestKind, now: number): Promise<void> {
    const dayKey = getUtc8DateKey(now);
    const totalKey = `total:${kind}`;
    const dailyKey = `daily:${kind}:${dayKey}`;

    await this.state.storage.transaction(async (txn) => {
      const [total, daily, startAt] = await Promise.all([
        txn.get<number>(totalKey),
        txn.get<number>(dailyKey),
        txn.get<number>(STATS_START_AT_KEY),
      ]);

      await txn.put({
        [totalKey]: (total ?? 0) + 1,
        [dailyKey]: (daily ?? 0) + 1,
        ...(startAt === undefined ? { [STATS_START_AT_KEY]: now } : {}),
      });
    });
  }

  private async buildSummary(now: number): Promise<StatsSummary> {
    const todayKey = getUtc8DateKey(now);
    const yesterdayKey = getUtc8DateKey(now - ONE_DAY_MS);
    const [startAt, ip, dns] = await Promise.all([
      this.state.storage.get<number>(STATS_START_AT_KEY),
      this.getRequestStats('ip', todayKey, yesterdayKey),
      this.getRequestStats('dns', todayKey, yesterdayKey),
    ]);

    return {
      timezone: 'UTC+8',
      startAt: startAt === undefined ? null : formatUtc8DateTime(startAt),
      ip,
      dns,
    };
  }

  private async getRequestStats(
    kind: RequestKind,
    todayKey: string,
    yesterdayKey: string,
  ): Promise<RequestStats> {
    const [total, today, yesterday] = await Promise.all([
      this.getCount(`total:${kind}`),
      this.getCount(`daily:${kind}:${todayKey}`),
      this.getCount(`daily:${kind}:${yesterdayKey}`),
    ]);

    return {
      total,
      yesterday,
      today,
    };
  }

  private async getCount(key: string): Promise<number> {
    return (await this.state.storage.get<number>(key)) ?? 0;
  }
}

function getStatsStub(env: WorkerConfigEnv): DurableObjectStub {
  const namespace = env.STATS_NAMESPACE || DEFAULT_STATS_NAMESPACE;
  const id = env.STATS_COUNTER.idFromName(namespace);
  return env.STATS_COUNTER.get(id);
}

function isRequestKind(value: string | undefined): value is RequestKind {
  return value === 'ip' || value === 'dns';
}
