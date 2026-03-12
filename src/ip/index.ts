import { Hono, Context } from 'hono';
import { IpInfo, IpWhoisResponse } from '@/models';
import { toXml } from '@/utils';

export const app = new Hono();

app.all('/ip', async (c) => {
  const { ip, format = 'json', callback } = c.req.query();
  const data = await queryIpInfo(c, ip);
  return getIpResp(c, data, format, callback);
});
app.all('/ip/:ip', async (c) => {
  const { ip } = c.req.param();
  const { format = 'json', callback } = c.req.query();
  const data = await queryIpInfo(c, ip);
  return getIpResp(c, data, format, callback);
});
app.all('/ip/:ip/:format/:callback?', async (c) => {
  const { ip, format = 'json', callback } = c.req.param();
  const data = await queryIpInfo(c, ip);
  return getIpResp(c, data, format, callback);
});

app.all('/', (c) => {
  const { format, callback } = c.req.query();
  const data = getIpInfo(c);
  return getIpResp(c, data, format, callback);
});
app.all('/:format/:callback?', (c) => {
  const { format, callback } = c.req.param();
  const data = getIpInfo(c);
  return getIpResp(c, data, format, callback);
});

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
    userAgent: c.req.raw.headers.get('User-Agent'),

    raw: JSON.stringify(cf),
  };
}

async function queryIpInfo(c: Context, ip: string): Promise<IpInfo> {
  const ua = c.req.raw.headers.get('User-Agent') ?? '';
  const resp = await fetch(`https://ipwho.is/${ip}`, {
    method: 'GET',
    headers: {
      'User-Agent': ua,
    },
  });

  if (!resp.ok) {
    throw new Error('IP query failed');
  }

  const data = await resp.json<IpWhoisResponse>();

  return {
    ip: data.ip,
    asn: data.connection?.asn,
    colo: undefined,
    asOrganization: data.connection?.org,
    continent: data.continent,
    country: data.country_code,
    city: data.city,
    isEUCountry: data.is_eu ? '1' : undefined,
    latitude: data.latitude,
    longitude: data.longitude,
    postalCode: data.postal,
    region: data.region,
    regionCode: data.region_code,
    timezone: data.timezone.id,
    userAgent: ua,

    raw: JSON.stringify(data),
  };
}
function getIpResp(c: Context, data: IpInfo, format: string, callback?: string): Response {
  console.log('data:', data, 'format:', format, 'callback:', callback);
  switch (format) {
    case 'json':
      return c.json(data);
    case 'xml':
      c.header('Content-Type', 'application/xml');
      return c.body(toXml(data));
    case 'jsonp':
      if (callback) {
        const jsonpResponse = `${callback}(${JSON.stringify(data)})`;
        c.header('Content-Type', 'application/javascript');
        return c.body(jsonpResponse);
      }
      return c.text('Callback parameter is required for JSONP', { status: 400 });
    case 'text':
    default:
      return c.text(data.ip ?? '');
  }
}
