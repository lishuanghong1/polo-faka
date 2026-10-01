<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { queryCursorUsage, type QuotaReport, type UsageEvent } from '@/api/usage-check';

const activeTab = ref<'query' | 'billing'>('query');
const rawToken = ref('');
const premiumOnly = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const report = ref<QuotaReport | null>(null);
const selectedModel = ref('');
const selectedType = ref('');
const startDate = ref('');
const endDate = ref('');
const page = ref(1);
const pageSize = ref(20);
let requestId = 0;
let controller: AbortController | null = null;

const membershipNames: Record<string, string> = {
  free: 'Free', free_trial: 'Free Trial', pro: 'Pro', pro_plus: 'Pro+',
  ultra: 'Ultra', business: 'Business', team: 'Team', enterprise: 'Enterprise',
};
const membershipName = computed(() => {
  const membership = report.value?.membershipType || '';
  return membershipNames[membership.toLowerCase()] || membership || '未知会员';
});

function normalizedToken(value: string): string {
  let token = value.trim();
  const cookie = token.match(/(?:^|;\s*)WorkosCursorSessionToken=([^;]+)/i);
  if (cookie) token = cookie[1].trim();
  return token.replace(/%3A%3A/gi, '::');
}

function tokenError(value: string): string {
  if (!value) return '请先粘贴 Cursor Token。';
  if (value.length > 8192) return 'Token 长度异常，请重新复制 WorkosCursorSessionToken 的值。';
  if (!/^user_[A-Za-z0-9_-]+::[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return 'Token 格式不正确，请复制完整的 WorkosCursorSessionToken（user_…::…）。';
  }
  return '';
}

function resetFilters() {
  selectedModel.value = '';
  selectedType.value = '';
  startDate.value = '';
  endDate.value = '';
  page.value = 1;
}

// Changing the input invalidates the last account and any outstanding response.
watch(rawToken, () => {
  requestId += 1;
  controller?.abort();
  controller = null;
  loading.value = false;
  report.value = null;
  errorMessage.value = '';
  resetFilters();
}, { flush: 'sync' });

function queryError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.error;
    if (status === 401 || status === 403) return 'Token 已失效或没有查询权限，请重新登录 Cursor 后复制新的 Token。';
    if (status === 429) return '查询过于频繁，请等待一分钟后重试。';
    if (status === 504 || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return '查询超时，请稍后重试。账期记录较多时，查询可能需要更长时间。';
    }
    if ((status === 400 || status === 422) && typeof message === 'string') return message;
    if (status && status >= 500) return 'Cursor 查询服务暂时不可用，请稍后重试。';
    if (!error.response) return '连接失败，请检查网络后重试。';
  }
  return '查询失败，请稍后重试。';
}

async function submitQuery() {
  if (loading.value) return;
  report.value = null;
  errorMessage.value = '';
  const token = normalizedToken(rawToken.value);
  const validationError = tokenError(token);
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }

  const id = ++requestId;
  const activeController = new AbortController();
  controller = activeController;
  loading.value = true;
  resetFilters();
  try {
    const result = await queryCursorUsage(token, activeController.signal);
    if (id !== requestId || activeController.signal.aborted) return;
    report.value = result;
  } catch (error) {
    if (id !== requestId || activeController.signal.aborted) return;
    errorMessage.value = queryError(error);
  } finally {
    if (id === requestId) {
      loading.value = false;
      controller = null;
    }
  }
}

function cancelQuery() {
  requestId += 1;
  controller?.abort();
  controller = null;
  loading.value = false;
}

function clearToken() {
  cancelQuery();
  rawToken.value = '';
  report.value = null;
  errorMessage.value = '';
}

function handleShortcut(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submitQuery();
  }
}

onBeforeUnmount(cancelQuery);

function money(cents: number, digits = 2): string {
  return `$${((Number.isFinite(cents) ? cents : 0) / 100).toFixed(digits)}`;
}

function count(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Number.isFinite(value) ? value : 0);
}

function tokens(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return count(value);
}

function percent(value: number): string {
  return `${Math.max(0, Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

function progressWidth(value: number): string {
  return `${Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))}%`;
}

function timestamp(value: string | number): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  const millis = Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : Date.parse(String(value));
  return Number.isFinite(millis) && Number.isFinite(new Date(millis).getTime()) ? millis : null;
}

function dateText(value: string | number, withTime = false): string {
  const millis = timestamp(value);
  if (millis === null) return '—';
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false } : {}),
  };
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(millis));
}

const billingCycle = computed(() => {
  const cycle = report.value?.billingCycle;
  return cycle ? `${dateText(cycle.startDateEpochMillis)} — ${dateText(cycle.endDateEpochMillis)}` : '—';
});
const hasQuota = computed(() => (report.value?.includedLimitCents || 0) > 0);
const hasOfficialUsedAmount = computed(() => typeof report.value?.planUsedCents === 'number' && Number.isFinite(report.value.planUsedCents));
const hasOfficialRemainingAmount = computed(() => typeof report.value?.planRemainingCents === 'number' && Number.isFinite(report.value.planRemainingCents));
const hasOfficialOverallPercent = computed(() => typeof report.value?.officialTotalPercentUsed === 'number' && Number.isFinite(report.value.officialTotalPercentUsed));
const quotaUsedCents = computed(() => hasOfficialUsedAmount.value
  ? report.value!.planUsedCents!
  : (report.value?.includedLimitCents || 0) * (report.value?.totalPercentUsed || 0) / 100);
const quotaRemainingCents = computed(() => hasOfficialRemainingAmount.value
  ? Math.max(0, report.value!.planRemainingCents!)
  : Math.max(0, (report.value?.includedLimitCents || 0) - quotaUsedCents.value));
const quotaAmountUsedPercent = computed(() => hasQuota.value
  ? quotaUsedCents.value / report.value!.includedLimitCents * 100
  : report.value?.totalPercentUsed || 0);
const quotaRemainingPercent = computed(() => hasQuota.value
  ? quotaRemainingCents.value / report.value!.includedLimitCents * 100
  : 0);

function isAutoModel(model: string, kind = ''): boolean {
  return model.trim().toLowerCase() === 'default' || /auto|composer|cursor-grok/i.test(`${model} ${kind}`);
}

const modelRows = computed(() => Object.entries(report.value?.modelBreakdown || {})
  .filter(([model]) => !premiumOnly.value || !isAutoModel(model))
  .map(([model, values]) => ({ model, ...values }))
  .sort((a, b) => b.costCents - a.costCents || b.requests - a.requests));
const modelScopeCost = computed(() => modelRows.value.reduce((sum, row) => sum + row.costCents, 0));
const scopedEvents = computed(() => (report.value?.events || [])
  .filter((event) => !premiumOnly.value || !isAutoModel(event.model, event.kind)));
const models = computed(() => [...new Set(scopedEvents.value.map((event) => event.model))].sort());
const eventTypes = computed(() => [...new Set(scopedEvents.value.map((event) => event.typeName))]);
const invalidDateRange = computed(() => Boolean(startDate.value && endDate.value && startDate.value > endDate.value));

function dateBoundary(value: string, end = false): number | null {
  if (!value) return null;
  return Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`);
}

const filteredEvents = computed(() => {
  if (invalidDateRange.value) return [];
  const start = dateBoundary(startDate.value);
  const end = dateBoundary(endDate.value, true);
  return scopedEvents.value.filter((event) => {
    const millis = timestamp(event.timestamp);
    return (!selectedModel.value || event.model === selectedModel.value)
      && (!selectedType.value || event.typeName === selectedType.value)
      && (start === null || (millis !== null && millis >= start))
      && (end === null || (millis !== null && millis <= end));
  });
});
const filteredCost = computed(() => filteredEvents.value.reduce((sum, event) => sum + event.costCents, 0));
const filteredTokens = computed(() => filteredEvents.value.reduce((sum, event) => sum + event.tokens, 0));
const totalPages = computed(() => Math.max(1, Math.ceil(filteredEvents.value.length / pageSize.value)));
const pagedEvents = computed(() => filteredEvents.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const hasFilters = computed(() => Boolean(selectedModel.value || selectedType.value || startDate.value || endDate.value));

watch([premiumOnly, selectedModel, selectedType, startDate, endDate, pageSize], () => { page.value = 1; });
watch(premiumOnly, () => {
  if (!models.value.includes(selectedModel.value)) selectedModel.value = '';
  if (!eventTypes.value.includes(selectedType.value)) selectedType.value = '';
});

function typeClass(event: UsageEvent): string {
  if (event.isOnDemand) return 'type-demand';
  if (event.typeName === '赠送金') return 'type-credit';
  if (event.typeName === '套餐内') return 'type-included';
  return 'type-other';
}
</script>

<template>
  <div class="usage-page max-w-5xl mx-auto px-4 py-8 md:py-12">
    <header class="text-center mb-7">
      <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" class="w-6 h-6" aria-hidden="true"><path d="M3 3v18h18M7 15l4-5 4 3 5-7" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <h1 class="text-2xl md:text-3xl font-semibold tracking-tight text-ink-900">Cursor 额度查询</h1>
      <p class="mt-2 text-sm text-ink-500">粘贴 Token，查看账号用量、会员类型和费用明细</p>
    </header>

    <div class="mode-tabs mx-auto mb-5" role="tablist" aria-label="查询与计费说明">
      <button id="usage-query-tab" type="button" role="tab" :aria-selected="activeTab === 'query'" aria-controls="usage-query-panel" :class="{ active: activeTab === 'query' }" @click="activeTab = 'query'">Token 查额度</button>
      <button id="usage-billing-tab" type="button" role="tab" :aria-selected="activeTab === 'billing'" aria-controls="usage-billing-panel" :class="{ active: activeTab === 'billing' }" @click="activeTab = 'billing'">新版计费模型</button>
    </div>

    <section v-show="activeTab === 'query'" id="usage-query-panel" role="tabpanel" aria-labelledby="usage-query-tab">
      <form class="card p-5 md:p-6" :aria-busy="loading" @submit.prevent="submitQuery">
        <div class="flex items-center justify-between gap-3 mb-2.5">
          <label for="cursor-usage-token" class="text-sm font-medium text-ink-800">Cursor Token</label>
          <button v-if="rawToken" type="button" class="text-xs text-ink-500 hover:text-rose-600" @click="clearToken">清空</button>
        </div>
        <textarea id="cursor-usage-token" v-model="rawToken" :disabled="loading" class="input token-input w-full font-mono text-xs leading-relaxed" rows="4" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" :aria-invalid="Boolean(errorMessage)" :aria-describedby="errorMessage ? 'usage-query-error token-privacy' : 'token-privacy'" placeholder="请粘贴您的 Cursor Token（WorkosCursorSessionToken）&#10;user_…::… 或 WorkosCursorSessionToken=user_…%3A%3A…" @keydown="handleShortcut" />
        <p id="token-privacy" class="text-xs text-ink-400 mt-2 leading-relaxed">Token 仅用于本次查询，不保存在浏览器中。查询由本站连接 Cursor 官方接口完成。</p>
        <div v-if="errorMessage" id="usage-query-error" class="mt-4 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-700" role="alert">{{ errorMessage }}</div>
        <div class="query-actions mt-5">
          <label class="premium-toggle flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer">
            <input v-model="premiumOnly" type="checkbox" class="accent-brand-600 w-4 h-4" />
            <span>仅高级模型<span class="block text-xs text-ink-400 mt-0.5">过滤 Auto / default / Composer / cursor-grok</span></span>
          </label>
          <div class="flex items-center gap-3 query-submit">
            <span class="hidden sm:inline text-xs text-ink-400">Ctrl / ⌘ + Enter</span>
            <button class="query-button" type="submit" :disabled="loading">
              <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6" stroke-linecap="round" /></svg>
              <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" stroke-linecap="round" /></svg>
              {{ loading ? '查询中…' : errorMessage ? '重新查询' : '查询额度' }}
            </button>
          </div>
        </div>
        <div v-if="loading" class="mt-4 pt-4 border-t border-ink-100 flex items-center justify-between gap-3 text-xs text-ink-500" role="status">
          <span>正在读取账期和用量记录，请稍候…</span>
          <button type="button" class="text-brand-700 shrink-0" @click="cancelQuery">取消查询</button>
        </div>
      </form>

      <details class="token-help mt-4 mb-7 text-sm text-ink-600">
        <summary class="cursor-pointer inline-flex items-center gap-2 hover:text-brand-700">如何获取 Token？</summary>
        <ol class="mt-3 pl-5 list-decimal space-y-2 text-xs text-ink-500 leading-relaxed">
          <li>在浏览器登录 <a class="text-brand-700 underline underline-offset-2" href="https://cursor.com/dashboard" target="_blank" rel="noopener noreferrer">Cursor 网页端</a>，按 F12 打开开发者工具。</li>
          <li>进入 Application（应用）→ Cookies → cursor.com，找到 <code class="text-ink-700">WorkosCursorSessionToken</code>。</li>
          <li>复制完整的 Value（值）并粘贴到输入框，也支持包含该字段的完整 Cookie。</li>
        </ol>
      </details>

      <div v-if="report" class="report-stack space-y-5" aria-live="polite">
        <section class="card account-card p-5 md:p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2.5 flex-wrap">
                <h2 class="text-base font-semibold text-ink-900 break-all">{{ report.email || report.name || '邮箱信息暂不可用' }}</h2>
                <span class="tag-chip tag-chip-accent">{{ membershipName }}</span>
                <span v-if="report.isUnlimited" class="tag-chip">Unlimited</span>
              </div>
              <p v-if="report.email && report.name" class="text-xs text-ink-500 mt-1">{{ report.name }}</p>
              <p class="mt-2 text-xs text-ink-400">查询时间 {{ dateText(report.queriedAt, true) }}（北京时间）</p>
            </div>
            <div class="text-xs text-ink-500"><span class="block mb-1">当前账期</span><strong class="font-medium text-ink-700">{{ billingCycle }}</strong></div>
          </div>

          <div class="mt-5 pt-5 border-t border-ink-100">
            <div class="flex justify-between gap-3 items-end">
              <div><span class="text-xs text-ink-500">套餐额度</span><p class="text-2xl font-semibold text-ink-900 mt-1">{{ hasQuota ? money(report.includedLimitCents) : '未提供额度上限' }}</p></div>
              <div class="text-right"><span class="text-xs text-ink-500">已使用（按金额计算）</span><p class="text-lg font-semibold mt-1" :class="quotaAmountUsedPercent >= 100 ? 'text-rose-600' : 'text-brand-700'">{{ percent(quotaAmountUsedPercent) }}</p></div>
            </div>
            <div class="usage-track mt-3" role="progressbar" aria-label="套餐金额已用比例" :aria-valuenow="Math.min(100, Math.max(0, quotaAmountUsedPercent))" :aria-valuemin="0" :aria-valuemax="100"><span :class="quotaAmountUsedPercent >= 100 ? 'bg-rose-500' : 'bg-brand-600'" :style="{ width: progressWidth(quotaAmountUsedPercent) }" /></div>
            <div v-if="hasQuota" class="mt-3 flex flex-wrap justify-between gap-2 text-xs text-ink-500"><span>已用{{ hasOfficialUsedAmount ? '' : '（估算）' }} {{ money(quotaUsedCents) }}</span><span class="text-brand-700">剩余{{ hasOfficialRemainingAmount ? '' : '（估算）' }} {{ money(quotaRemainingCents) }} · {{ percent(quotaRemainingPercent) }}</span></div>
            <p v-if="hasOfficialOverallPercent" class="text-xs text-ink-600 mt-3">官方综合使用比例 <strong class="text-ink-800">{{ percent(report.officialTotalPercentUsed ?? 0) }}</strong></p>
            <p class="text-[11px] text-ink-400 mt-2 leading-relaxed">{{ hasOfficialUsedAmount && hasOfficialRemainingAmount ? '金额取自官方套餐用量' : '官方套餐金额未完整返回，部分金额为估算值' }}；模型额度池按各自规则计算，百分比以 Cursor 控制台为准。</p>
          </div>
        </section>

        <section aria-label="账期用量统计">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
            <article class="card p-5"><p class="text-xs text-ink-500">套餐 + 按需金额</p><p class="text-2xl font-semibold text-brand-700 mt-2">{{ money(report.officialTotalCents) }}</p><p class="text-xs text-ink-400 mt-2">全账期官方用量口径</p></article>
            <article class="card p-5"><p class="text-xs text-ink-500">总请求数</p><p class="text-2xl font-semibold text-ink-900 mt-2">{{ count(report.totalRequests) }}</p><p class="text-xs text-ink-400 mt-2">当前账期全部用量记录</p></article>
            <article class="card p-5"><p class="text-xs text-ink-500">总 Tokens</p><p class="text-2xl font-semibold text-ink-900 mt-2" :title="count(report.totalTokens)">{{ tokens(report.totalTokens) }}</p><p class="text-xs text-ink-400 mt-2">含输入、输出及缓存 Tokens</p></article>
          </div>
          <div class="card px-5 py-4 mt-3 flex flex-wrap gap-x-8 gap-y-3 text-xs"><span class="text-ink-500">官方套餐 <strong class="ml-2 text-ink-800 font-semibold">{{ money(report.officialPlanCents) }}</strong></span><span class="text-ink-500">按需费用 <strong class="ml-2 text-ink-800 font-semibold">{{ money(report.officialOnDemandCents) }}</strong></span><span v-if="report.freeCreditCount > 0 || report.freeCreditCents > 0" class="text-ink-500">赠送金额度使用 <strong class="ml-2 text-brand-700 font-semibold">{{ money(report.freeCreditCents) }}</strong><span class="ml-1 text-ink-400">（单独统计）</span></span></div>
        </section>

        <section class="card p-5 md:p-6" aria-labelledby="usage-distribution-title">
          <div class="flex items-center justify-between gap-2 mb-4"><h2 id="usage-distribution-title" class="text-sm font-semibold text-ink-900">套餐内用量分布</h2><span class="text-xs text-ink-400">全部模型</span></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <article class="rounded-xl bg-brand-50/60 border border-brand-100 p-4">
              <div class="flex items-center justify-between"><h3 class="text-sm font-medium text-brand-800">API 模型</h3><strong class="text-brand-700 text-sm">{{ percent(report.apiPercentUsed) }}</strong></div>
              <div class="usage-track mt-3"><span class="bg-brand-600" :style="{ width: progressWidth(report.apiPercentUsed) }" /></div>
              <p class="mt-3 text-xs text-ink-500" :title="count(report.includedBreakdown.api.tokens)">{{ tokens(report.includedBreakdown.api.tokens) }} 记录 Tokens</p>
            </article>
            <article class="rounded-xl bg-sky-50/60 border border-sky-100 p-4">
              <div class="flex items-center justify-between"><h3 class="text-sm font-medium text-sky-800">Auto / Composer / cursor-grok</h3><strong class="text-sky-700 text-sm">{{ percent(report.autoPercentUsed) }}</strong></div>
              <div class="usage-track mt-3"><span class="bg-sky-500" :style="{ width: progressWidth(report.autoPercentUsed) }" /></div>
              <p class="mt-3 text-xs text-ink-500" :title="count(report.includedBreakdown.auto.tokens)">{{ tokens(report.includedBreakdown.auto.tokens) }} 记录 Tokens</p>
            </article>
          </div>
          <p class="text-[11px] text-ink-400 mt-3 leading-relaxed">比例由官方返回，各自独立计算，不能直接相加。Tokens 为按模型名称分类的记录用量，不含缓存写入，可能与总 Tokens 不同。</p>
        </section>

        <section v-if="report.onDemandCount > 0 || report.officialOnDemandCents > 0" class="card p-5 border-amber-100 bg-amber-50/40" aria-labelledby="usage-demand-title">
          <div class="flex flex-wrap justify-between gap-5"><div><h2 id="usage-demand-title" class="text-sm font-semibold text-amber-900">按需用量</h2><p class="text-xs text-amber-800/70 mt-1">套餐外按量计费部分（On-Demand）</p></div><div class="flex gap-6 flex-wrap"><div><p class="text-xs text-ink-500">费用</p><strong class="block text-sm text-amber-900 mt-1">{{ money(report.officialOnDemandCents) }}</strong></div><div><p class="text-xs text-ink-500">请求数</p><strong class="block text-sm text-ink-800 mt-1">{{ count(report.onDemandCount) }}</strong></div><div><p class="text-xs text-ink-500">Tokens</p><strong class="block text-sm text-ink-800 mt-1">{{ tokens(report.onDemandTokens) }}</strong></div></div></div>
        </section>

        <section class="card overflow-hidden" aria-labelledby="usage-model-title">
          <div class="p-5 md:px-6 border-b border-ink-100 flex flex-wrap justify-between gap-3"><div><h2 id="usage-model-title" class="text-sm font-semibold text-ink-900">模型用量统计</h2><p class="mt-1 text-xs text-ink-400">{{ premiumOnly ? '当前范围：仅高级模型' : '当前范围：全部模型' }} · 套餐、按需及赠送金汇总</p></div><span class="text-xs text-ink-500 self-center">范围费用 <strong class="text-ink-800">{{ money(modelScopeCost) }}</strong></span></div>
          <p v-if="premiumOnly" class="px-5 md:px-6 py-3 bg-brand-50/60 text-xs text-brand-800">高级模型筛选只影响此表与下方明细，官方账单、套餐额度和用量分布保持全账期数据。</p>
          <div class="table-scroll"><table class="usage-table model-table"><thead><tr><th>模型</th><th class="numeric">请求数</th><th class="numeric">Tokens</th><th class="numeric">费用</th></tr></thead><tbody><tr v-for="row in modelRows" :key="row.model"><td class="model-name">{{ row.model }}</td><td class="numeric">{{ count(row.requests) }}</td><td class="numeric" :title="count(row.tokens)">{{ tokens(row.tokens) }}</td><td class="numeric font-medium">{{ money(row.costCents) }}</td></tr></tbody></table></div>
          <p v-if="!modelRows.length" class="empty-state">{{ premiumOnly ? '当前账期没有高级模型用量' : '当前账期暂无模型用量记录' }}</p>
          <p class="px-5 md:px-6 py-3 text-[11px] leading-relaxed text-ink-400 border-t border-ink-100">模型费用按官方套餐聚合、按需总额和赠送金汇总，与逐条明细的费用合计可能不同。</p>
        </section>

        <section class="card overflow-hidden" aria-labelledby="usage-events-title">
          <div class="px-5 md:px-6 pt-5 flex justify-between gap-3"><h2 id="usage-events-title" class="text-sm font-semibold text-ink-900">用量明细</h2><span class="tag-chip">{{ count(filteredEvents.length) }} 条</span></div>
          <div class="detail-filters px-5 md:px-6 py-4">
            <label class="filter-field"><span>模型</span><select v-model="selectedModel" class="input"><option value="">全部模型</option><option v-for="model in models" :key="model" :value="model">{{ model }}</option></select></label>
            <label class="filter-field"><span>用量类型</span><select v-model="selectedType" class="input"><option value="">全部类型</option><option v-for="type in eventTypes" :key="type" :value="type">{{ type }}</option></select></label>
            <label class="filter-field"><span>开始日期（北京时间）</span><input v-model="startDate" type="date" class="input" :max="endDate || undefined" /></label>
            <label class="filter-field"><span>结束日期（北京时间）</span><input v-model="endDate" type="date" class="input" :min="startDate || undefined" /></label>
          </div>
          <p v-if="invalidDateRange" class="px-5 md:px-6 pb-3 text-xs text-rose-600" role="alert">开始日期不能晚于结束日期。</p>
          <div class="px-5 md:px-6 py-3 bg-ink-50 border-y border-ink-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-500"><span>当前筛选 {{ count(filteredEvents.length) }} 条</span><span>明细费用 <strong class="text-ink-800">{{ money(filteredCost, 4) }}</strong></span><span>Tokens {{ tokens(filteredTokens) }}</span><button v-if="hasFilters" type="button" class="text-brand-700 ml-auto" @click="resetFilters">重置筛选</button></div>
          <div class="table-scroll"><table class="usage-table detail-table"><thead><tr><th>#</th><th>时间（北京时间）</th><th>模型</th><th>类型</th><th class="numeric">Tokens</th><th class="numeric">明细费用</th></tr></thead><tbody><tr v-for="(event, index) in pagedEvents" :key="`${event.timestamp}-${event.model}-${index}`"><td class="text-ink-400">{{ (page - 1) * pageSize + index + 1 }}</td><td class="whitespace-nowrap">{{ dateText(event.timestamp, true) }}</td><td class="model-name">{{ event.model }}</td><td><span class="event-type" :class="typeClass(event)">{{ event.typeName }}</span></td><td class="numeric" :title="count(event.tokens)">{{ tokens(event.tokens) }}</td><td class="numeric font-medium">{{ money(event.costCents, 4) }}</td></tr></tbody></table></div>
          <p v-if="!filteredEvents.length" class="empty-state">{{ hasFilters ? '没有符合筛选条件的用量记录' : premiumOnly ? '当前账期没有高级模型用量记录' : '当前账期暂无用量记录' }}</p>
          <div class="pagination px-5 md:px-6 py-4 border-t border-ink-100">
            <label class="flex items-center gap-2 text-xs text-ink-500">每页 <select v-model.number="pageSize" class="input text-xs"><option :value="10">10 条</option><option :value="20">20 条</option><option :value="50">50 条</option><option :value="100">100 条</option></select></label>
            <div class="flex items-center gap-3"><button type="button" class="page-button" :disabled="page <= 1" aria-label="上一页" @click="page--">上一页</button><span class="text-xs text-ink-500 tabular-nums">{{ page }} / {{ totalPages }}</span><button type="button" class="page-button" :disabled="page >= totalPages" aria-label="下一页" @click="page++">下一页</button></div>
          </div>
          <p class="px-5 md:px-6 pb-4 text-[11px] text-ink-400 leading-relaxed">明细费用取自逐条用量记录；它可能与官方聚合账单金额不同，请以 Cursor 账户账单为准。</p>
        </section>
        <p v-if="report.eventsTruncated" class="text-xs text-amber-700 rounded-xl bg-amber-50 border border-amber-100 p-4" role="status">本次只返回部分用量记录，明细与模型统计可能不完整。官方账单金额仍按账户汇总显示。</p>
      </div>

      <div v-else-if="!loading && !errorMessage" class="text-center py-8 text-ink-400"><p class="text-sm">查询后，账号额度和用量明细会显示在这里</p><p class="text-xs mt-2">无需登录本站</p></div>
    </section>

    <section v-show="activeTab === 'billing'" id="usage-billing-panel" role="tabpanel" aria-labelledby="usage-billing-tab" class="space-y-4">
      <div class="card p-5 md:p-7"><h2 class="text-lg font-semibold text-ink-900">了解 Cursor 用量计费</h2><p class="mt-2 text-sm text-ink-500 leading-7">套餐额度、官方用量金额与逐条请求明细使用不同口径。查询结果分别展示这些数据，便于核对当前账期。</p></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <article class="card p-5"><span class="billing-number">01</span><h3 class="text-sm font-semibold text-ink-900 mt-3">套餐内额度</h3><p class="text-sm text-ink-500 leading-7 mt-2">当前官方计费规则区分 Cursor Models 与 Other Models 两个用量池，额度按月重置。具体可用额度和使用比例以你的 Cursor 账户当前账期为准。</p></article>
        <article class="card p-5"><span class="billing-number">02</span><h3 class="text-sm font-semibold text-ink-900 mt-3">按需与赠送金</h3><p class="text-sm text-ink-500 leading-7 mt-2">按需费用来自官方账期汇总，与套餐内使用金额分开显示。赠送金使用单独列出，不计入“套餐 + 按需金额”。</p></article>
        <article class="card p-5"><span class="billing-number">03</span><h3 class="text-sm font-semibold text-ink-900 mt-3">模型与请求明细</h3><p class="text-sm text-ink-500 leading-7 mt-2">Auto 按实际路由模型的价格计费。模型汇总与逐条请求可能包含不同的计费项或舍入差异，费用合计不一定相等。</p></article>
      </div>
      <div class="card p-5 md:p-7"><h3 class="text-sm font-semibold text-ink-900">查看最新价格与账户账单</h3><p class="text-sm text-ink-500 leading-7 mt-2">模型单价和套餐规则可能调整，最新信息请查看 Cursor 官方页面。最终费用以账户账单为准。</p><div class="flex flex-wrap gap-3 mt-4"><a href="https://cursor.com/cn/docs/models-and-pricing" target="_blank" rel="noopener noreferrer" class="official-link">官方模型计费说明 <span aria-hidden="true">↗</span></a><a href="https://cursor.com/pricing" target="_blank" rel="noopener noreferrer" class="official-link">Cursor 官方价格 <span aria-hidden="true">↗</span></a><a href="https://cursor.com/dashboard" target="_blank" rel="noopener noreferrer" class="official-link">打开账户账单 <span aria-hidden="true">↗</span></a></div></div>
      <button type="button" class="query-button mx-auto" @click="activeTab = 'query'">返回额度查询</button>
    </section>
  </div>
</template>

<style scoped>
.mode-tabs { display: flex; width: fit-content; max-width: 100%; background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 12px; padding: 4px; gap: 4px; }
.mode-tabs button { padding: 10px 22px; border-radius: 8px; font-size: 13px; color: #78716c; transition: background .15s, color .15s; }
.mode-tabs button.active { background: white; color: #047857; font-weight: 600; box-shadow: 0 1px 3px #0000000a; }
.token-input { min-height: 110px; }
.token-input:disabled { background: #fafaf9; opacity: .7; }
.query-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.query-button { display: flex; justify-content: center; align-items: center; gap: 8px; min-width: 132px; padding: 11px 20px; border-radius: 10px; color: white; background: #059669; font-size: 14px; font-weight: 600; transition: background .15s; }
.query-button:hover { background: #047857; }
.query-button:disabled { opacity: .65; cursor: wait; }
.usage-track { height: 7px; background: #e7e5e4; border-radius: 20px; overflow: hidden; }
.usage-track span { display: block; height: 100%; border-radius: inherit; transition: width .25s; }
.table-scroll { overflow-x: auto; }
.usage-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
.usage-table th { background: #fafaf9; color: #78716c; font-weight: 500; padding: 13px 20px; white-space: nowrap; border-bottom: 1px solid #f5f5f4; }
.usage-table td { padding: 14px 20px; border-bottom: 1px solid #f5f5f4; color: #57534e; }
.usage-table tbody tr:last-child td { border-bottom: 0; }
.usage-table tbody tr:hover { background: #fafaf9; }
.usage-table .numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.model-name { min-width: 160px; max-width: 320px; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.detail-table { min-width: 760px; }
.model-table { min-width: 460px; }
.detail-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.filter-field { display: flex; flex-direction: column; gap: 6px; color: #78716c; font-size: 11px; min-width: 0; }
.filter-field .input { width: 100%; min-width: 0; font-size: 12px; height: 38px; }
.event-type { display: inline-flex; padding: 3px 7px; border-radius: 5px; white-space: nowrap; font-size: 11px; }
.type-included { color: #047857; background: #ecfdf5; }
.type-demand { color: #b45309; background: #fffbeb; }
.type-credit { color: #0369a1; background: #f0f9ff; }
.type-other { color: #78716c; background: #f5f5f4; }
.empty-state { text-align: center; padding: 36px 20px; color: #a8a29e; font-size: 13px; }
.pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-button { padding: 7px 11px; border: 1px solid #e7e5e4; border-radius: 7px; font-size: 12px; color: #57534e; }
.page-button:hover:not(:disabled) { color: #047857; background: #f0fdf4; border-color: #bbf7d0; }
.page-button:disabled { color: #d6d3d1; cursor: not-allowed; }
.billing-number { color: #047857; background: #f0fdf4; font-weight: 600; font-size: 12px; border-radius: 8px; display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; }
.official-link { display: inline-flex; align-items: center; gap: 12px; border: 1px solid #e7e5e4; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #047857; }
.official-link:hover { border-color: #86efac; background: #f0fdf4; }
.usage-page button:focus-visible, .usage-page a:focus-visible, .usage-page summary:focus-visible { outline: 2px solid #059669; outline-offset: 3px; }
@media (max-width: 640px) {
  .mode-tabs button { padding: 9px 18px; }
  .query-actions { flex-direction: column; align-items: stretch; gap: 18px; }
  .query-submit, .query-button { width: 100%; }
  .detail-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pagination { flex-wrap: wrap; }
  .usage-table th, .usage-table td { padding-left: 16px; padding-right: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .usage-track span { transition: none; }
  .animate-spin { animation: none; }
}
</style>
