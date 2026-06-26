import { Hono, Context } from 'hono';
import { IpInfo, IpApiResponse } from '../models';
import { toXml } from '../utils';

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
  const resp = await fetch(
    `http://ip-api.com/json/${ip}?fields=status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query`,
    {
      headers: {
        'User-Agent':
          c.req.raw.headers.get('User-Agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      },
    },
  );

  if (!resp.ok) {
    throw new Error(`IP query failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json<IpApiResponse>();

  return {
    ip: data.query,
    asn: data.as,
    colo: undefined,
    continent: data.continentCode,
    country: data.countryCode,
    city: data.city,
    isEUCountry: undefined,
    asOrganization: data.asname,
    longitude: data.lon,
    latitude: data.lat,
    postalCode: data.zip,
    region: data.regionName,
    regionCode: data.region,
    timezone: data.timezone,
    userAgent: c.req.raw.headers.get('User-Agent'),

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
