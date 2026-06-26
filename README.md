# IP Worker

基于 **Cloudflare Workers** 与 **Hono** 的边缘服务，当前提供两类能力：

- **IP 查询 API**：获取访问者 IP 信息，或查询指定 IP 的地理/运营商数据
- **DNS over HTTPS (DoH) API**：提供标准 DoH 接口与便于调试的 JSON 解析接口

项目同时带有静态说明页面，便于直接在线查看接口示例。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcyb233%2Fip-worker)

## 功能概览

### 1. IP 查询

- 获取访问者当前 IP
- 获取 Cloudflare `request.cf` 提供的地理与网络信息
- 查询指定 IP 的归属地、ASN、时区等信息
- 支持 `text`、`json`、`xml`、`jsonp` 四种输出格式

### 2. DNS over HTTPS

- 支持标准 RFC 8484 风格的 `GET /dns-query`
- 支持 `POST /dns-query` + `application/dns-message`
- 提供 `GET /resolve` 的 JSON 解析接口
- 支持通过环境变量配置上游 DoH、超时和缓存 TTL
- 支持边缘缓存与负缓存

### 3. 静态演示页面

- `/`：项目主页与 IP 接口说明
- `/dns`：DoH 接口说明页
- `/webrtc`：WebRTC 获取 IP 的演示页

## 技术栈

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Hono](https://hono.dev/)
- TypeScript
- Vitest
- Wrangler

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

默认会启动 Wrangler 本地开发服务，通常可通过 `http://localhost:8787` 访问。

### 运行测试

```bash
npm test
```

### 生成 Cloudflare 类型

```bash
npm run cf-typegen
```

### 部署

```bash
npm run deploy
```

## 路由说明

### IP 查询接口

Worker 将 IP 查询路由挂载在 `/api` 下。

#### 查询访问者 IP

> 默认输出格式：`text`

| 路径 | 说明 |
| --- | --- |
| `/api` | 获取访问者 IP，默认返回纯文本 |
| `/api/text` | 纯文本返回访问者 IP |
| `/api/json` | JSON 返回访问者信息 |
| `/api/xml` | XML 返回访问者信息 |
| `/api/jsonp/<callback>` | JSONP 返回访问者信息 |
| `/api?format=json` | 使用查询参数指定返回格式 |
| `/api?format=jsonp&callback=fn` | 使用查询参数指定 JSONP 回调 |

#### 查询指定 IP

> 默认输出格式：`json`

| 路径 | 说明 |
| --- | --- |
| `/api/ip/8.8.8.8` | 查询指定 IP，默认返回 JSON |
| `/api/ip/8.8.8.8/json` | JSON 返回指定 IP 信息 |
| `/api/ip/8.8.8.8/xml` | XML 返回指定 IP 信息 |
| `/api/ip/8.8.8.8/jsonp/callbackName` | JSONP 返回指定 IP 信息 |
| `/api/ip?ip=8.8.8.8&format=json` | 使用查询参数查询指定 IP |

#### 支持的返回格式

- `text`：仅返回 IP 字符串
- `json`：返回 JSON 对象
- `xml`：返回 XML 文档
- `jsonp`：返回 JSONP，需要 `callback`

#### 返回字段示例

```json
{
  "ip": "8.8.8.8",
  "asn": "AS15169",
  "colo": "HKG",
  "continent": "NA",
  "country": "US",
  "city": "Mountain View",
  "isEUCountry": false,
  "asOrganization": "GOOGLE",
  "longitude": -122.084,
  "latitude": 37.386,
  "postalCode": "94043",
  "region": "California",
  "regionCode": "CA",
  "timezone": "America/Los_Angeles",
  "userAgent": "Mozilla/5.0 ...",
  "raw": "{...}"
}
```

#### 字段来源说明

- **访问者 IP 查询**：来自 Cloudflare Workers 的 `request.cf`
- **指定 IP 查询**：来自第三方 IP 数据接口 [ip-api.com](https://ip-api.com/)

## DNS over HTTPS 接口

### 1. 标准 DoH：`/dns-query`

支持 `GET` 和 `POST` 两种调用方式。

#### GET

使用 `dns` 参数传入 **base64url 编码后的 DNS wire message**：

```text
/dns-query?dns=AAABAAABAAAAAAAAA2RucwdleGFtcGxlA2NvbQAAAQAB
```

#### POST

请求头必须为：

```http
Content-Type: application/dns-message
Accept: application/dns-message
```

请求体为原始 DNS wire message。

### 2. JSON 解析接口：`/resolve`

适合脚本调用、联调与调试。

#### 示例

```text
/resolve?name=example.com&type=A
/resolve?name=cloudflare.com&type=AAAA
/resolve?name=example.com&type=MX&do=1
```

#### 支持的查询参数

| 参数 | 说明 |
| --- | --- |
| `name` | 必填，域名 |
| `type` | 记录类型，默认 `A` |
| `cd` | 是否设置 Checking Disabled 标志，`0` / `1` |
| `do` | 是否请求 DNSSEC 记录，`0` / `1` |

#### JSON 返回示例

```json
{
  "Status": 0,
  "TC": false,
  "RD": true,
  "RA": true,
  "AD": false,
  "CD": false,
  "Question": [
    { "name": "example.com.", "type": 1 }
  ],
  "Answer": [
    { "name": "example.com.", "type": 1, "TTL": 300, "data": "93.184.216.34" }
  ],
  "Authority": [],
  "Additional": []
}
```

### 3. 响应头

DNS 接口会附带以下调试/缓存头：

| Header | 说明 |
| --- | --- |
| `X-DNS-Cache` | 缓存状态：`HIT` / `MISS` / `BYPASS` |
| `X-DNS-Cache-TTL` | 当前响应使用的缓存 TTL |
| `X-DoH-Upstream` | 当前使用的上游 DoH 主机 |

## 环境变量配置

项目在 [wrangler.jsonc](wrangler.jsonc) 中预置了 DoH 相关配置：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `DOH_UPSTREAM_URL` | `https://cloudflare-dns.com/dns-query` | 上游 DoH 服务地址 |
| `DOH_TIMEOUT_MS` | `5000` | 上游请求超时时间，单位毫秒 |
| `DOH_CACHE_ENABLED` | `1` | 是否启用缓存 |
| `DOH_CACHE_MIN_TTL` | `0` | 缓存 TTL 下限 |
| `DOH_CACHE_MAX_TTL` | `86400` | 缓存 TTL 上限 |
| `DOH_CACHE_NEGATIVE_MAX_TTL` | `300` | 负缓存 TTL 上限 |

对应配置示例：

```jsonc
"vars": {
  "DOH_UPSTREAM_URL": "https://cloudflare-dns.com/dns-query",
  "DOH_TIMEOUT_MS": "5000",
  "DOH_CACHE_ENABLED": "1",
  "DOH_CACHE_MIN_TTL": "0",
  "DOH_CACHE_MAX_TTL": "86400",
  "DOH_CACHE_NEGATIVE_MAX_TTL": "300"
}
```

## 项目结构

```text
.
├─ public/          # 静态页面与前端演示资源
├─ src/
│  ├─ dns/          # DoH、DNS 报文解析、缓存、上游请求
│  ├─ ip/           # IP 查询接口
│  ├─ models/       # 数据模型定义
│  ├─ config.ts     # DoH 环境变量解析
│  └─ index.ts      # Worker 入口
├─ test/            # Vitest 测试
├─ wrangler.jsonc   # Cloudflare Worker 配置
└─ README.md
```

## 已覆盖测试

当前测试覆盖的核心行为包括：

- `GET /dns-query` 与 `POST /dns-query`
- DNS 缓存复用
- `/resolve` JSON 返回
- 错误参数与错误状态码
- 上游异常与超时处理
- 旧版 `/api` IP 路由兼容性
- 负缓存 TTL 逻辑

## 注意事项

- 指定 IP 查询依赖 `ip-api.com`，其可用性与限制受第三方服务影响
- `DOH_UPSTREAM_URL` 必须使用 `https`
- `DOH_CACHE_MIN_TTL` 不能大于 `DOH_CACHE_MAX_TTL`
- JSONP 模式必须显式提供 `callback`

## 相关文件

- 入口文件：[src/index.ts](src/index.ts)
- IP 接口：[src/ip/index.ts](src/ip/index.ts)
- DNS 接口：[src/dns/index.ts](src/dns/index.ts)
- DoH 配置解析：[src/config.ts](src/config.ts)
- 测试文件：[test/index.spec.ts](test/index.spec.ts)

## License

如需开源发布，建议补充项目许可证说明。当前仓库未在 README 中声明 License。 
