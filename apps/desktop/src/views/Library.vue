<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import type { Account, AppSettings } from '../types';
import UsageBar from '../components/UsageBar.vue';
import UsageTotalSummary from '../components/UsageTotalSummary.vue';
import {
  accountToUsageInfo,
  resolvePlanQuotaMoney,
  resolveTotalPercent,
} from '../utils/cursorUsage';

const props = defineProps<{
  accounts: Account[];
  defaults?: AppSettings;
  /** 当前 Cursor 激活的账号 email，用来高亮 */
  currentEmail?: string | null;
  /** 当前 Cursor 激活的 user_xxx，email 缺失时用于匹配 */
  currentUserId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'reload'): void;
  (e: 'switch', id: number): void;
}>();

const keyword = ref('');
const sortBy = ref<'last_used' | 'percent' | 'remaining' | 'created'>('last_used');
const refreshingAll = ref(false);
const switchingId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const labelDraft = ref('');

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const list = kw
    ? props.accounts.filter((a) => {
        const haystack = [
          a.email || '',
          a.label || '',
          (a.tags || []).join(' '),
          a.plan || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(kw);
      })
    : [...props.accounts];

  list.sort((a, b) => {
    switch (sortBy.value) {
      case 'percent':
        return (b.totalPercent ?? -1) - (a.totalPercent ?? -1);
      case 'remaining':
        return (b.remainingUsd ?? -1) - (a.remainingUsd ?? -1);
      case 'created':
        return b.createdAt - a.createdAt;
      case 'last_used':
      default:
        return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    }
  });
  return list;
});

async function refreshAll() {
  refreshingAll.value = true;
  try {
    await api.refreshAllAccounts();
    emit('reload');
  } catch (e) {
    console.error(e);
  } finally {
    refreshingAll.value = false;
  }
}

async function refreshOne(a: Account) {
  try {
    await api.refreshAccountUsage(a.id);
    emit('reload');
  } catch (e) {
    console.error(e);
  }
}

async function switchTo(a: Account) {
  switchingId.value = a.id;
  try {
    await api.switchToAccount(a.id, {
      resetMachineId: props.defaults?.defaultResetMachineId ?? true,
      killAndRelaunch: props.defaults?.defaultRelaunch ?? true,
    });
    emit('switch', a.id);
    emit('reload');
  } catch (e: any) {
    alert(String(e?.message || e));
  } finally {
    switchingId.value = null;
  }
}

async function removeOne(a: Account) {
  if (!confirm(`确定从账号库删除 ${a.email || a.label || a.id} 吗？\n（仅删本工具记录，不影响 Cursor 本地登录）`)) return;
  try {
    await api.deleteAccount(a.id);
    emit('reload');
  } catch (e: any) {
    alert(String(e?.message || e));
  }
}

function startEditLabel(a: Account) {
  editingId.value = a.id;
  labelDraft.value = a.label || '';
}

async function saveLabel(a: Account) {
  try {
    await api.updateAccountLabel(a.id, labelDraft.value.trim() || null);
    emit('reload');
  } catch (e: any) {
    alert(String(e?.message || e));
  } finally {
    editingId.value = null;
  }
}

watch(
  () => props.accounts,
  () => {
    // 切到不同账号集时取消编辑态
    if (editingId.value !== null && !props.accounts.some((a) => a.id === editingId.value)) {
      editingId.value = null;
    }
  },
);

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}
function fmtPercent(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(1)}%`;
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

function normalizeUserId(id?: string | null) {
  if (!id) return null;
  const t = id.trim();
  const tail = t.includes('|') ? t.split('|').pop() : t;
  return tail?.trim() || null;
}

function isActive(a: Account) {
  if (props.currentEmail && a.email && a.email === props.currentEmail) return true;
  const cur = normalizeUserId(props.currentUserId);
  const acc = normalizeUserId(a.userId);
  return !!(cur && acc && cur === acc);
}

function asUsage(a: Account) {
  return accountToUsageInfo(a);
}
</script>

<template>
  <div class="space-y-3">
    <div class="card p-3 flex items-center gap-2 flex-wrap">
      <input
        v-model="keyword"
        placeholder="搜索 email / 备注 / 标签 / 计划"
        class="flex-1 min-w-[160px] px-3 py-1.5 bg-ink-900/80 border border-ink-700 rounded-md text-sm text-ink-100 focus:outline-none focus:border-brand-500 placeholder:text-ink-600"
      />
      <select
        v-model="sortBy"
        class="px-3 py-1.5 bg-ink-900/80 border border-ink-700 rounded-md text-sm text-ink-200"
      >
        <option value="last_used">按最后使用</option>
        <option value="percent">按用量百分比</option>
        <option value="remaining">按剩余额度</option>
        <option value="created">按导入时间</option>
      </select>
      <button class="btn-ghost text-xs" :disabled="refreshingAll" @click="refreshAll">
        {{ refreshingAll ? '刷新中…' : '刷新所有用量' }}
      </button>
    </div>

    <div v-if="!accounts.length" class="card p-10 text-center text-ink-400 text-sm">
      暂无账号。把卡密粘贴到「导入新账号」即可入库。
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="a in filtered"
        :key="a.id"
        :class="[
          'card p-3 transition',
          isActive(a) ? 'border-brand-500/60 bg-brand-500/5' : '',
        ]"
      >
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-ink-100 truncate">
                {{ a.email || '（未识别 email）' }}
              </span>
              <span
                v-if="isActive(a)"
                class="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/40"
              >当前账号</span>
              <span
                v-if="a.plan"
                class="text-[10px] px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 border border-ink-700"
              >{{ a.plan }}</span>
            </div>

            <div v-if="editingId === a.id" class="mt-1 flex items-center gap-1">
              <input
                v-model="labelDraft"
                class="px-2 py-0.5 text-xs bg-ink-900 border border-ink-700 rounded w-44 text-ink-100 focus:outline-none focus:border-brand-500"
                placeholder="备注"
                @keydown.enter="saveLabel(a)"
                @keydown.esc="editingId = null"
              />
              <button class="text-[11px] text-brand-300 hover:text-brand-200" @click="saveLabel(a)">保存</button>
              <button class="text-[11px] text-ink-500 hover:text-ink-300" @click="editingId = null">取消</button>
            </div>
            <div v-else class="mt-0.5 text-[11px] text-ink-400 flex items-center gap-1.5">
              <span v-if="a.label" class="text-ink-300">{{ a.label }}</span>
              <button
                class="text-[11px] text-ink-500 hover:text-brand-300"
                @click="startEditLabel(a)"
              >
                {{ a.label ? '改备注' : '加备注' }}
              </button>
              <span class="text-ink-700">·</span>
              <span>导入 {{ fmtRelative(a.createdAt) }}</span>
              <span class="text-ink-700">·</span>
              <span>最后使用 {{ fmtRelative(a.lastUsedAt) }}</span>
            </div>

            <UsageBar
              class="mt-2"
              size="sm"
              :percent="resolveTotalPercent(asUsage(a))"
              left-label="Total"
              :right-label="fmtPercent(resolveTotalPercent(asUsage(a)))"
            />
            <div
              v-if="resolvePlanQuotaMoney(asUsage(a))"
              class="flex items-baseline justify-between mt-1 text-[11px] text-ink-500"
            >
              <span>
                套餐
                {{ fmtMoney(resolvePlanQuotaMoney(asUsage(a))!.used) }}
                /
                {{ fmtMoney(resolvePlanQuotaMoney(asUsage(a))!.limit) }}
              </span>
              <span v-if="a.lastUsageAt">更新 {{ fmtRelative(a.lastUsageAt) }}</span>
            </div>
            <UsageTotalSummary class="mt-1.5" compact :usage="asUsage(a)" />
          </div>

          <div class="flex flex-col gap-1.5">
            <button
              class="btn-primary text-xs py-1 px-3"
              :disabled="switchingId === a.id"
              @click="switchTo(a)"
            >
              {{ switchingId === a.id ? '切换中…' : '切到此账号' }}
            </button>
            <button class="btn-ghost text-xs py-1 px-3" @click="refreshOne(a)">刷用量</button>
            <button class="text-[11px] text-ink-500 hover:text-rose-400" @click="removeOne(a)">删除</button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
