import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateModelRevenue,
  calculateModelUsage,
  classifyCursorModel,
  normalizeModelList,
  parseModelList,
} from '../src/modules/cursor-quota/model-pricing';
import { CursorUsageService } from '../src/modules/cursor-quota/cursor-usage.service';
import { reportToAccountUpdate } from '../src/modules/cursor-quota/usage-mapper';

test('模型列表会去空并忽略大小写去重', () => {
  assert.deepEqual(normalizeModelList([' Claude-4 ', 'claude-4', '', 'Auto']), [
    'Claude-4',
    'Auto',
  ]);
  assert.deepEqual(parseModelList('["gpt-5","auto"]'), ['gpt-5', 'auto']);
  assert.deepEqual(parseModelList('gpt-5\nauto,composer'), ['gpt-5', 'auto', 'composer']);
});

test('显式分类覆盖默认 Auto/Composer 命名规则', () => {
  const settings = {
    premiumModels: ['composer-special'],
    autoModels: ['gpt-5'],
  };
  assert.equal(classifyCursorModel('composer-special', settings), 'PREMIUM');
  assert.equal(classifyCursorModel('GPT-5', settings), 'AUTO');
  assert.equal(classifyCursorModel('auto-select', settings), 'AUTO');
  assert.equal(classifyCursorModel('claude-4', settings), 'PREMIUM');
});

test('按模型分类拆分消耗并分别计算收益', () => {
  const usage = calculateModelUsage(
    {
      'claude-4': { costCents: 250, tokens: 1000, requests: 2 },
      'auto-select': { costCents: 150, tokens: 500, requests: 1 },
    },
    400,
    { premiumModels: ['claude-4'], autoModels: ['auto-select'] },
  );
  assert.equal(usage.premiumCostCents, 250);
  assert.equal(usage.autoCostCents, 150);
  assert.equal(usage.hasDetailedUsage, true);
  assert.deepEqual(calculateModelRevenue(usage, 3, 1.5), {
    premiumSoldAmount: 7.5,
    autoSoldAmount: 2.25,
    soldAmount: 9.75,
  });
});

test('旧账号没有模型明细时全部沿用高级模型计价', () => {
  const usage = calculateModelUsage(null, 325, {
    premiumModels: [],
    autoModels: [],
  });
  assert.equal(usage.premiumCostCents, 325);
  assert.equal(usage.autoCostCents, 0);
  assert.equal(usage.hasDetailedUsage, false);
});

test('分类收益只对总额舍入一次并把尾差分配到 Auto', () => {
  assert.deepEqual(
    calculateModelRevenue({ premiumCostCents: 1, autoCostCents: 1 }, 1.5, 1.5),
    {
      premiumSoldAmount: 0.01,
      autoSoldAmount: 0.02,
      soldAmount: 0.03,
    },
  );
});

test('额度报告把上游小数美分量化为数据库可存储的整数', () => {
  const report = new CursorUsageService().buildReport(
    {
      membershipType: 'pro',
      individualUsage: { plan: { limit: 2000.5 } },
    },
    {},
    [
      {
        timestamp: Date.now(),
        model: 'claude-4',
        kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO',
        tokenUsage: { totalCents: 125.5, totalTokens: 100 },
      },
    ],
  );
  assert.equal(report.totalCostCents, 126);
  assert.equal(report.includedLimitCents, 2001);
  assert.equal(report.modelBreakdown['claude-4'].costCents, 125.5);
});

test('多条小数美分先汇总再取整，不逐条丢失金额', () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    timestamp: Date.now() + index,
    model: 'claude-4',
    kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO',
    tokenUsage: { totalCents: 0.49, totalTokens: 1 },
  }));
  const report = new CursorUsageService().buildReport({}, {}, events);
  assert.equal(report.totalCostCents, 49);
  assert.equal(report.includedCostCents, 49);
  assert.ok(Math.abs(report.modelBreakdown['claude-4'].costCents - 49) < 1e-9);
});

test('模型保留原始小数成本，分类后再计算不同售价', () => {
  const report = new CursorUsageService().buildReport(
    {},
    {},
    [
      {
        timestamp: 1,
        model: 'premium-a',
        tokenUsage: { totalCents: 0.3 },
      },
      {
        timestamp: 2,
        model: 'premium-b',
        tokenUsage: { totalCents: 0.3 },
      },
      {
        timestamp: 3,
        model: 'auto',
        tokenUsage: { totalCents: 0.4 },
      },
    ],
  );
  const usage = calculateModelUsage(report.modelBreakdown, report.totalCostCents, {
    premiumModels: ['premium-a', 'premium-b'],
    autoModels: ['auto'],
  });
  assert.ok(Math.abs(usage.premiumCostCents - 0.6) < 1e-9);
  assert.ok(Math.abs(usage.autoCostCents - 0.4) < 1e-9);
  assert.deepEqual(calculateModelRevenue(usage, 100, 1), {
    premiumSoldAmount: 0.6,
    autoSoldAmount: 0,
    soldAmount: 0.6,
  });
});

test('零用量百分比保持为 0 并判定为正常账号', () => {
  const update = reportToAccountUpdate({
    totalPercentUsed: 0,
    isUnlimited: false,
    billingCycle: { startDateEpochMillis: '', endDateEpochMillis: '' },
    membershipType: 'pro',
    includedCostCents: 0,
    includedLimitCents: 2000,
    onDemandCostCents: 0,
    totalCostCents: 0,
  } as any);
  assert.equal(update.planPercent, 0);
  assert.equal(update.accountStatus, 'HEALTHY');
});

test('事件分页被截断时拒绝生成不完整收益', async () => {
  const service = new CursorUsageService() as any;
  service.fetchJson = async () => ({
    billingCycleStart: Date.now(),
    billingCycleEnd: Date.now() + 1000,
  });
  service.fetchEvents = async () => ({
    rows: [],
    truncated: true,
    upstreamTotal: 10_001,
  });
  await assert.rejects(
    () => service.queryReport('user_test::a.b.c'),
    /无法完整计算模型收益/,
  );
});
