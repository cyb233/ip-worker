export interface DnsQuestion {
  name: string;
  type: number;
}

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsJsonResponse {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: DnsQuestion[];
  Answer: DnsAnswer[];
  Authority: DnsAnswer[];
  Additional: DnsAnswer[];
}
