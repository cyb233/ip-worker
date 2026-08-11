import { DnsJsonResponse, DnsRecord } from '@/models';
import { DnsMessage, DnsResourceRecord } from './packet';

const DNS_TYPE_OPT = 41;

export function toDnsJsonResponse(message: DnsMessage): DnsJsonResponse {
  const answer = toJsonRecords(message.answers);
  const authority = toJsonRecords(message.authorities);
  const additional = toJsonRecords(message.additionals.filter((record) => record.type !== DNS_TYPE_OPT));

  return {
    Status: message.rcode,
    TC: message.tc,
    RD: message.rd,
    RA: message.ra,
    AD: message.ad,
    CD: message.cd,
    Question: message.questions.map((question) => ({
      name: question.name,
      type: question.type,
    })),
    ...(answer.length > 0 ? { Answer: answer } : {}),
    ...(authority.length > 0 ? { Authority: authority } : {}),
    ...(additional.length > 0 ? { Additional: additional } : {}),
  };
}

function toJsonRecords(records: DnsResourceRecord[]): DnsRecord[] {
  return records.map((record) => ({
    name: record.name,
    type: record.type,
    TTL: record.ttl,
    data: record.data,
  }));
}
