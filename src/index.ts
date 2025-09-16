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
import { Hono, Context } from 'hono';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';

import { toXml } from './utils';
interface IpInfo {
	ip: string | null;
	asn: number | undefined;
	colo: string | undefined;
	continent: ContinentCode | undefined;
	country: Iso3166Alpha2Code | 'T1' | undefined;
	city: string | undefined;
	isEUCountry: '1' | undefined;
	asOrganization: string | undefined;
	longitude: string | undefined;
	latitude: string | undefined;
	postalCode: string | undefined;
	region: string | undefined;
	regionCode: string | undefined;
	timezone: string | undefined;
}

const app = new Hono();
app.use(logger(), requestId());

app.all('/api', (c) => {
	const { format, callback } = c.req.query();
	const json = getIpInfo(c);
	switch (format) {
		case 'json':
			return c.json(json);
		case 'xml':
			c.header('Content-Type', 'application/xml');
			return c.body(toXml(json));
		case 'jsonp':
			if (callback) {
				const jsonpResponse = `${callback}(${JSON.stringify(json)})`;
				c.header('Content-Type', 'application/javascript');
				return c.body(jsonpResponse);
			}
			return c.text('Callback parameter is required for JSONP', { status: 400 });
		case 'text':
		default:
			return c.text(json.ip ?? '');
	}
});

app.all('/api/text', (c) => {
	const json = getIpInfo(c);
	return c.text(json.ip ?? '');
});
app.all('/api/json', (c) => {
	const json = getIpInfo(c);
	return c.json(json);
});
app.all('/api/xml', (c) => {
	const json = getIpInfo(c);
	c.header('Content-Type', 'application/xml');
	return c.body(toXml(json));
});
app.all('/api/jsonp/:callback', (c) => {
	const { callback } = c.req.param();
	const json = getIpInfo(c);
	if (callback) {
		const jsonpResponse = `${callback}(${JSON.stringify(json)})`;
		c.header('Content-Type', 'application/javascript');
		return c.body(jsonpResponse);
	}
	return c.text('Callback parameter is required for JSONP', { status: 400 });
});

export default app;

function getIpInfo(c: Context): IpInfo {
	const cf = c.req.raw.cf as IncomingRequestCfProperties;
	return {
		ip: c.req.raw.headers.get('CF-Connecting-IP'),
		asn: cf.asn,
		colo: cf.colo,
		continent: cf.continent,
		country: cf.country,
		city: cf.city,
		isEUCountry: cf.isEUCountry,
		asOrganization: cf.asOrganization,
		longitude: cf.longitude,
		latitude: cf.latitude,
		postalCode: cf.postalCode,
		region: cf.region,
		regionCode: cf.regionCode,
		timezone: cf.timezone,
	};
}
