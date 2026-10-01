import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Injectable, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { CursorUsageService } from '../src/modules/cursor-quota/cursor-usage.service';
import { UsageCheckModule } from '../src/modules/usage-check/usage-check.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Isolate each HTTP case's IP counter while exercising the real throttler.
@Injectable()
class TestThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.headers['x-test-ip'] || req.ip;
  }
}

@Module({
  imports: [
    UsageCheckModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TestThrottlerGuard },
  ],
})
class TestModule {}

const token = 'user_http_test::header.payload.signature';
const realFetch = globalThis.fetch;
const officialRequests: Array<{ url: string; init: RequestInit }> = [];
const logMessages: string[] = [];
let app: NestExpressApplication;
let origin: string;
let requestNumber = 0;

const billingStart = 1_760_486_400_000;
const billingEnd = billingStart + 30 * 24 * 60 * 60 * 1000;
const summary = {
  membershipType: 'pro',
  billingCycleStart: new Date(billingStart).toISOString(),
  billingCycleEnd: new Date(billingEnd).toISOString(),
  individualUsage: {
    plan: {
      used: 400, limit: 2000, remaining: 1600, totalPercentUsed: 7.5,
      apiPercentUsed: 15, autoPercentUsed: 5,
    },
    onDemand: { used: 125 },
  },
  privateToken: token,
};
const events = [
  {
    timestamp: billingStart + 1000,
    model: 'claude-opus',
    kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO',
    tokenUsage: { totalCents: 100, totalTokens: 200 },
    privateToken: token,
  },
  {
    timestamp: billingStart + 2000,
    model: 'auto',
    kind: 'USAGE_EVENT_KIND_USAGE_BASED',
    tokenUsage: { totalCents: 125, totalTokens: 300 },
  },
  {
    timestamp: billingStart + 3000,
    model: 'composer-2',
    kind: 'USAGE_EVENT_KIND_FREE_CREDIT',
    chargedCents: 50,
    tokenUsage: { totalCents: 40, totalTokens: 100 },
  },
];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function officialResponse(url: string): Response {
  if (url.endsWith('/api/usage-summary')) return jsonResponse(summary);
  if (url.endsWith('/api/auth/me')) {
    return jsonResponse({ email: 'buyer@example.com', name: 'Buyer', token, cookie: token });
  }
  if (url.endsWith('/api/dashboard/get-filtered-usage-events')) {
    return jsonResponse({ usageEventsDisplay: events, totalUsageEventsCount: events.length });
  }
  if (url.endsWith('/api/dashboard/get-aggregated-usage-events')) {
    return jsonResponse({
      totalCostCents: 400,
      aggregations: [{ modelIntent: 'claude-opus', totalCents: 400 }],
      token,
    });
  }
  throw new Error('Unexpected upstream endpoint');
}

function mockOfficial(
  response: (url: string, init: RequestInit) => Response | Promise<Response> = officialResponse,
) {
  officialRequests.length = 0;
  logMessages.length = 0;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    assert.equal(new URL(url).origin, 'https://cursor.com');
    officialRequests.push({ url, init });
    return response(url, init);
  }) as typeof fetch;
}

async function post(body: unknown, tracker = `case-${++requestNumber}`) {
  const response = await realFetch(`${origin}/api/usage-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Ip': tracker, Connection: 'close' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(text.includes(token), false, 'Response must not echo the session credential');
  assert.equal(logMessages.join('\n').includes(token), false, 'Logs must not echo credentials');
  return { status: response.status, body: JSON.parse(text) };
}

before(async () => {
  app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  (app.get(CursorUsageService) as any).logger.warn = (message: string) => logMessages.push(message);
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});

after(async () => {
  globalThis.fetch = realFetch;
  await app?.close();
});

test('anonymous HTTP query returns a trimmed report in the global envelope without a database', async () => {
  mockOfficial();
  assert.throws(() => app.get(PrismaService), /does not exist/);
  const result = await post({ token });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  const report = result.body.data;
  assert.equal(report.success, true);
  assert.equal(report.email, 'buyer@example.com');
  assert.equal(report.membershipType, 'pro');
  assert.equal(report.includedLimitCents, 2000);
  assert.equal(report.totalPercentUsed, 20);
  assert.equal(report.planUsedCents, 400);
  assert.equal(report.planRemainingCents, 1600);
  assert.equal(report.officialTotalPercentUsed, 7.5);
  assert.equal(report.officialPlanCents, 400);
  assert.equal(report.officialOnDemandCents, 125);
  assert.equal(report.officialTotalCents, 525);
  assert.equal(report.freeCreditCents, 50);
  assert.equal(report.totalCostCents, 575);
  assert.equal(report.totalRequests, 3);
  assert.equal(report.totalTokens, 600);
  assert.deepEqual(report.billingCycle, {
    startDateEpochMillis: String(billingStart), endDateEpochMillis: String(billingEnd),
  });
  assert.equal(report.events.length, 3);
  assert.equal(report.events[0].typeName, '赠送金');
  assert.equal(report.modelBreakdown['claude-opus'].costCents, 400);
  assert.ok(report.queriedAt);
  assert.equal(officialRequests.length, 4);
  for (const request of officialRequests) {
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers.Cookie, `WorkosCursorSessionToken=${encodeURIComponent(token)}`);
    assert.equal(request.init.redirect, 'error');
    assert.ok(request.init.signal);
  }
  const eventRequest = officialRequests.find((r) => r.url.includes('get-filtered'));
  assert.deepEqual(JSON.parse(String(eventRequest?.init.body)), {
    page: 1, pageSize: 500, startDate: String(billingStart), endDate: String(billingEnd),
  });
  const aggregationRequest = officialRequests.find((r) => r.url.includes('get-aggregated'));
  assert.deepEqual(JSON.parse(String(aggregationRequest?.init.body)), {
    teamId: -1, startDate: billingStart, endDate: billingEnd,
  });
});

test('Cookie and URL encoded token inputs normalize before contacting Cursor', async () => {
  for (const submitted of [
    `  ${token.replace('::', '%3A%3A')}  `,
    `other=value; WorkosCursorSessionToken=${token.replace('::', '%3A%3A')}; another=1`,
  ]) {
    mockOfficial();
    assert.equal((await post({ token: submitted })).status, 200);
    assert.equal((officialRequests[0].init.headers as Record<string, string>).Cookie,
      `WorkosCursorSessionToken=${encodeURIComponent(token)}`);
  }
});

test('DTO rejects missing, empty, non-string, long and unexpected input before upstream requests', async () => {
  for (const body of [
    {}, { token: '' }, { token: null }, { token: 123 }, { token: [token] },
    { token: { value: token } }, { token: 'x'.repeat(8193) }, { token, email: 'buyer@example.com' },
  ]) {
    mockOfficial();
    const result = await post(body);
    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(result.body.success, false);
    assert.equal(result.body.data, null);
    assert.equal(officialRequests.length, 0);
  }
});

test('invalid format and line breaks never reach Cursor', async () => {
  for (const submitted of ['  ', 'not-a-cursor-token', `${token}\r\nInjected: value`, `${token};bad=1`]) {
    mockOfficial();
    const result = await post({ token: submitted });
    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(officialRequests.length, 0);
  }
});

test('expired or forbidden Cursor session returns a safe 401', async () => {
  for (const status of [401, 403]) {
    mockOfficial(() => jsonResponse({ error: token }, status));
    const result = await post({ token });
    assert.equal(result.status, 401);
    assert.match(result.body.error, /Token 已失效/);
    assert.equal(officialRequests.length, 1);
  }
});

test('upstream overload and server errors return a retriable 503', async () => {
  for (const status of [429, 500, 503]) {
    mockOfficial(() => jsonResponse({ error: token }, status));
    const result = await post({ token });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /Cursor 服务繁忙/);
  }
});

test('malformed upstream data returns a safe 502', async () => {
  mockOfficial(() => new Response(`<html>${token}</html>`, { status: 200 }));
  const result = await post({ token });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /无法识别的数据/);
});

test('network failure returns 502 without logging an upstream message containing the token', async () => {
  mockOfficial(() => { throw new Error(`network failure: ${token}`); });
  const result = await post({ token });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /无法连接 Cursor/);
  assert.deepEqual(logMessages, ['Cursor usage service connection failed']);
});

test('timed out official fetch is aborted and returns 504', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timeoutMs = Number(process.env.CURSOR_QUOTA_TIMEOUT_MS || 45_000);
  globalThis.setTimeout = ((callback: any, delay: number, ...args: any[]) =>
    originalSetTimeout(callback, delay === timeoutMs ? 5 : delay, ...args)) as typeof setTimeout;
  let aborted = false;
  try {
    mockOfficial((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const result = await post({ token });
    assert.equal(result.status, 504);
    assert.match(result.body.error, /查询超时/);
    assert.equal(aborted, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('optional aggregation failure falls back without exposing raw error messages', async () => {
  mockOfficial((url) => {
    if (url.includes('get-aggregated')) throw new Error(`upstream detail ${token}`);
    return officialResponse(url);
  });
  const result = await post({ token });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.officialPlanCents, 100);
  assert.equal(result.body.data.officialOnDemandCents, 125);
  assert.deepEqual(logMessages, ['Cursor aggregated usage unavailable; falling back to event totals']);
});

test('public endpoint enforces five requests per minute and disables caching for throttling errors', async () => {
  mockOfficial();
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post({ token: 'invalid' }, 'rate-limit-case')).status, 400);
  }
  const result = await post({ token }, 'rate-limit-case');
  assert.equal(result.status, 429);
  assert.equal(result.body.success, false);
  assert.equal(result.body.data, null);
  assert.equal(officialRequests.length, 0);
});

test('multiple quota pools preserve official raw amounts and percentages without changing billing', () => {
  const report = new CursorUsageService().buildReport({
    membershipType: 'ultra',
    individualUsage: {
      plan: {
        used: 30531, limit: 40000, remaining: 9469,
        breakdown: { included: 30531, bonus: 0, total: 30531 },
        autoPercentUsed: 1.8366666667, apiPercentUsed: 100,
        totalPercentUsed: 9.39415384615,
      },
      onDemand: { used: 0 },
    },
  }, {}, []);
  assert.equal(report.planUsedCents, 30531);
  assert.equal(report.planRemainingCents, 9469);
  assert.equal(report.officialTotalPercentUsed, 9.39415384615);
  assert.equal(report.apiPercentUsed, 100);
  assert.equal(report.autoPercentUsed, 1.8366666667);
  // Existing amount-based account health and billing retain their original values.
  assert.equal(report.totalPercentUsed, 76.3275);
  assert.equal(report.includedLimitCents, 40000);
  assert.equal(report.officialPlanCents, 30531);
  assert.equal(report.totalCostCents, 30531);
});

test('official fields distinguish zero usage from omitted or invalid upstream values', () => {
  const service = new CursorUsageService();
  for (const plan of [{}, { used: 'invalid', remaining: Infinity, totalPercentUsed: '' }]) {
    const report = service.buildReport({ individualUsage: { plan } }, {}, []);
    assert.equal(report.planUsedCents, null);
    assert.equal(report.planRemainingCents, null);
    assert.equal(report.officialTotalPercentUsed, null);
  }
  const emptyReport = service.buildReport({ individualUsage: {
    plan: { used: 0, limit: 2000, remaining: 2000, totalPercentUsed: 0 },
  } }, {}, []);
  assert.equal(emptyReport.planUsedCents, 0);
  assert.equal(emptyReport.planRemainingCents, 2000);
  assert.equal(emptyReport.officialTotalPercentUsed, 0);
  const stringReport = service.buildReport({ individualUsage: {
    plan: { used: '12.5', remaining: '87.5', totalPercentUsed: '1.25' },
  } }, {}, []);
  assert.equal(stringReport.planUsedCents, 12.5);
  assert.equal(stringReport.planRemainingCents, 87.5);
  assert.equal(stringReport.officialTotalPercentUsed, 1.25);
});
