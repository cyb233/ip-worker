export interface IpInfo {
  ip: string | null;
  asn: string | number | undefined;
  colo: string | undefined;
  continent: ContinentCode | string | undefined;
  country: Iso3166Alpha2Code | 'T1' | string | undefined;
  city: string | undefined;
  isEUCountry: boolean | '1' | undefined;
  asOrganization: string | undefined;
  longitude: string | number | undefined;
  latitude: string | number | undefined;
  postalCode: string | undefined;
  region: string | undefined;
  regionCode: string | undefined;
  timezone: string | undefined;
  userAgent: string | null;

  raw: string;
}

/**
 * ip-api API 响应实体
 * https://ip-api.com/
 */
export interface IpApiResponse {
  // IP used for the query
  query: string;
  // success or fail
  status: 'success' | 'fail';
  // included only when status is fail, Can be one of the following: private range, reserved range, invalid query
  message: string | undefined;
  // Continent name
  continent: string;
  // Two-letter continent code
  continentCode: string;
  // Country name
  country: string;
  // Two-letter country code ISO 3166-1 alpha-2
  countryCode: string;
  // Region/state short code (FIPS or ISO)
  region: string;
  // Region/state
  regionName: string;
  // City
  city: string;
  // District (subdivision of city)
  district: string;
  // Zip code
  zip: string;
  // Latitude
  lat: number;
  // Longitude
  lon: number;
  // Timezone (tz)
  timezone: string;
  // Timezone UTC DST offset in seconds
  offset: number;
  // National currency
  currency: string;
  // ISP name
  isp: string;
  // Organization name
  org: string;
  // AS number and organization, separated by space (RIR). Empty for IP blocks not being announced in BGP tables.
  as: string;
  // AS name (RIR). Empty for IP blocks not being announced in BGP tables.
  asname: string;
  // Reverse DNS of the IP (can delay response)
  reverse: string;
  // Mobile (cellular) connection
  mobile: boolean;
  // 	Proxy, VPN or Tor exit address
  proxy: boolean;
  // Hosting, colocated or data center
  hosting: boolean;
}
