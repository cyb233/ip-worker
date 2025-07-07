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

interface IpInfo {
	ip: string | null
	asn: number | undefined
	continent: ContinentCode | undefined
	country: Iso3166Alpha2Code | "T1" | undefined
	asOrganization: string | undefined
	longitude: string | undefined
	latitude: string | undefined
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)
		const format = url.searchParams.get("format")
		const callback = url.searchParams.get("callback")
		const cf = (request as Request).cf as IncomingRequestCfProperties | undefined
		const json: IpInfo = {
			ip: request.headers.get('CF-Connecting-IP'),
			asn: cf?.asn,
			continent: cf?.continent,
			country: cf?.country,
			asOrganization: cf?.asOrganization,
			longitude: cf?.longitude,
			latitude: cf?.latitude
		}
		console.log(json)
		switch (format) {
			case 'json':
				return new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json' } })
			case 'xml':
				return new Response(toXml(json), { headers: { 'Content-Type': 'application/xml' } })
			case 'jsonp':
				if (callback) {
					const jsonpResponse = `${callback}(${JSON.stringify(json)})`
					return new Response(jsonpResponse, { headers: { 'Content-Type': 'application/javascript' } })
				}
				return new Response("Callback parameter is required for JSONP", { status: 400 })
			case 'text':
			default:
				return new Response(json.ip ?? '', { headers: { 'Content-Type': 'text/plain' } })
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * 对象转 XML 字符串
 */
function toXml(obj: Record<string, any>): string {
	let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<root>`
	xml += objectToXml(obj)
	xml += '</root>'
	return xml
}

/**
 * 递归对象转 XML
 */
function objectToXml(obj: Record<string, any>): string {
	let xml = ''
	for (const key in obj) {
		const value = obj[key]
		if (value === null || value === undefined) {
			xml += `<${key}/>`
		} else if (Array.isArray(value)) {
			xml += `<${key}>`
			for (const item of value) {
				xml += `<item>${typeof item === 'object' ? objectToXml(item) : escapeXml(String(item))}</item>`
			}
			xml += `</${key}>`
		} else if (typeof value === 'object') {
			xml += `<${key}>${objectToXml(value)}</${key}>`
		} else {
			xml += `<${key}>${escapeXml(String(value))}</${key}>`
		}
	}
	return xml
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(unsafe: string): string {
	return unsafe.replace(/[<>&'"]/g, function (c) {
		switch (c) {
			case '<': return '&lt;'
			case '>': return '&gt;'
			case '&': return '&amp;'
			case '\'': return '&apos;'
			case '"': return '&quot;'
			default: return c
		}
	})
}
