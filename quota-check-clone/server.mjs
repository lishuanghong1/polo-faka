import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const PUBLIC_DIR = path.join(CURRENT_DIR, "public");
const CURSOR_ORIGIN = "https://cursor.com";
const CURSOR_USAGE_URL =
  process.env.CURSOR_USAGE_SUMMARY_ENDPOINT || "https://cursor.com/api/usage-summary";
const CURSOR_ME_URL = process.env.CURSOR_ME_ENDPOINT || "https://cursor.com/api/auth/me";
const CURSOR_EVENTS_URL =
  process.env.CURSOR_USAGE_EVENTS_ENDPOINT ||
  "https://cursor.com/api/dashboard/get-filtered-usage-events";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 16 * 1024;
const EVENT_PAGE_SIZE = 500;
const MAX_EVENT_PAGES = 20;

const STATIC_ASSETS = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" }],
  ["/quota-check", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" }],
  ["/quota-check/", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8", cache: "no-cache" }],
  ["/favicon.svg", { file: "favicon.svg", type: "image/svg+xml", cache: "public, max-age=86400" }],
]);

/** 带 HTTP 状态码的可控业务错误，防止把上游细节直接暴露给页面。 */
export class QuotaCheckError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "QuotaCheckError";
    this.statusCode = statusCode;
  }
}

/**
 * 归一化用户粘贴的 Token，兼容完整 Cookie 和被 URL 编码的 :: 分隔符。
 * @param {unknown} raw 用户输入
 * @returns {string} 可用于 WorkosCursorSessionToken Cookie 的值
 */
export function normalizeToken(raw) {
  if (typeof raw !== "string") {
    throw new QuotaCheckError("请粘贴 Cursor Token");
  }

  let token = raw.trim();
  const cookieMatch = token.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/i);
  if (cookieMatch) token = cookieMatch[1].trim();
  token = token.replace(/%3A%3A/gi, "::");

  if (!token) throw new QuotaCheckError("请粘贴 Cursor Token");
  if (token.length > 8192) throw new QuotaCheckError("Token 长度异常");
  if (/[\r\n;]/.test(token)) throw new QuotaCheckError("Token 包含非法字符");

  const workosTokenPattern =
    /^user_[A-Za-z0-9_-]+::[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  if (!workosTokenPattern.test(token)) {
    throw new QuotaCheckError("Token 格式不正确，请粘贴 WorkosCursorSessionToken");
  }
  return token;
}

/** 把任意上游数值转成有限数字，空值和非法值统一返回 null。 */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 把 Cursor 的时间戳或日期文本统一转成 ISO 字符串。 */
function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  let candidate = value;
  if (typeof value === "string" && /^\d+$/.test(value)) candidate = Number(value);
  if (typeof candidate === "number" && candidate < 10_000_000_000) candidate *= 1000;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 把日期值转换成毫秒时间戳，无法解析时返回 null。 */
function toEpochMillis(value) {
  const iso = toIsoDate(value);
  return iso ? new Date(iso).getTime() : null;
}

/** 把美分格式化成美元文本，汇总保留两位、单条明细可保留四位。 */
function formatUsd(cents, digits = 2) {
  const value = toFiniteNumber(cents) ?? 0;
  return `$${(value / 100).toFixed(digits)}`;
}

/**
 * 归一化单个额度桶。优先采用 Cursor 返回的 used/remaining/percent，缺失时才推导。
 * @param {unknown} input Cursor 返回的 plan、onDemand 等对象
 */
export function normalizeUsageBucket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  let used = toFiniteNumber(input.used);
  let limit = toFiniteNumber(input.limit);
  let remaining = toFiniteNumber(input.remaining);

  if (used === null && limit !== null && remaining !== null) used = limit - remaining;
  if (remaining === null && limit !== null && used !== null) remaining = limit - used;
  if (limit === null && used !== null && remaining !== null) limit = used + remaining;

  const upstreamPercent = toFiniteNumber(input.totalPercentUsed ?? input.apiPercentUsed);
  const derivedPercent =
    used !== null && limit !== null && limit > 0 ? (used / limit) * 100 : null;

  return {
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    used: used === null ? null : Math.max(0, used),
    limit: limit === null ? null : Math.max(0, limit),
    remaining: remaining === null ? null : Math.max(0, remaining),
    percentUsed: upstreamPercent ?? derivedPercent,
  };
}

/** 将 usage-summary 响应裁剪成页面所需字段，避免把未知账户数据透传给浏览器。 */
export function normalizeUsageSummary(input) {
  const data = input && typeof input === "object" ? input : {};
  const individual = data.individualUsage && typeof data.individualUsage === "object"
    ? data.individualUsage
    : {};
  const team = data.teamUsage && typeof data.teamUsage === "object" ? data.teamUsage : null;

  return {
    membershipType: typeof data.membershipType === "string" ? data.membershipType : null,
    billingCycleStart: toIsoDate(data.billingCycleStart),
    billingCycleEnd: toIsoDate(data.billingCycleEnd),
    isUnlimited: Boolean(data.isUnlimited),
    individualUsage: {
      plan: normalizeUsageBucket(individual.plan),
      onDemand: normalizeUsageBucket(individual.onDemand),
    },
    teamUsage: team
      ? {
          plan: normalizeUsageBucket(team.plan ?? team),
          onDemand: normalizeUsageBucket(team.onDemand),
        }
      : null,
    queriedAt: new Date().toISOString(),
  };
}

/** 构造 Cursor 浏览器请求头，事件接口要求 Origin 与 Referer 同源。 */
function cursorHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Cookie: `WorkosCursorSessionToken=${encodeURIComponent(token)}`,
    Origin: CURSOR_ORIGIN,
    Referer: `${CURSOR_ORIGIN}/dashboard/usage`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  };
}

/** 请求并解析 Cursor JSON，统一处理鉴权失败与非 JSON 响应。 */
async function fetchCursorJson(url, token, options) {
  const response = await options.fetchImpl(url, {
    method: options.method ?? "GET",
    redirect: "error",
    signal: options.signal,
    headers: cursorHeaders(token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 || response.status === 403) {
    throw new QuotaCheckError("Token 已失效或无权查询", 401);
  }
  if (!response.ok) {
    throw new QuotaCheckError(`Cursor 服务暂时不可用（HTTP ${response.status}）`, 502);
  }

  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch {
    throw new QuotaCheckError("Cursor 返回了无法识别的数据", 502);
  }
}

/** 按账期分页拉取全部用量事件，最多读取 10000 条并标记是否截断。 */
async function fetchUsageEvents(token, billingCycle, options) {
  const rows = [];
  let upstreamTotal = 0;

  for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
    const body = { page, pageSize: EVENT_PAGE_SIZE };
    if (billingCycle.start !== null) body.startDate = String(billingCycle.start);
    if (billingCycle.end !== null) body.endDate = String(billingCycle.end);

    const data = await fetchCursorJson(CURSOR_EVENTS_URL, token, {
      ...options,
      method: "POST",
      body,
    });
    const pageRows = Array.isArray(data?.usageEventsDisplay) ? data.usageEventsDisplay : [];
    upstreamTotal = Number(data?.totalUsageEventsCount || pageRows.length);
    rows.push(...pageRows);

    if (pageRows.length < EVENT_PAGE_SIZE || rows.length >= upstreamTotal) break;
  }

  return { rows, truncated: rows.length < upstreamTotal, upstreamTotal };
}

/** 计算单次事件的总 Tokens，Cursor 没有直接给总数时按四类 Token 相加。 */
function eventTokenTotal(event) {
  const usage = event?.tokenUsage;
  if (!usage || typeof usage !== "object") return 0;
  const direct = toFiniteNumber(usage.totalTokens);
  if (direct !== null) return Math.max(0, direct);
  return ["inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens"]
    .map((key) => toFiniteNumber(usage[key]) ?? 0)
    .reduce((sum, value) => sum + value, 0);
}

/** 套餐卡的 API Tokens 口径排除 cacheWriteTokens，但包含输入、输出和缓存读取。 */
function eventMeteredTokenTotal(event) {
  const usage = event?.tokenUsage;
  if (!usage || typeof usage !== "object") return 0;
  return ["inputTokens", "outputTokens", "cacheReadTokens"]
    .map((key) => toFiniteNumber(usage[key]) ?? 0)
    .reduce((sum, value) => sum + value, 0);
}

/** 提取单次事件的模型成本；截图中的费用来自 tokenUsage.totalCents。 */
function eventCostCents(event) {
  return Math.max(
    0,
    toFiniteNumber(event?.tokenUsage?.totalCents) ??
      toFiniteNumber(event?.chargedCents) ??
      0,
  );
}

/** 账期接口返回的每条记录都计为一次请求；错误未计费事件按 0 Tokens/0 费用保留。 */
function isReportableEvent(event) {
  return Boolean(event && typeof event === "object" && event.timestamp);
}

/** Cursor 的 INCLUDED_IN_* 事件属于套餐内，其余有效事件按超额展示。 */
function isIncludedEvent(event) {
  return /^USAGE_EVENT_KIND_INCLUDED_IN_/i.test(String(event?.kind || ""));
}

/** Auto/Composer 事件单独归类；其它套餐内事件进入 API 用量。 */
function isAutoEvent(event) {
  const marker = `${event?.model || ""} ${event?.kind || ""}`.toLowerCase();
  return marker.includes("auto") || marker.includes("composer");
}

/** 将 Cursor 原始事件裁剪成前端明细行，移除用户 ID、会话 ID 等无关字段。 */
function normalizeEvent(event) {
  const timestamp = toFiniteNumber(event?.timestamp) ?? 0;
  const included = isIncludedEvent(event);
  const costCents = eventCostCents(event);
  return {
    timestamp,
    model: String(event?.model || "unknown"),
    kind: String(event?.kind || "unknown"),
    isOnDemand: !included,
    typeName: included ? "套餐内" : "超额",
    tokens: eventTokenTotal(event),
    meteredTokens: eventMeteredTokenTotal(event),
    costCents,
    costUsd: formatUsd(costCents, 4),
  };
}

/**
 * 把摘要、账户信息和账期事件聚合成与参考站点一致的报告结构。
 * 金额内部始终保留美分，只有展示字段转换成美元文本。
 */
export function buildQuotaReport(summaryInput, meInput, rawEvents, metadata = {}) {
  const summary = summaryInput && typeof summaryInput === "object" ? summaryInput : {};
  const me = meInput && typeof meInput === "object" ? meInput : {};
  const plan = summary?.individualUsage?.plan ?? {};
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .filter(isReportableEvent)
    .map(normalizeEvent)
    .sort((left, right) => right.timestamp - left.timestamp);

  const included = events.filter((event) => !event.isOnDemand);
  const onDemand = events.filter((event) => event.isOnDemand);
  const includedAuto = included.filter((event) => isAutoEvent(event));
  const includedApi = included.filter((event) => !isAutoEvent(event));
  const allAuto = events.filter((event) => isAutoEvent(event));
  const allApi = events.filter((event) => !isAutoEvent(event));
  const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const includedCostCents = sum(included, "costCents");
  const onDemandCostCents = sum(onDemand, "costCents");
  const totalCostCents = includedCostCents + onDemandCostCents;
  const membershipType = String(summary.membershipType || "unknown");
  const membershipKey = membershipType.toLowerCase();
  const planPrice = { pro: "$20/mo", pro_plus: "$60/mo", ultra: "$200/mo" }[membershipKey] ?? "-";
  const modelBreakdown = {};

  for (const event of events) {
    const current = modelBreakdown[event.model] ?? { costCents: 0, tokens: 0, requests: 0 };
    current.costCents += event.costCents;
    current.tokens += event.tokens;
    current.requests += 1;
    modelBreakdown[event.model] = current;
  }

  return {
    success: true,
    email: typeof me.email === "string" ? me.email : "",
    name: typeof me.name === "string" ? me.name : "",
    membershipType,
    isUnlimited: Boolean(summary.isUnlimited),
    billingCycle: {
      startDateEpochMillis: String(toEpochMillis(summary.billingCycleStart) ?? ""),
      endDateEpochMillis: String(toEpochMillis(summary.billingCycleEnd) ?? ""),
    },
    includedAmountCents: toFiniteNumber(plan.limit) ?? 0,
    includedAmountUsd: formatUsd(plan.limit),
    includedLimitCents: toFiniteNumber(plan.limit) ?? 0,
    includedLimitUsd: formatUsd(plan.limit),
    totalCostCents,
    totalCostUsd: formatUsd(totalCostCents),
    totalRequests: events.length,
    totalTokens: sum(events, "tokens"),
    includedCostCents,
    includedCostUsd: formatUsd(includedCostCents),
    includedCount: included.length,
    onDemandCostCents,
    onDemandCostUsd: formatUsd(onDemandCostCents),
    onDemandCount: onDemand.length,
    onDemandTokens: sum(onDemand, "tokens"),
    apiPercentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
    autoPercentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
    totalPercentUsed: toFiniteNumber(plan.totalPercentUsed) ?? 0,
    includedBreakdown: {
      api: {
        costCents: sum(includedApi, "costCents"),
        costUsd: formatUsd(sum(includedApi, "costCents")),
        percentUsed: toFiniteNumber(plan.apiPercentUsed) ?? 0,
        tokens: sum(allApi, "meteredTokens"),
      },
      auto: {
        costCents: sum(includedAuto, "costCents"),
        costUsd: formatUsd(sum(includedAuto, "costCents")),
        percentUsed: toFiniteNumber(plan.autoPercentUsed) ?? 0,
        tokens: sum(allAuto, "meteredTokens"),
      },
    },
    modelBreakdown,
    planInfo: {
      planName: membershipType,
      includedAmountCents: toFiniteNumber(plan.limit) ?? 0,
      price: planPrice,
      billingCycleEnd: String(toEpochMillis(summary.billingCycleEnd) ?? ""),
    },
    events,
    eventsTruncated: Boolean(metadata.truncated),
    upstreamEventCount: Number(metadata.upstreamTotal || events.length),
    queriedAt: new Date().toISOString(),
  };
}

/** 请求 Cursor 官方摘要、账户与账期事件；注入 fetchImpl 便于完全隔离网络测试。 */
export async function queryCursorUsage(rawToken, options = {}) {
  const token = normalizeToken(rawToken);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestOptions = { fetchImpl, signal: controller.signal };
    const summary = await fetchCursorJson(CURSOR_USAGE_URL, token, requestOptions);
    const billingCycle = {
      start: toEpochMillis(summary.billingCycleStart),
      end: toEpochMillis(summary.billingCycleEnd),
    };
    const [me, eventResult] = await Promise.all([
      fetchCursorJson(CURSOR_ME_URL, token, requestOptions).catch(() => ({})),
      fetchUsageEvents(token, billingCycle, requestOptions),
    ]);

    return buildQuotaReport(summary, me, eventResult.rows, {
      truncated: eventResult.truncated,
      upstreamTotal: eventResult.upstreamTotal,
    });
  } catch (error) {
    if (error instanceof QuotaCheckError) throw error;
    if (error?.name === "AbortError") {
      throw new QuotaCheckError("查询超时，请稍后重试", 504);
    }
    throw new QuotaCheckError("无法连接 Cursor 服务，请稍后重试", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** 读取并解析小体积 JSON 请求体，避免公开接口被超大请求拖垮。 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new QuotaCheckError("请求内容过大", 413);
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new QuotaCheckError("请求格式不正确");
  }
}

/** 统一发送 JSON，所有响应均禁止缓存，避免 Token 查询结果进入中间缓存。 */
function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

/** 仅按白名单提供静态资源，不把用户路径直接拼到文件系统路径。 */
async function serveStatic(request, response, pathname) {
  const asset = STATIC_ASSETS.get(pathname);
  if (!asset) return false;

  const body = await readFile(path.join(PUBLIC_DIR, asset.file));
  response.writeHead(200, {
    "Content-Type": asset.type,
    "Content-Length": body.length,
    "Cache-Control": asset.cache,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
  return true;
}

/** 创建 HTTP 请求处理器，可注入查询函数以进行无网络集成测试。 */
export function createRequestHandler(options = {}) {
  const usageQuery = options.usageQuery ?? queryCursorUsage;

  return async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    try {
      if (request.method === "POST" && url.pathname === "/api/quota-check") {
        const body = await readJsonBody(request);
        const result = await usageQuery(body.token);
        sendJson(response, 200, { success: true, data: result });
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") &&
          await serveStatic(request, response, url.pathname)) {
        return;
      }

      sendJson(response, 404, { success: false, error: "页面不存在" });
    } catch (error) {
      const statusCode = error instanceof QuotaCheckError ? error.statusCode : 500;
      const message = error instanceof QuotaCheckError ? error.message : "服务器内部错误";
      if (statusCode >= 500) console.error(`[额度查询] ${message}`);
      sendJson(response, statusCode, { success: false, error: message });
    }
  };
}

/** 启动仅监听本机的服务；显式设置 HOST=0.0.0.0 后才允许局域网访问。 */
export function startServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT || 4173);
  const server = createServer(createRequestHandler(options));

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`[额度查询] 服务已启动：http://${host}:${actualPort}/quota-check`);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILE) {
  await startServer();
}
