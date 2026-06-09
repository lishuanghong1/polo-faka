<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import type { AppSettings } from '../types';

const props = defineProps<{
  settings: AppSettings | null;
  dbPath?: string | null;
}>();

const emit = defineEmits<{
  (e: 'updated', settings: AppSettings): void;
}>();

const draft = ref<AppSettings | null>(null);
const saving = ref(false);
const saved = ref(false);

watch(
  () => props.settings,
  (s) => {
    if (s) {
      draft.value = { ...s };
    }
  },
  { immediate: true },
);

const intervalMinutes = computed({
  get() {
    if (!draft.value) return 10;
    return Math.round(draft.value.autoRefreshSeconds / 60);
  },
  set(v: number) {
    if (draft.value) {
      draft.value.autoRefreshSeconds = Math.max(0, Math.min(180, v)) * 60;
    }
  },
});

async function save() {
  if (!draft.value) return;
  saving.value = true;
  try {
    const s = await api.saveSettings(draft.value);
    emit('updated', s);
    saved.value = true;
    setTimeout(() => (saved.value = false), 1500);
  } catch (e: any) {
    alert(String(e?.message || e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="draft" class="space-y-3">
    <section class="card p-4">
      <div class="text-sm font-medium text-ink-100 mb-3">自动刷新用量</div>
      <div class="flex items-center gap-3 text-sm">
        <input
          v-model.number="intervalMinutes"
          type="number"
          min="0"
          max="180"
          class="w-20 px-3 py-1.5 bg-ink-900 border border-ink-700 rounded text-ink-100 text-right focus:outline-none focus:border-brand-500"
        />
        <span class="text-ink-400">分钟（设 0 = 关闭）</span>
      </div>
      <p class="text-[11px] text-ink-500 mt-2">
        启动一个后台任务，定时遍历账号库里所有 token，调 Cursor 接口刷新用量。<br/>
        推荐 5–10 分钟；间隔越短请求越频繁。
      </p>
    </section>

    <section class="card p-4">
      <label class="flex items-start gap-2 cursor-pointer">
        <input
          v-model="draft.quotaAlertEnabled"
          type="checkbox"
          class="mt-0.5"
        />
        <div class="min-w-0">
          <div class="text-sm text-ink-100">启用配额阈值预警</div>
          <div class="text-[11px] text-ink-500 mt-0.5">
            刷新到的用量超过阈值时弹系统通知，避免悄悄爆额
          </div>
        </div>
      </label>

      <div class="grid grid-cols-2 gap-3 mt-3 text-sm" :class="!draft.quotaAlertEnabled && 'opacity-50'">
        <div>
          <label class="text-[11px] text-ink-500">警告阈值 (%)</label>
          <input
            v-model.number="draft.warnPercent"
            type="number"
            min="50"
            max="100"
            step="1"
            :disabled="!draft.quotaAlertEnabled"
            class="w-full mt-0.5 px-3 py-1.5 bg-ink-900 border border-ink-700 rounded text-ink-100 text-right focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label class="text-[11px] text-ink-500">严重阈值 (%)</label>
          <input
            v-model.number="draft.criticalPercent"
            type="number"
            min="50"
            max="100"
            step="1"
            :disabled="!draft.quotaAlertEnabled"
            class="w-full mt-0.5 px-3 py-1.5 bg-ink-900 border border-ink-700 rounded text-ink-100 text-right focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>
    </section>

    <section class="card p-4 space-y-2">
      <div class="text-sm font-medium text-ink-100">默认导入行为</div>
      <label class="flex items-start gap-2 cursor-pointer">
        <input v-model="draft.defaultResetMachineId" type="checkbox" class="mt-0.5" />
        <div>
          <div class="text-sm text-ink-100">默认勾选「重置机器码」</div>
          <div class="text-[11px] text-ink-500 mt-0.5">
            导入页打开时这个开关的初始状态
          </div>
        </div>
      </label>
      <label class="flex items-start gap-2 cursor-pointer">
        <input v-model="draft.defaultRelaunch" type="checkbox" class="mt-0.5" />
        <div>
          <div class="text-sm text-ink-100">默认勾选「写入后自动重启 Cursor」</div>
          <div class="text-[11px] text-ink-500 mt-0.5">
            导入页打开时这个开关的初始状态
          </div>
        </div>
      </label>
    </section>

    <section class="card p-4 space-y-3">
      <div class="text-sm font-medium text-ink-100">商城 / 号池联动</div>
      <div>
        <label class="text-[11px] text-ink-500">商城后端地址</label>
        <input
          v-model="draft.shopBaseUrl"
          placeholder="https://your-shop.com/api"
          class="w-full mt-0.5 px-3 py-1.5 bg-ink-900 border border-ink-700 rounded text-ink-100 font-mono text-xs focus:outline-none focus:border-brand-500"
        />
        <p class="text-[11px] text-ink-500 mt-1">
          填你的商城域名即可（会自动补 /api）；号池登录、查额度都走这里。
        </p>
      </div>

      <label class="flex items-start gap-2 cursor-pointer">
        <input v-model="draft.poolAutoEnabled" type="checkbox" class="mt-0.5" />
        <div>
          <div class="text-sm text-ink-100">启用号池自动调度</div>
          <div class="text-[11px] text-ink-500 mt-0.5">
            后台刷新到号池账号到达阈值时自动换号；额度用尽时自动释放
          </div>
        </div>
      </label>

      <div :class="!draft.poolAutoEnabled && 'opacity-50'">
        <label class="text-[11px] text-ink-500">自动换号阈值 (%)</label>
        <input
          v-model.number="draft.poolSwapThresholdPercent"
          type="number"
          min="50"
          max="100"
          step="1"
          :disabled="!draft.poolAutoEnabled"
          class="w-full mt-0.5 px-3 py-1.5 bg-ink-900 border border-ink-700 rounded text-ink-100 text-right text-sm focus:outline-none focus:border-brand-500"
        />
        <p class="text-[11px] text-ink-500 mt-1">
          Cursor 用量到这个百分比就触发换号；推荐 95，避免在你写代码的时候断
        </p>
      </div>

      <label class="flex items-start gap-2 cursor-pointer">
        <input v-model="draft.poolClearCursorOnExhausted" type="checkbox" class="mt-0.5" />
        <div>
          <div class="text-sm text-ink-100">额度用尽时同时清空 Cursor 本机登录</div>
          <div class="text-[11px] text-ink-500 mt-0.5">
            避免 Cursor 一直用失效 token 报错；下次手动申请新号即可
          </div>
        </div>
      </label>
    </section>

    <section v-if="dbPath" class="card p-4">
      <div class="text-sm font-medium text-ink-100 mb-1">数据存储</div>
      <div class="text-[11px] text-ink-500 mb-2">
        账号库与设置存放在以下文件：
      </div>
      <div class="font-mono text-[11px] text-ink-300 break-all bg-ink-900/60 border border-ink-700 rounded p-2">
        {{ dbPath }}
      </div>
    </section>

    <div class="flex items-center gap-2">
      <button class="btn-primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存设置' }}
      </button>
      <span v-if="saved" class="text-[11px] text-emerald-400">已保存</span>
    </div>
  </div>
</template>
