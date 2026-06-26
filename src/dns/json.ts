import { DnsMessage, DnsResourceRecord } from './packet';
import { DnsAnswer, DnsJsonResponse } from '../models';

export function toDnsJsonResponse(message: DnsMessage): DnsJsonResponse {
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
    Answer: toJsonRecords(message.answers),
    Authority: toJsonRecords(message.authorities),
    Additional: toJsonRecords(message.additionals.filter((record) => record.type !== 41)),
  };
}

function toJsonRecords(records: DnsResourceRecord[]): DnsAnswer[] {
  return records.map((record) => ({
    name: record.name,
    type: record.type,
    TTL: record.ttl,
    data: record.data,
  }));
}
