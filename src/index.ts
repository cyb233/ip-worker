/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { trimTrailingSlash } from 'hono/trailing-slash';

import type { WorkerConfigEnv } from '@/config';
import { app as dnsApp } from '@/dns/index';
import { app as ipApp } from '@/ip/index';
import { getStatsSummary, StatsCounter } from '@/stats/index';

const app = new Hono<{ Bindings: WorkerConfigEnv }>();
app.use(logger(), requestId(), trimTrailingSlash());

app.get('/stats', async (c) => {
  return c.json(await getStatsSummary(c.env));
});

app.route('/', dnsApp);
app.route('/api', ipApp);

export { StatsCounter };
export default app;
