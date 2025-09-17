/**
 * 对象转 XML 字符串
 */
function toXml(obj: Record<string, any>): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<root>`;
  xml += objectToXml(obj);
  xml += '</root>';
  return xml;
}

/**
 * 递归对象转 XML
 */
function objectToXml(obj: Record<string, any>): string {
  let xml = '';
  for (const key in obj) {
    const value = obj[key];
    if (value === null || value === undefined) {
      xml += `<${key}/>`;
    } else if (Array.isArray(value)) {
      xml += `<${key}>`;
      for (const item of value) {
        xml += `<item>${typeof item === 'object' ? objectToXml(item) : escapeXml(String(item))}</item>`;
      }
      xml += `</${key}>`;
    } else if (typeof value === 'object') {
      xml += `<${key}>${objectToXml(value)}</${key}>`;
    } else {
      xml += `<${key}>${escapeXml(String(value))}</${key}>`;
    }
  }
  return xml;
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

export { toXml };
