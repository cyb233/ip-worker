export interface IpInfo {
  ip: string | null;
  asn: number | undefined;
  colo: string | undefined;
  continent: ContinentCode | string | undefined;
  country: Iso3166Alpha2Code | 'T1' | string | undefined;
  city: string | undefined;
  isEUCountry: '1' | undefined;
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
 * ipwho.is API 响应实体
 * https://ipwho.is/
 */
export interface IpWhoisResponse {
  /** 查询的 IP 地址 */
  ip: string;

  /** 请求是否成功 */
  success: boolean;

  /** IP 类型，例如 IPv4 或 IPv6 */
  type: string;

  /** 所在洲名称 */
  continent: string;

  /** 洲代码（ISO） */
  continent_code: string;

  /** 国家名称 */
  country: string;

  /** 国家代码（ISO 3166-1 alpha-2） */
  country_code: string;

  /** 州 / 省 / 地区名称 */
  region: string;

  /** 州 / 省 / 地区代码 */
  region_code: string;

  /** 城市 */
  city: string;

  /** 纬度 */
  latitude: number;

  /** 经度 */
  longitude: number;

  /** 是否属于欧盟国家 */
  is_eu: boolean;

  /** 邮政编码 */
  postal: string;

  /** 国家电话区号 */
  calling_code: string;

  /** 国家首都 */
  capital: string;

  /** 邻国代码列表（逗号分隔） */
  borders: string;

  /** 国旗信息 */
  flag: IpWhoisFlag;

  /** 网络连接信息 */
  connection: IpWhoisConnection;

  /** 时区信息 */
  timezone: IpWhoisTimezone;
}

/**
 * 国旗信息
 */
export interface IpWhoisFlag {
  /** 国旗图片 URL */
  img: string;

  /** 国旗 emoji */
  emoji: string;

  /** emoji Unicode 编码 */
  emoji_unicode: string;
}

/**
 * ASN / 网络信息
 */
export interface IpWhoisConnection {
  /** 自治系统编号 (ASN) */
  asn: number;

  /** ASN 所属组织 */
  org: string;

  /** ISP 服务提供商 */
  isp: string;

  /** 相关域名 */
  domain: string;
}

/**
 * 时区信息
 */
export interface IpWhoisTimezone {
  /** 时区 ID */
  id: string;

  /** 时区缩写 */
  abbr: string;

  /** 是否为夏令时 */
  is_dst: boolean;

  /** UTC 偏移（秒） */
  offset: number;

  /** UTC 偏移（字符串格式） */
  utc: string;
}
