const DNS_HEADER_LENGTH = 12;
const MAX_NAME_POINTER_DEPTH = 20;
const DNS_CLASS_IN = 1;
const DNS_TYPE_OPT = 41;
const DNS_TYPE_SOA = 6;
const DO_BIT_MASK = 0x8000;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const RECORD_TYPE_MAP: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  CAA: 257,
  SVCB: 64,
  HTTPS: 65,
};

const RECORD_TYPE_NAMES = new Map<number, string>(Object.entries(RECORD_TYPE_MAP).map(([name, code]) => [code, name]));

export interface DnsQuestionRecord {
  name: string;
  type: number;
  class: number;
}

export interface SoaRecordData {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

export interface DnsResourceRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  dataLength: number;
  data: string;
  parsedData?: SoaRecordData;
}

export interface DnsMessage {
  id: number;
  flags: number;
  qr: boolean;
  opcode: number;
  aa: boolean;
  tc: boolean;
  rd: boolean;
  ra: boolean;
  ad: boolean;
  cd: boolean;
  rcode: number;
  questions: DnsQuestionRecord[];
  answers: DnsResourceRecord[];
  authorities: DnsResourceRecord[];
  additionals: DnsResourceRecord[];
  raw: Uint8Array;
}

export function parseDnsMessage(input: Uint8Array | ArrayBuffer): DnsMessage {
  const raw = toUint8Array(input);
  if (raw.byteLength < DNS_HEADER_LENGTH) {
    throw new Error('DNS message is too short');
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const id = view.getUint16(0);
  const flags = view.getUint16(2);
  const questionCount = view.getUint16(4);
  const answerCount = view.getUint16(6);
  const authorityCount = view.getUint16(8);
  const additionalCount = view.getUint16(10);

  let offset = DNS_HEADER_LENGTH;
  const questions: DnsQuestionRecord[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    const nameResult = readName(raw, offset);
    offset = nameResult.offset;
    ensureRange(raw, offset, 4, 'DNS question is truncated');
    questions.push({
      name: nameResult.name,
      type: view.getUint16(offset),
      class: view.getUint16(offset + 2),
    });
    offset += 4;
  }

  const answers = parseResourceRecords(raw, offset, answerCount);
  offset = answers.offset;
  const authorities = parseResourceRecords(raw, offset, authorityCount);
  offset = authorities.offset;
  const additionals = parseResourceRecords(raw, offset, additionalCount);
  offset = additionals.offset;

  if (offset > raw.byteLength) {
    throw new Error('DNS message is truncated');
  }

  return {
    id,
    flags,
    qr: (flags & 0x8000) !== 0,
    opcode: (flags >> 11) & 0x0f,
    aa: (flags & 0x0400) !== 0,
    tc: (flags & 0x0200) !== 0,
    rd: (flags & 0x0100) !== 0,
    ra: (flags & 0x0080) !== 0,
    ad: (flags & 0x0020) !== 0,
    cd: (flags & 0x0010) !== 0,
    rcode: flags & 0x000f,
    questions,
    answers: answers.records,
    authorities: authorities.records,
    additionals: additionals.records,
    raw,
  };
}

export function validateDnsQuery(input: Uint8Array | ArrayBuffer): DnsMessage {
  const message = parseDnsMessage(input);
  if (message.qr) {
    throw new Error('DNS query must not be a response');
  }
  if (message.questions.length < 1) {
    throw new Error('DNS query must contain at least one question');
  }
  return message;
}

export function validateDnsResponse(query: DnsMessage, input: Uint8Array | ArrayBuffer): DnsMessage {
  const response = parseDnsMessage(input);
  if (!response.qr) {
    throw new Error('DNS response must have the QR flag set');
  }
  if (response.id !== query.id) {
    throw new Error('DNS response transaction ID does not match the query');
  }
  if (response.questions.length !== query.questions.length) {
    throw new Error('DNS response question count does not match the query');
  }
  for (let index = 0; index < query.questions.length; index += 1) {
    const requestQuestion = query.questions[index];
    const responseQuestion = response.questions[index];
    if (
      !responseQuestion ||
      requestQuestion.type !== responseQuestion.type ||
      requestQuestion.class !== responseQuestion.class ||
      requestQuestion.name.toLowerCase() !== responseQuestion.name.toLowerCase()
    ) {
      throw new Error('DNS response question does not match the query');
    }
  }
  return response;
}

export function normalizeDomainName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('DNS name is required');
  }

  if (trimmed === '.') {
    return '.';
  }

  const labels = trimmed.replace(/\.+$/, '').split('.');
  if (labels.length === 0) {
    throw new Error('DNS name is invalid');
  }

  let totalLength = 1;
  const normalizedLabels = labels.map((label) => {
    if (!label || label.length > 63) {
      throw new Error('DNS label length is invalid');
    }
    totalLength += label.length + 1;
    return label.toLowerCase();
  });

  if (totalLength > 255) {
    throw new Error('DNS name is too long');
  }

  return `${normalizedLabels.join('.')}.`;
}

export function resolveRecordType(value: string | undefined): number {
  if (!value) {
    return RECORD_TYPE_MAP.A;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return RECORD_TYPE_MAP.A;
  }

  if (/^\d+$/.test(trimmed)) {
    const code = Number.parseInt(trimmed, 10);
    if (code < 1 || code > 65535) {
      throw new Error('DNS type code is out of range');
    }
    return code;
  }

  const code = RECORD_TYPE_MAP[trimmed.toUpperCase()];
  if (!code) {
    throw new Error(`Unsupported DNS type: ${trimmed}`);
  }
  return code;
}

export function typeCodeToName(value: number): string {
  return RECORD_TYPE_NAMES.get(value) || String(value);
}

export function parseBinaryFlag(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '') {
    return false;
  }
  if (value === '0') {
    return false;
  }
  if (value === '1') {
    return true;
  }
  throw new Error(`${name} must be 0 or 1`);
}

export function buildDnsQuery(options: {
  id?: number;
  name: string;
  type: number;
  cd?: boolean;
  dnssecOk?: boolean;
}): Uint8Array {
  const id = options.id ?? 0;
  const name = normalizeDomainName(options.name);
  const questionName = encodeDomainName(name);
  const question = new Uint8Array(questionName.length + 4);
  question.set(questionName, 0);
  const questionView = new DataView(question.buffer);
  questionView.setUint16(questionName.length, options.type);
  questionView.setUint16(questionName.length + 2, DNS_CLASS_IN);

  const additional = new Uint8Array(11);
  const additionalView = new DataView(additional.buffer);
  additionalView.setUint8(0, 0);
  additionalView.setUint16(1, DNS_TYPE_OPT);
  additionalView.setUint16(3, 1232);
  additionalView.setUint32(5, options.dnssecOk ? DO_BIT_MASK : 0);
  additionalView.setUint16(9, 0);

  const header = new Uint8Array(DNS_HEADER_LENGTH);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, id & 0xffff);
  headerView.setUint16(2, 0x0100 | (options.cd ? 0x0010 : 0));
  headerView.setUint16(4, 1);
  headerView.setUint16(6, 0);
  headerView.setUint16(8, 0);
  headerView.setUint16(10, 1);

  const output = new Uint8Array(header.length + question.length + additional.length);
  output.set(header, 0);
  output.set(question, header.length);
  output.set(additional, header.length + question.length);
  return output;
}

export function getTransactionId(input: Uint8Array | ArrayBuffer): number {
  const raw = toUint8Array(input);
  ensureRange(raw, 0, 2, 'DNS message is too short');
  return (raw[0] << 8) | raw[1];
}

export function zeroTransactionId(input: Uint8Array | ArrayBuffer): Uint8Array {
  const raw = new Uint8Array(toUint8Array(input));
  ensureRange(raw, 0, 2, 'DNS message is too short');
  raw[0] = 0;
  raw[1] = 0;
  return raw;
}

export function withTransactionId(input: Uint8Array | ArrayBuffer, id: number): Uint8Array {
  const raw = new Uint8Array(toUint8Array(input));
  ensureRange(raw, 0, 2, 'DNS message is too short');
  raw[0] = (id >> 8) & 0xff;
  raw[1] = id & 0xff;
  return raw;
}

export function encodeBase64Url(input: Uint8Array | ArrayBuffer): string {
  const raw = toUint8Array(input);
  let binary = '';
  for (const byte of raw) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  let binary: string;
  try {
    binary = atob(normalized + padding);
  } catch {
    throw new Error('Invalid base64url DNS message');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeDomainName(name: string): Uint8Array {
  if (name === '.') {
    return new Uint8Array([0]);
  }

  const normalized = normalizeDomainName(name);
  const labels = normalized.slice(0, -1).split('.');
  const chunks: number[] = [];
  for (const label of labels) {
    const encoded = encoder.encode(label);
    chunks.push(encoded.length);
    chunks.push(...encoded);
  }
  chunks.push(0);
  return Uint8Array.from(chunks);
}

export function readName(input: Uint8Array | ArrayBuffer, offset: number): { name: string; offset: number } {
  const raw = toUint8Array(input);
  const labels: string[] = [];
  let cursor = offset;
  let finalOffset = offset;
  let jumped = false;
  let depth = 0;

  while (true) {
    ensureRange(raw, cursor, 1, 'DNS name is truncated');
    const length = raw[cursor];

    if ((length & 0xc0) === 0xc0) {
      ensureRange(raw, cursor, 2, 'DNS compression pointer is truncated');
      const pointer = ((length & 0x3f) << 8) | raw[cursor + 1];
      if (pointer >= raw.length) {
        throw new Error('DNS compression pointer is out of range');
      }
      if (!jumped) {
        finalOffset = cursor + 2;
      }
      cursor = pointer;
      jumped = true;
      depth += 1;
      if (depth > MAX_NAME_POINTER_DEPTH) {
        throw new Error('DNS name compression pointer depth exceeded');
      }
      continue;
    }

    if ((length & 0xc0) !== 0) {
      throw new Error('DNS name contains an invalid label length');
    }

    cursor += 1;
    if (length === 0) {
      if (!jumped) {
        finalOffset = cursor;
      }
      break;
    }

    ensureRange(raw, cursor, length, 'DNS name label is truncated');
    labels.push(decoder.decode(raw.subarray(cursor, cursor + length)));
    cursor += length;
    if (!jumped) {
      finalOffset = cursor;
    }
  }

  return {
    name: labels.length === 0 ? '.' : `${labels.join('.')}.`,
    offset: finalOffset,
  };
}

function parseResourceRecords(
  raw: Uint8Array,
  initialOffset: number,
  count: number,
): { records: DnsResourceRecord[]; offset: number } {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const records: DnsResourceRecord[] = [];
  let offset = initialOffset;

  for (let index = 0; index < count; index += 1) {
    const nameResult = readName(raw, offset);
    offset = nameResult.offset;
    ensureRange(raw, offset, 10, 'DNS resource record header is truncated');

    const type = view.getUint16(offset);
    const klass = view.getUint16(offset + 2);
    const ttl = view.getUint32(offset + 4);
    const dataLength = view.getUint16(offset + 8);
    offset += 10;
    ensureRange(raw, offset, dataLength, 'DNS resource record data is truncated');

    const data = decodeRecordData(raw, offset, type, dataLength);
    records.push({
      name: nameResult.name,
      type,
      class: klass,
      ttl,
      dataLength,
      data: data.value,
      parsedData: data.soa,
    });

    offset += dataLength;
  }

  return { records, offset };
}

function decodeRecordData(
  raw: Uint8Array,
  offset: number,
  type: number,
  dataLength: number,
): { value: string; soa?: SoaRecordData } {
  switch (type) {
    case 1:
      return { value: decodeIpv4(raw, offset, dataLength) };
    case 2:
    case 5:
    case 12:
      return { value: readName(raw, offset).name };
    case 6:
      return decodeSoa(raw, offset, dataLength);
    case 15:
      return { value: decodeMx(raw, offset, dataLength) };
    case 16:
      return { value: decodeTxt(raw, offset, dataLength) };
    case 28:
      return { value: decodeIpv6(raw, offset, dataLength) };
    case 33:
      return { value: decodeSrv(raw, offset, dataLength) };
    case 41:
      return { value: '' };
    case 64:
    case 65:
      return { value: decodeSvcb(raw, offset, dataLength) };
    case 257:
      return { value: decodeCaa(raw, offset, dataLength) };
    default:
      return { value: bytesToHex(raw.subarray(offset, offset + dataLength)) };
  }
}

function decodeIpv4(raw: Uint8Array, offset: number, dataLength: number): string {
  if (dataLength !== 4) {
    throw new Error('Invalid A record length');
  }
  return Array.from(raw.subarray(offset, offset + 4)).join('.');
}

function decodeIpv6(raw: Uint8Array, offset: number, dataLength: number): string {
  if (dataLength !== 16) {
    throw new Error('Invalid AAAA record length');
  }

  const groups: number[] = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push((raw[offset + index] << 8) | raw[offset + index + 1]);
  }

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= groups.length; index += 1) {
    const value = groups[index];
    if (index < groups.length && value === 0) {
      if (currentStart === -1) {
        currentStart = index;
        currentLength = 1;
      } else {
        currentLength += 1;
      }
    } else if (currentStart !== -1) {
      if (currentLength > bestLength && currentLength > 1) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
      currentStart = -1;
      currentLength = 0;
    }
  }

  const parts: string[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    if (bestLength > 1 && index >= bestStart && index < bestStart + bestLength) {
      if (index === bestStart) {
        parts.push('');
      }
      if (index === bestStart + bestLength - 1) {
        parts.push('');
      }
      continue;
    }
    parts.push(groups[index].toString(16));
  }

  const formatted = parts.join(':');
  return formatted === ':' ? '::' : formatted.replace(/:{3,}/, '::');
}

function decodeMx(raw: Uint8Array, offset: number, dataLength: number): string {
  ensureRange(raw, offset, dataLength, 'MX record is truncated');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const preference = view.getUint16(offset);
  const exchange = readName(raw, offset + 2).name;
  return `${preference} ${exchange}`;
}

function decodeTxt(raw: Uint8Array, offset: number, dataLength: number): string {
  const end = offset + dataLength;
  const parts: string[] = [];
  let cursor = offset;
  while (cursor < end) {
    const length = raw[cursor];
    cursor += 1;
    ensureRange(raw, cursor, length, 'TXT record is truncated');
    parts.push(decoder.decode(raw.subarray(cursor, cursor + length)));
    cursor += length;
  }
  return parts.join('');
}

function decodeSoa(
  raw: Uint8Array,
  offset: number,
  dataLength: number,
): { value: string; soa: SoaRecordData } {
  const mname = readName(raw, offset);
  const rname = readName(raw, mname.offset);
  ensureRange(raw, rname.offset, 20, 'SOA record is truncated');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const serial = view.getUint32(rname.offset);
  const refresh = view.getUint32(rname.offset + 4);
  const retry = view.getUint32(rname.offset + 8);
  const expire = view.getUint32(rname.offset + 12);
  const minimum = view.getUint32(rname.offset + 16);

  const end = rname.offset + 20;
  if (end !== offset + dataLength) {
    throw new Error('SOA record length is invalid');
  }

  const soa = { mname: mname.name, rname: rname.name, serial, refresh, retry, expire, minimum };
  return {
    value: `${soa.mname} ${soa.rname} ${serial} ${refresh} ${retry} ${expire} ${minimum}`,
    soa,
  };
}

function decodeSrv(raw: Uint8Array, offset: number, dataLength: number): string {
  ensureRange(raw, offset, dataLength, 'SRV record is truncated');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const priority = view.getUint16(offset);
  const weight = view.getUint16(offset + 2);
  const port = view.getUint16(offset + 4);
  const target = readName(raw, offset + 6).name;
  return `${priority} ${weight} ${port} ${target}`;
}

function decodeCaa(raw: Uint8Array, offset: number, dataLength: number): string {
  ensureRange(raw, offset, dataLength, 'CAA record is truncated');
  const flags = raw[offset];
  const tagLength = raw[offset + 1];
  ensureRange(raw, offset + 2, tagLength, 'CAA tag is truncated');
  const tag = decoder.decode(raw.subarray(offset + 2, offset + 2 + tagLength));
  const valueOffset = offset + 2 + tagLength;
  const valueLength = dataLength - 2 - tagLength;
  ensureRange(raw, valueOffset, valueLength, 'CAA value is truncated');
  const value = decoder.decode(raw.subarray(valueOffset, valueOffset + valueLength));
  return `${flags} ${tag} ${JSON.stringify(value)}`;
}

function decodeSvcb(raw: Uint8Array, offset: number, dataLength: number): string {
  ensureRange(raw, offset, dataLength, 'SVCB record is truncated');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const priority = view.getUint16(offset);
  const target = readName(raw, offset + 2);
  let cursor = target.offset;
  const end = offset + dataLength;
  const params: string[] = [];

  while (cursor < end) {
    ensureRange(raw, cursor, 4, 'SVCB parameter is truncated');
    const key = view.getUint16(cursor);
    const valueLength = view.getUint16(cursor + 2);
    cursor += 4;
    ensureRange(raw, cursor, valueLength, 'SVCB parameter value is truncated');
    const value = bytesToHex(raw.subarray(cursor, cursor + valueLength));
    params.push(`${key}=${value}`);
    cursor += valueLength;
  }

  return [String(priority), target.name, ...params].join(' ').trim();
}

function bytesToHex(raw: Uint8Array): string {
  return Array.from(raw, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ensureRange(raw: Uint8Array, offset: number, length: number, message: string): void {
  if (offset < 0 || length < 0 || offset + length > raw.byteLength) {
    throw new Error(message);
  }
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}
