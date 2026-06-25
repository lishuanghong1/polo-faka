<script setup lang="ts">
import { computed } from 'vue';
import { appBrand } from '../config/appBrand';
import type { Account, AppSettings, CursorInfo } from '../types';

type MainTab = 'import' | 'library' | 'pool' | 'settings';

const props = defineProps<{
  cursorInfo: CursorInfo | null;
  accounts: Account[];
  settings: AppSettings | null;
}>();

const emit = defineEmits<{
  (e: 'go', tab: MainTab): void;
  (e: 'reload-info'): void;
  (e: 'reload-accounts'): void;
}>();

function normalizeUserId(id?: string | null) {
  if (!id) return null;
  const t = id.trim();
  const tail = t.includes('|') ? t.split('|').pop() : t;
  return tail?.trim() || null;
}

const activeAccount = computed(() => {
  const info = props.cursorInfo;
  if (!info) return null;
  if (info.currentEmail) {
    const byEmail = props.accounts.find((a) => a.email === info.currentEmail);
    if (byEmail) return byEmail;
  }
  const currentUserId = normalizeUserId(info.currentUserId);
  if (!currentUserId) return null;
  return (
    props.accounts.find(
      (a) => normalizeUserId(a.userId) === currentUserId,
    ) || null
  );
});

const poolBoundCount = computed(
  () => props.accounts.filter((a) => a.poolGrantOrderNo).length,
);

const knownUsageCount = computed(
  () => props.accounts.filter((a) => a.totalPercent !== null || a.remainingUsd !== null).length,
);

const criticalAccounts = computed(() => {
  const critical = props.settings?.criticalPercent ?? 95;
  return props.accounts
    .filter((a) => (a.totalPercent ?? -1) >= critical)
    .sort((a, b) => (b.totalPercent ?? 0) - (a.totalPercent ?? 0))
    .slice(0, 3);
});

const staleAccounts = computed(() => {
  const day = 24 * 60 * 60;
  const now = Date.now() / 1000;
  return props.accounts.filter((a) => !a.lastUsageAt || now - a.lastUsageAt > day).length;
});

const statusLabel = computed(() => {
  if (!props.cursorInfo?.installed) return '未检测到 Cursor';
  if (props.cursorInfo.running) return 'Cursor 运行中';
  return 'Cursor 已就绪';
});

const statusTone = computed(() => {
  if (!props.cursorInfo?.installed) return 'danger';
  if (props.cursorInfo.running) return 'warn';
  return 'ok';
});

function fmtPercent(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}

function fmtRelative(ts: number | null | undefined) {
  if (!ts) return '从未';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}
</script>

<template>
  <div class="space-y-4">
    <section class="card p-4 bg-[linear-gradient(135deg,#ffffff_0%,#ecfdf5_100%)] border-brand-200">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-[0.18em] text-brand-700 font-semibold">
            {{ appBrand.name }}
          </div>
          <h1 class="mt-1 text-xl font-semibold text-ink-100 leading-tight">
            桌面账号控制台
          </h1>
          <p class="mt-1 text-xs text-ink-500 leading-relaxed">
            {{ appBrand.subtitle }}
          </p>
        </div>
        <div
          :class="[
            'px-2.5 py-1 rounded-full text-[11px] border whitespace-nowrap',
            statusTone === 'ok' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
            statusTone === 'warn' && 'bg-amber-50 text-amber-700 border-amber-200',
            statusTone === 'danger' && 'bg-rose-50 text-rose-700 border-rose-200',
          ]"
        >
          {{ statusLabel }}
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="rounded-lg border border-brand-100 bg-white/80 px-3 py-2">
          <div class="text-[11px] text-ink-500">账号库</div>
          <div class="mt-0.5 text-lg font-semibold text-ink-100">{{ accounts.length }}</div>
        </div>
        <div class="rounded-lg border border-brand-100 bg-white/80 px-3 py-2">
          <div class="text-[11px] text-ink-500">号池绑定</div>
          <div class="mt-0.5 text-lg font-semibold text-ink-100">{{ poolBoundCount }}</div>
        </div>
        <div class="rounded-lg border border-brand-100 bg-white/80 px-3 py-2">
          <div class="text-[11px] text-ink-500">已查用量</div>
          <div class="mt-0.5 text-lg font-semibold text-ink-100">{{ knownUsageCount }}</div>
        </div>
        <div class="rounded-lg border border-brand-100 bg-white/80 px-3 py-2">
          <div class="text-[11px] text-ink-500">待刷新</div>
          <div class="mt-0.5 text-lg font-semibold text-ink-100">{{ staleAccounts }}</div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button class="btn-primary text-xs" @click="emit('go', 'import')">导入账号</button>
        <button class="btn-ghost text-xs" @click="emit('go', 'library')">打开账号库</button>
        <button class="btn-ghost text-xs" @click="emit('go', 'pool')">号池调度</button>
        <button class="btn-ghost text-xs" @click="emit('reload-info')">刷新 Cursor 状态</button>
      </div>
    </section>

    <section class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <article class="card p-4">
        <div class="text-sm font-medium text-ink-100 mb-2">当前登录</div>
        <div class="text-xs text-ink-500 space-y-1">
          <div class="flex items-baseline gap-2">
            <span class="shrink-0">账号</span>
            <span class="font-mono text-ink-200 truncate">
              {{ cursorInfo?.currentEmail || cursorInfo?.currentUserId || '未识别' }}
            </span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="shrink-0">库内备注</span>
            <span class="text-ink-200 truncate">{{ activeAccount?.label || '—' }}</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="shrink-0">最近使用</span>
            <span class="text-ink-200">{{ fmtRelative(activeAccount?.lastUsedAt) }}</span>
          </div>
        </div>
      </article>

      <article class="card p-4">
        <div class="text-sm font-medium text-ink-100 mb-2">自动策略</div>
        <div class="text-xs text-ink-500 space-y-1">
          <div class="flex items-center justify-between gap-3">
            <span>用量刷新</span>
            <span class="text-ink-200">
              {{ settings?.autoRefreshSeconds ? `${Math.round(settings.autoRefreshSeconds / 60)} 分钟` : '关闭' }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>阈值预警</span>
            <span class="text-ink-200">
              {{ settings?.quotaAlertEnabled ? `${settings.warnPercent}% / ${settings.criticalPercent}%` : '关闭' }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span>号池自动调度</span>
            <span class="text-ink-200">
              {{ settings?.poolAutoEnabled ? `${settings.poolSwapThresholdPercent}% 换号` : '关闭' }}
            </span>
          </div>
        </div>
      </article>
    </section>

    <section class="card p-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="text-sm font-medium text-ink-100">高风险账号</div>
        <button class="btn-ghost text-[11px] py-1 px-2" @click="emit('reload-accounts')">刷新账号库</button>
      </div>

      <div v-if="!criticalAccounts.length" class="text-xs text-ink-500">
        当前没有超过严重阈值的账号。
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="a in criticalAccounts"
          :key="a.id"
          class="flex items-center justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-xs"
        >
          <div class="min-w-0">
            <div class="font-mono text-ink-100 truncate">{{ a.email || a.label || `账号 #${a.id}` }}</div>
            <div class="text-ink-500 mt-0.5">更新 {{ fmtRelative(a.lastUsageAt) }}</div>
          </div>
          <div class="shrink-0 text-right">
            <div class="text-rose-700 font-semibold">{{ fmtPercent(a.totalPercent) }}</div>
            <div class="text-[11px] text-ink-500">{{ fmtMoney(a.remainingUsd) }}</div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
