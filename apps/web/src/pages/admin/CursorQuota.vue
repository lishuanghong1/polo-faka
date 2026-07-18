<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import CursorQuotaReportDrawer from '@/components/admin/CursorQuotaReportDrawer.vue';
import { membershipLabel } from '@/utils/cursor-membership';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const refreshingAll = ref(false);
const stats = ref<any>(null);

const query = reactive({
  page: 1,
  pageSize: 20,
  keyword: '',
  accountStatus: '',
});

const statusMeta: Record<string, { text: string; cls: string }> = {
  UNKNOWN: { text: '未查询', cls: 'bg-ink-100 text-ink-500' },
  HEALTHY: { text: '正常', cls: 'bg-emerald-100 text-emerald-700' },
  LOW_QUOTA: { text: '额度偏低', cls: 'bg-amber-100 text-amber-700' },
  EXHAUSTED: { text: '额度耗尽', cls: 'bg-rose-100 text-rose-700' },
  TOKEN_INVALID: { text: 'Token失效', cls: 'bg-rose-100 text-rose-700' },
};

async function load() {
  loading.value = true;
  try {
    const [r, s] = await Promise.all([
      api.admin.cursorQuotaList({
        page: query.page,
        pageSize: query.pageSize,
        keyword: query.keyword || undefined,
        accountStatus: query.accountStatus || undefined,
      }),
      api.admin.cursorQuotaStats().catch(() => null),
    ]);
    list.value = (r as any).rows || [];
    total.value = (r as any).total || 0;
    stats.value = s;
  } finally {
    loading.value = false;
  }
}

function reload() {
  query.page = 1;
  load();
}

onMounted(load);

function usd(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '-';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function dt(v: string | null | undefined) {
  if (!v) return '-';
  return new Date(v).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dateOnly(v: string | null | undefined) {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('zh-CN');
}

// ── 编辑 / 新增 ──
const editing = ref<any | null>(null);
const saving = ref(false);

/** Date → datetime-local 输入值（本地时区，非 UTC） */
function toLocalInput(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function openCreate() {
  editing.value = {
    id: null,
    email: '',
    password: '',
    emailPassword: '',
    token: '',
    purchasedAt: toLocalInput(new Date()),
    purchasePrice: 0,
    pricePerUsd: 1,
    note: '',
  };
}

function openEdit(row: any) {
  editing.value = {
    id: row.id,
    email: row.email,
    password: row.password || '',
    emailPassword: row.emailPassword || '',
    token: '',
    hasToken: row.hasToken,
    tokenMask: row.tokenMask,
    purchasedAt: row.purchasedAt ? toLocalInput(new Date(row.purchasedAt)) : '',
    purchasePrice: row.purchasePrice ?? 0,
    pricePerUsd: row.pricePerUsd ?? 1,
    note: row.note || '',
  };
}

async function saveEdit() {
  if (!editing.value) return;
  const e = editing.value;
  if (!e.id && !e.email.trim()) return ElMessage.warning('请填写邮箱');
  saving.value = true;
  try {
    const body: any = {
      password: e.password || null,
      emailPassword: e.emailPassword || null,
      purchasedAt: e.purchasedAt || null,
      purchasePrice: Number(e.purchasePrice) || 0,
      pricePerUsd: Number(e.pricePerUsd) || 0,
      note: e.note || null,
    };
    if (e.token?.trim()) body.token = e.token.trim();
    if (e.id) {
      await api.admin.cursorQuotaUpdate(e.id, body);
    } else {
      await api.admin.cursorQuotaCreate({ email: e.email.trim(), ...body });
    }
    ElMessage.success('已保存');
    editing.value = null;
    load();
  } catch {
    /* interceptor */
  } finally {
    saving.value = false;
  }
}

// ── 批量导入 ──
const importing = ref(false);
const importText = ref('');
const importPrice = ref(1);
const importCost = ref(0);
const importBusy = ref(false);

async function doImport() {
  if (!importText.value.trim()) return ElMessage.warning('请粘贴导入内容');
  importBusy.value = true;
  try {
    const r: any = await api.admin.cursorQuotaBulkImport({
      text: importText.value,
      pricePerUsd: Number(importPrice.value) || 1,
      purchasePrice: Number(importCost.value) || 0,
    });
    ElMessage.success(`导入完成：新增 ${r.created}，跳过 ${r.skipped}，失败 ${r.errorCount}`);
    importing.value = false;
    importText.value = '';
    reload();
  } catch {
    /* interceptor */
  } finally {
    importBusy.value = false;
  }
}

// ── 刷新 / 报告 / 删除 ──
const reportId = ref<number | null>(null);
const reportEmail = ref('');

async function refreshOne(row: any) {
  row._refreshing = true;
  try {
    const r: any = await api.admin.cursorQuotaRefresh(row.id);
    if (r.ok) ElMessage.success('已刷新');
    else ElMessage.warning(r.error || '刷新失败');
    await load();
  } catch {
    /* interceptor */
  } finally {
    row._refreshing = false;
  }
}

async function refreshAll() {
  await ElMessageBox.confirm('将刷新所有已配置 Token 的账号额度，可能耗时较久，确定继续？', '全量刷新', {
    type: 'warning',
  }).catch(() => Promise.reject());
  refreshingAll.value = true;
  try {
    const r: any = await api.admin.cursorQuotaRefreshAll();
    ElMessage.success(`刷新完成：共 ${r.total}，成功 ${r.ok}，失败 ${r.failed}`);
    await load();
  } catch {
    /* cancel / error */
  } finally {
    refreshingAll.value = false;
  }
}

function openReport(row: any) {
  reportId.value = row.id;
  reportEmail.value = row.email;
}

async function remove(row: any) {
  await ElMessageBox.confirm(`删除账号 ${row.email}？`, '提示', { type: 'warning' });
  await api.admin.cursorQuotaRemove(row.id);
  ElMessage.success('已删除');
  load();
}
</script>

<template>
  <AdminPageHeader title="额度号池" subtitle="按 Cursor 额度计价出售 · 实时已售 = 已用$ × 单价（元/$）">
    <template #actions>
      <button
        class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700"
        :disabled="refreshingAll"
        @click="refreshAll"
      >
        {{ refreshingAll ? '刷新中…' : '全量刷新额度' }}
      </button>
      <button
        class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700"
        @click="importing = true"
      >
        批量导入
      </button>
      <button
        class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        @click="openCreate"
      >
        新增账号
      </button>
    </template>
  </AdminPageHeader>

  <!-- 统计条 -->
  <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4">
      <div class="text-xs text-ink-400">账号总数</div>
      <div class="text-2xl font-semibold mt-1">{{ stats.counts?.total ?? 0 }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-400">采购合计</div>
      <div class="text-2xl font-semibold mt-1">¥{{ Number(stats.purchaseTotal || 0).toFixed(2) }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-400">实时已售合计</div>
      <div class="text-2xl font-semibold mt-1 text-emerald-600">¥{{ Number(stats.soldTotal || 0).toFixed(2) }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-400">毛利合计</div>
      <div
        class="text-2xl font-semibold mt-1"
        :class="Number(stats.profitTotal || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'"
      >
        ¥{{ Number(stats.profitTotal || 0).toFixed(2) }}
      </div>
    </div>
  </div>

  <!-- 筛选 -->
  <div class="card p-3 mb-4 flex flex-wrap gap-2 items-center">
    <input
      v-model="query.keyword"
      class="input w-56"
      placeholder="搜索邮箱 / 备注"
      @keyup.enter="reload"
    />
    <select v-model="query.accountStatus" class="input w-36" @change="reload">
      <option value="">全部状态</option>
      <option value="HEALTHY">正常</option>
      <option value="LOW_QUOTA">额度偏低</option>
      <option value="EXHAUSTED">额度耗尽</option>
      <option value="TOKEN_INVALID">Token失效</option>
      <option value="UNKNOWN">未查询</option>
    </select>
    <button class="px-3 py-1.5 rounded-lg border border-ink-200 text-sm" @click="reload">查询</button>
  </div>

  <DataTable :loading="loading">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-ink-500 border-b border-ink-100">
          <th class="py-2 px-3">邮箱</th>
          <th class="py-2 px-3">套餐</th>
          <th class="py-2 px-3">额度用量</th>
          <th class="py-2 px-3">账期截止</th>
          <th class="py-2 px-3">状态</th>
          <th class="py-2 px-3">采购时间</th>
          <th class="py-2 px-3 text-right">采购价</th>
          <th class="py-2 px-3 text-right">单价(元/$)</th>
          <th class="py-2 px-3 text-right">实时已售</th>
          <th class="py-2 px-3 text-right">毛利</th>
          <th class="py-2 px-3">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!list.length && !loading">
          <td colspan="11" class="py-10 text-center text-ink-400">暂无数据</td>
        </tr>
        <tr
          v-for="row in list"
          :key="row.id"
          class="border-b border-ink-50 hover:bg-ink-50/50"
        >
          <td class="py-2.5 px-3">
            <div class="font-medium">{{ row.email }}</div>
            <div v-if="row.lastCheckError" class="text-xs text-rose-500 truncate max-w-[180px]" :title="row.lastCheckError">
              {{ row.lastCheckError }}
            </div>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-1.5 py-0.5 rounded text-xs" :class="membershipLabel(row.membershipType).cls">
              {{ membershipLabel(row.membershipType).text }}
            </span>
          </td>
          <td class="py-2.5 px-3 tabular-nums">
            <template v-if="row.isUnlimited">无限额度</template>
            <template v-else-if="row.totalCostCents === null && row.planLimitCents === null">
              <span class="text-ink-400">未查询</span>
            </template>
            <template v-else>
              {{ usd(row.totalCostCents) }} / {{ usd(row.planLimitCents) }}
            </template>
          </td>
          <td class="py-2.5 px-3 whitespace-nowrap">{{ dateOnly(row.billingCycleEnd) }}</td>
          <td class="py-2.5 px-3">
            <span class="px-1.5 py-0.5 rounded text-xs" :class="statusMeta[row.accountStatus]?.cls">
              {{ statusMeta[row.accountStatus]?.text || row.accountStatus }}
            </span>
          </td>
          <td class="py-2.5 px-3 whitespace-nowrap">{{ dt(row.purchasedAt) }}</td>
          <td class="py-2.5 px-3 text-right tabular-nums">¥{{ Number(row.purchasePrice || 0).toFixed(2) }}</td>
          <td class="py-2.5 px-3 text-right tabular-nums">{{ Number(row.pricePerUsd || 0).toFixed(2) }}</td>
          <td class="py-2.5 px-3 text-right tabular-nums font-medium text-emerald-600">
            ¥{{ Number(row.soldAmount || 0).toFixed(2) }}
          </td>
          <td
            class="py-2.5 px-3 text-right tabular-nums"
            :class="Number(row.profit || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'"
          >
            ¥{{ Number(row.profit || 0).toFixed(2) }}
          </td>
          <td class="py-2.5 px-3 whitespace-nowrap">
            <button class="text-brand-600 hover:underline mr-2" :disabled="row._refreshing" @click="refreshOne(row)">
              {{ row._refreshing ? '…' : '刷新' }}
            </button>
            <button class="text-brand-600 hover:underline mr-2" @click="openReport(row)">报告</button>
            <button class="text-brand-600 hover:underline mr-2" @click="openEdit(row)">编辑</button>
            <button class="text-rose-600 hover:underline" @click="remove(row)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </DataTable>

  <div class="flex justify-end items-center gap-3 mt-4 text-sm">
    <span class="text-ink-400">共 {{ total }} 条</span>
    <button
      class="px-2 py-1 border rounded disabled:opacity-40"
      :disabled="query.page <= 1"
      @click="query.page--; load()"
    >
      上一页
    </button>
    <span>{{ query.page }}</span>
    <button
      class="px-2 py-1 border rounded disabled:opacity-40"
      :disabled="query.page * query.pageSize >= total"
      @click="query.page++; load()"
    >
      下一页
    </button>
  </div>

  <!-- 编辑弹窗 -->
  <div
    v-if="editing"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="editing = null"
  >
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
      <div class="text-lg font-semibold">{{ editing.id ? `编辑 · ${editing.email}` : '新增账号' }}</div>
      <label v-if="!editing.id" class="block text-sm">
        <span class="text-ink-500">邮箱</span>
        <input v-model="editing.email" class="input w-full mt-1" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-ink-500">采购时间</span>
          <input v-model="editing.purchasedAt" type="datetime-local" class="input w-full mt-1" />
        </label>
        <label class="block text-sm">
          <span class="text-ink-500">采购价（元）</span>
          <input v-model.number="editing.purchasePrice" type="number" min="0" step="0.01" class="input w-full mt-1" />
        </label>
      </div>
      <label class="block text-sm">
        <span class="text-ink-500">单价（元 / $1 额度）</span>
        <input v-model.number="editing.pricePerUsd" type="number" min="0" step="0.01" class="input w-full mt-1" />
        <span class="text-xs text-ink-400 mt-1 block">实时已售 = 已用额度($) × 此单价</span>
      </label>
      <label class="block text-sm">
        <span class="text-ink-500">Cursor Token</span>
        <textarea
          v-model="editing.token"
          class="input w-full mt-1"
          rows="2"
          :placeholder="editing.hasToken ? `已保存：${editing.tokenMask}（留空不改）` : 'user_xxx::jwt'"
        />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-ink-500">登录密码</span>
          <input v-model="editing.password" class="input w-full mt-1" />
        </label>
        <label class="block text-sm">
          <span class="text-ink-500">邮箱密码</span>
          <input v-model="editing.emailPassword" class="input w-full mt-1" />
        </label>
      </div>
      <label class="block text-sm">
        <span class="text-ink-500">备注</span>
        <textarea v-model="editing.note" class="input w-full mt-1" rows="2" />
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button class="px-3 py-1.5 rounded-lg border text-sm" @click="editing = null">取消</button>
        <button
          class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm"
          :disabled="saving"
          @click="saveEdit"
        >
          保存
        </button>
      </div>
    </div>
  </div>

  <!-- 批量导入 -->
  <div
    v-if="importing"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="importing = false"
  >
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-xl p-5 space-y-3">
      <div class="text-lg font-semibold">批量导入</div>
      <p class="text-xs text-ink-400">每行：email----邮箱密码----登录密码----Token（后几段可缺省）</p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-ink-500">默认单价（元/$）</span>
          <input v-model.number="importPrice" type="number" min="0" step="0.01" class="input w-full mt-1" />
        </label>
        <label class="block text-sm">
          <span class="text-ink-500">默认采购价（元）</span>
          <input v-model.number="importCost" type="number" min="0" step="0.01" class="input w-full mt-1" />
        </label>
      </div>
      <textarea v-model="importText" class="input w-full" rows="10" placeholder="a@x.com----emailpwd----loginpwd----user_xxx::jwt" />
      <div class="flex justify-end gap-2">
        <button class="px-3 py-1.5 rounded-lg border text-sm" @click="importing = false">取消</button>
        <button
          class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm"
          :disabled="importBusy"
          @click="doImport"
        >
          导入
        </button>
      </div>
    </div>
  </div>

  <CursorQuotaReportDrawer
    :id="reportId"
    :email="reportEmail"
    @close="reportId = null"
  />
</template>
