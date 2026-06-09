<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { api } from './api';
import type {
  Account,
  AppSettings,
  CursorInfo,
  DeepLinkImportEvent,
  ImportResult,
  PoolExhaustedEvent,
  PoolSwappedEvent,
  QuotaAlertEvent,
  UsageUpdateEvent,
} from './types';
import Import from './views/Import.vue';
import Library from './views/Library.vue';
import Pool from './views/Pool.vue';
import Settings from './views/Settings.vue';

type Tab = 'import' | 'library' | 'pool' | 'settings';

const tab = ref<Tab>('import');
const info = ref<CursorInfo | null>(null);
const accounts = ref<Account[]>([]);
const settings = ref<AppSettings | null>(null);
const dbPath = ref<string | null>(null);

/** 来自 deep link / 切号成功后的 prefill */
const importPrefill = ref<string | null>(null);

/** 滚动的预警横幅 */
interface ToastItem {
  id: number;
  kind: 'warn' | 'critical' | 'info' | 'error';
  text: string;
}
const toasts = ref<ToastItem[]>([]);
let toastSeq = 1;
function pushToast(kind: ToastItem['kind'], text: string) {
  const id = toastSeq++;
  toasts.value.push({ id, kind, text });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, kind === 'critical' ? 8000 : 5000);
}

async function reloadInfo() {
  try {
    info.value = await api.detectCursor();
  } catch (e: any) {
    pushToast('error', String(e?.message || e));
  }
}
async function reloadAccounts() {
  try {
    accounts.value = await api.listAccounts();
  } catch (e: any) {
    pushToast('error', String(e?.message || e));
  }
}
async function reloadSettings() {
  try {
    settings.value = await api.getSettings();
  } catch (e: any) {
    pushToast('error', String(e?.message || e));
  }
}
async function reloadDbPath() {
  try {
    dbPath.value = await api.dbPath();
  } catch {
    dbPath.value = null;
  }
}

const counts = computed(() => ({
  library: accounts.value.length,
  poolBound: accounts.value.filter((a) => a.poolGrantOrderNo).length,
}));

// ── 事件监听 ──────────────────────────────
const unlisteners: UnlistenFn[] = [];

onMounted(async () => {
  await Promise.all([reloadInfo(), reloadAccounts(), reloadSettings(), reloadDbPath()]);

  unlisteners.push(
    await listen<UsageUpdateEvent>('usage-updated', (e) => {
      // 实时更新对应账号的进度条
      const acc = accounts.value.find((a) => a.id === e.payload.id);
      if (acc) {
        acc.totalPercent = e.payload.totalPercent ?? acc.totalPercent;
        acc.remainingUsd = e.payload.remainingUsd ?? acc.remainingUsd;
        acc.lastUsageAt = Math.floor(Date.now() / 1000);
      }
    }),
  );
  unlisteners.push(
    await listen<QuotaAlertEvent>('quota-alert', (e) => {
      const { email, plan, percent, level } = e.payload;
      const text = `${level === 'critical' ? '⚠️ 配额告急' : '配额提醒'}：${email || '账号'}${plan ? ' · ' + plan : ''} 已用 ${percent.toFixed(1)}%`;
      pushToast(level, text);
    }),
  );
  unlisteners.push(
    await listen<DeepLinkImportEvent>('deep-link-import', (e) => {
      const { email, token } = e.payload;
      if (!token) {
        pushToast('error', 'deep link 缺少 token 参数');
        return;
      }
      importPrefill.value = email ? `${email}----${token}` : token;
      tab.value = 'import';
      pushToast('info', '已从外部链接预填账号，请确认后点导入');
    }),
  );
  unlisteners.push(
    await listen<PoolSwappedEvent>('pool-swapped', async (e) => {
      pushToast(
        'info',
        `已自动换号：${e.payload.newEmail || '(无 email)'} · 订单 ${e.payload.orderNo}`,
      );
      await reloadAccounts();
      await reloadInfo();
    }),
  );
  unlisteners.push(
    await listen<PoolExhaustedEvent>('pool-exhausted', async (e) => {
      const cleared = e.payload.clearedCursor ? '+ 已清 Cursor 登录' : '';
      pushToast(
        'critical',
        `号池额度用尽：${e.payload.email || '(无 email)'} 已释放号 ${cleared}`,
      );
      await reloadAccounts();
      await reloadInfo();
    }),
  );
});

onUnmounted(() => {
  for (const u of unlisteners) u();
});

function onImported(result: ImportResult) {
  if (result.email) {
    pushToast('info', `已切换到 ${result.email}`);
  }
}
</script>

<template>
  <main class="min-h-screen px-6 py-5 max-w-3xl mx-auto">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold">
          P
        </div>
        <div>
          <div class="text-base font-semibold text-ink-100 leading-tight">Polo 账号工具</div>
          <div class="text-[11px] text-ink-500">本地账号库 · 查用量 · 阈值预警 · 商城联动</div>
        </div>
      </div>
      <button class="btn-ghost text-xs" @click="reloadInfo">重新检测</button>
    </header>

    <!-- Tab 栏 -->
    <nav class="flex items-center gap-1 mb-4 border-b border-ink-800 overflow-x-auto">
      <button
        v-for="opt in [
          { id: 'import', label: '导入新账号' },
          { id: 'library', label: `账号库 (${counts.library})` },
          { id: 'pool', label: counts.poolBound > 0 ? `号池 · ${counts.poolBound}` : '号池' },
          { id: 'settings', label: '设置' },
        ] as const"
        :key="opt.id"
        :class="[
          'px-3 py-2 text-sm border-b-2 -mb-px transition whitespace-nowrap',
          tab === opt.id
            ? 'border-brand-500 text-ink-100'
            : 'border-transparent text-ink-500 hover:text-ink-300',
        ]"
        @click="tab = opt.id"
      >{{ opt.label }}</button>
    </nav>

    <!-- 主体 -->
    <Import
      v-if="tab === 'import'"
      :cursor-info="info"
      :prefill="importPrefill"
      :defaults="settings ?? undefined"
      @imported="onImported"
      @reload-info="reloadInfo"
      @reload-accounts="reloadAccounts"
    />
    <Library
      v-else-if="tab === 'library'"
      :accounts="accounts"
      :defaults="settings ?? undefined"
      :current-email="info?.currentEmail ?? null"
      @reload="async () => { await reloadAccounts(); await reloadInfo(); }"
      @switch="() => pushToast('info', '切换完成，已重启 Cursor')"
    />
    <Pool
      v-else-if="tab === 'pool'"
      :settings="settings"
      @settings-changed="(s) => (settings = s)"
      @reload-accounts="async () => { await reloadAccounts(); await reloadInfo(); }"
      @toast="(kind, text) => pushToast(kind, text)"
    />
    <Settings
      v-else
      :settings="settings"
      :db-path="dbPath"
      @updated="(s) => (settings = s)"
    />

    <footer class="text-[11px] text-ink-600 leading-relaxed mt-6 px-1">
      · 所有数据均存放在本机，工具不向我们的服务器发送你的 token<br/>
      · token 等同于账号密码，请勿随意公开
    </footer>

    <!-- Toast -->
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <transition-group name="toast" tag="div" class="flex flex-col gap-2">
        <div
          v-for="t in toasts"
          :key="t.id"
          :class="[
            'px-3 py-2 rounded-lg border text-xs shadow-lg backdrop-blur',
            t.kind === 'critical' && 'bg-rose-500/15 border-rose-500/40 text-rose-100',
            t.kind === 'warn' && 'bg-amber-500/15 border-amber-500/40 text-amber-100',
            t.kind === 'info' && 'bg-brand-500/15 border-brand-500/40 text-brand-100',
            t.kind === 'error' && 'bg-rose-700/20 border-rose-700/40 text-rose-100',
          ]"
        >
          {{ t.text }}
        </div>
      </transition-group>
    </div>
  </main>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 200ms ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
