import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  QuotaCheckError,
  buildQuotaReport,
  createRequestHandler,
  normalizeToken,
  normalizeUsageBucket,
  normalizeUsageSummary,
  queryCursorUsage,
} from "../server.mjs";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyX3Rlc3QifQ.signature";
const TOKEN = `user_test::${JWT}`;

test("normalizeToken 兼容 URL 编码分隔符和完整 Cookie", () => {
  assert.equal(normalizeToken(`user_test%3A%3A${JWT}`), TOKEN);
  assert.equal(normalizeToken(`foo=bar; WorkosCursorSessionToken=${TOKEN}; theme=light`), TOKEN);
});

test("normalizeToken 拒绝非法格式和换行注入", () => {
  assert.throws(() => normalizeToken("bad-token"), QuotaCheckError);
  assert.throws(() => normalizeToken(`${TOKEN}\r\nX-Test: injected`), /非法字符/);
});

test("normalizeUsageBucket 优先上游字段并补齐缺失值", () => {
  assert.deepEqual(normalizeUsageBucket({ used: 7.5, limit: 20, totalPercentUsed: 38 }), {
    enabled: true,
    used: 7.5,
    limit: 20,
    remaining: 12.5,
    percentUsed: 38,
  });
  assert.deepEqual(normalizeUsageBucket({ limit: 20, remaining: 4 }), {
    enabled: true,
    used: 16,
    limit: 20,
    remaining: 4,
    percentUsed: 80,
  });
});

test("normalizeUsageSummary 只返回页面所需的归一化字段", () => {
  const result = normalizeUsageSummary({
    membershipType: "pro",
    billingCycleStart: 1_767_225_600,
    billingCycleEnd: "2026-02-01T00:00:00.000Z",
    individualUsage: {
      plan: { used: 5, limit: 20, remaining: 15 },
      onDemand: { enabled: false, used: 0, limit: 0, remaining: 0 },
    },
    privateUnknownField: "不会透传",
  });

  assert.equal(result.membershipType, "pro");
  assert.equal(result.billingCycleStart, "2026-01-01T00:00:00.000Z");
  assert.equal(result.individualUsage.plan.percentUsed, 25);
  assert.equal("privateUnknownField" in result, false);
});

test("buildQuotaReport 按事件类型汇总，并保留错误未计费请求", () => {
  const report = buildQuotaReport(
    {
      membershipType: "pro",
      billingCycleStart: "2026-07-16T00:00:00.000Z",
      billingCycleEnd: "2026-08-16T00:00:00.000Z",
      individualUsage: {
        plan: { limit: 2000, apiPercentUsed: 80, autoPercentUsed: 0, totalPercentUsed: 54.7 },
      },
    },
    { email: "test@example.com", name: "测试账户" },
    [
      {
        timestamp: "1002",
        model: "claude-test",
        kind: "USAGE_EVENT_KIND_FREE_CREDIT",
        tokenUsage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 30, cacheReadTokens: 40, totalCents: 125.5 },
      },
      {
        timestamp: "1001",
        model: "claude-test",
        kind: "USAGE_EVENT_KIND_INCLUDED_IN_PRO",
        tokenUsage: { inputTokens: 5, outputTokens: 15, totalCents: 50 },
      },
      {
        timestamp: "1000",
        model: "claude-test",
        kind: "USAGE_EVENT_KIND_ERRORED_NOT_CHARGED",
      },
    ],
  );

  assert.equal(report.totalRequests, 3);
  assert.equal(report.totalTokens, 120);
  assert.equal(report.includedCount, 1);
  assert.equal(report.onDemandCount, 2);
  assert.equal(report.totalCostCents, 175.5);
  assert.equal(report.modelBreakdown["claude-test"].requests, 3);
  assert.equal(report.includedBreakdown.api.tokens, 90);
  assert.equal(report.events[0].typeName, "超额");
});

test("queryCursorUsage 查询三类上游数据且不在结果中回传 Token", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    let data;
    if (url.endsWith("/api/usage-summary")) {
      data = {
        membershipType: "pro",
        billingCycleStart: "2026-07-16T00:00:00.000Z",
        billingCycleEnd: "2026-08-16T00:00:00.000Z",
        individualUsage: { plan: { limit: 2000, apiPercentUsed: 100, totalPercentUsed: 68.4 } },
      };
    } else if (url.endsWith("/api/auth/me")) {
      data = { email: "test@example.com", name: "测试账户" };
    } else {
      data = {
        totalUsageEventsCount: 1,
        usageEventsDisplay: [{
          timestamp: "1784254746105",
          model: "claude-test",
          kind: "USAGE_EVENT_KIND_FREE_CREDIT",
          tokenUsage: { inputTokens: 4, outputTokens: 6, totalCents: 25 },
        }],
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };

  const result = await queryCursorUsage(TOKEN, { fetchImpl, timeoutMs: 100 });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init.headers.Cookie, `WorkosCursorSessionToken=${encodeURIComponent(TOKEN)}`);
  assert.equal(requests[2].init.headers.Origin, "https://cursor.com");
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    page: 1,
    pageSize: 500,
    startDate: "1784160000000",
    endDate: "1786838400000",
  });
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(result.email, "test@example.com");
  assert.equal(result.totalRequests, 1);
  assert.equal(result.onDemandCount, 1);
});

test("HTTP 服务返回页面并遵守额度查询响应契约", async () => {
  const usageQuery = async () => ({
    membershipType: "pro",
    totalRequests: 2,
    totalTokens: 120,
    events: [],
  });
  const server = createServer(createRequestHandler({ usageQuery }));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const pageResponse = await fetch(`${baseUrl}/quota-check`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("content-type"), /^text\/html/);
    assert.match(await pageResponse.text(), /Cursor 额度查询/);

    const apiResponse = await fetch(`${baseUrl}/api/quota-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    const payload = await apiResponse.json();
    assert.equal(apiResponse.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.totalRequests, 2);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
