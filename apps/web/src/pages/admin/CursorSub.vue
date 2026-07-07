<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import CursorSubDetailDrawer from '@/components/admin/CursorSubDetailDrawer.vue';
import { membershipLabel } from '@/utils/cursor-membership';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
type TabKey = 'unsubscribed' | 'subscribed' | 'unlisted';
const activeTab = ref<TabKey>('unsubscribed');
const counts = ref<{ unsubscribed: number; subscribed: number; unlisted: number }>({
  unsubscribed: 0,
  subscribed: 0,
  unlisted: 0,
});
const tabs: { key: TabKey; label: string }[] = [
  { key: 'unsubscribed', label: '未订阅' },
  { key: 'subscribed', label: '已订阅' },
  { key: 'unlisted', label: '已下架' },
];
const keyword = ref('');
const page = ref(1);
const pageSize = 50;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  loading.value = true;
  try {
    const r: any = await api.admin.cursorSubList({
      status: activeTab.value,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize,
    });
    list.value = r.items;
    total.value = r.total;
    if (r.counts) counts.value = r.counts;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([activeTab, page], load);

function switchTab(key: TabKey) {
  if (activeTab.value === key) return;
  activeTab.value = key;
  page.value = 1;
}

const saleMeta: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '待分配', cls: 'text-amber-600' },
  ASSIGNED: { text: '已上架', cls: 'text-sky-600' },
  SOLD: { text: '已售出', cls: 'text-emerald-600' },
  UNLISTED: { text: '已下架', cls: 'text-ink-400' },
};

function remainText(row: any): string {
  if (!row.expiresAt) return '—';
  const ms = new Date(row.expiresAt).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `剩 ${d}天${h}小时` : `剩 ${h}小时`;
}

// ── 新增 / 编辑 ──────────────────────────────────────
const editing = ref<any | null>(null);
function openCreate() {
  editing.value = { id: null, email: '', password: '', emailPassword: '', cursorToken: '', note: '', subscriptionDays: 30 };
}
function openEdit(row: any) {
  editing.value = {
    id: row.id,
    email: row.email,
    password: '',
    emailPassword: '',
    cursorToken: '',
    note: row.note || '',
    subscriptionDays: row.subscriptionDays,
    hasPassword: row.hasPassword,
    hasEmailPassword: row.hasEmailPassword,
    hasCursorToken: row.hasCursorToken,
  };
}
async function saveEdit() {
  if (!editing.value) return;
  const e = editing.value;
  if (!e.email.trim()) return ElMessage.warning('请填写邮箱');
  try {
    if (e.id) {
      const body: any = { email: e.email.trim(), note: e.note, subscriptionDays: e.subscriptionDays };
      // 只有填了才更新凭据（留空保持不变）
      if (e.password) body.password = e.password;
      if (e.emailPassword) body.emailPassword = e.emailPassword;
      if (e.cursorToken) body.cursorToken = e.cursorToken;
      await api.admin.cursorSubUpdate(e.id, body);
    } else {
      await api.admin.cursorSubCreate({
        email: e.email.trim(),
        password: e.password || undefined,
        emailPassword: e.emailPassword || undefined,
        cursorToken: e.cursorToken || undefined,
        note: e.note || undefined,
        subscriptionDays: e.subscriptionDays,
      });
    }
    ElMessage.success('已保存');
    editing.value = null;
    load();
  } catch {
    /* 全局拦截器提示 */
  }
}

// ── 批量导入 ────────────────────────────────────────
const importing = ref<{ text: string; separator: string; subscriptionDays: number } | null>(null);
const importResult = ref<any | null>(null);
function openImport() {
  importing.value = { text: '', separator: '----', subscriptionDays: 30 };
  importResult.value = null;
}
async function doImport() {
  if (!importing.value?.text.trim()) return ElMessage.warning('请粘贴账号');
  try {
    importResult.value = await api.admin.cursorSubBulkImport({
      text: importing.value.text,
      separator: importing.value.separator || '----',
      subscriptionDays: importing.value.subscriptionDays,
    });
    ElMessage.success(`导入成功 ${importResult.value.created} 条`);
    load();
  } catch {
    /* 全局拦截器提示 */
  }
}

// ── 详情抽屉 ────────────────────────────────────────
const detailId = ref<number | null>(null);
function openDetail(row: any) {
  detailId.value = row.id;
}

// ── 批量：生成订阅链接 ───────────────────────────────
const batchGenerating = ref(false);
async function batchGenLinks() {
  const targets = list.value.filter((r) => r.status === 'unsubscribed' && r.hasCursorToken && !r.saleStatus);
  if (!targets.length) return ElMessage.warning('本页没有可生成的未订阅账号（需有 token）');
  await ElMessageBox.confirm(`为本页 ${targets.length} 个未订阅账号批量生成订阅链接？`, '批量生成', {
    type: 'info',
    confirmButtonText: '生成',
  });
  batchGenerating.value = true;
  try {
    const r = await api.admin.cursorSubCheckoutLinks(targets.map((t) => t.id));
    ElMessage.success(`成功 ${r.ok.length}，失败 ${r.failed.length}`);
    if (r.failed.length) {
      ElMessageBox.alert(
        r.failed.map((f: any) => `${f.email || f.id}：${f.error}`).join('\n'),
        '部分失败',
        { confirmButtonText: '关闭' },
      );
    }
    load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '批量生成失败');
  } finally {
    batchGenerating.value = false;
  }
}

// ── 批量：同步订阅状态（刷新订阅列的真实类型）──────────
const batchSyncing = ref(false);
async function batchSync() {
  const targets = list.value.filter((r) => r.hasCursorToken);
  if (!targets.length) return ElMessage.warning('本页没有可同步的账号（需有 token）');
  await ElMessageBox.confirm(`同步本页 ${targets.length} 个账号的订阅状态？（会逐个调 Cursor，稍慢）`, '批量同步', {
    type: 'info',
    confirmButtonText: '同步',
  });
  batchSyncing.value = true;
  try {
    const r = await api.admin.cursorSubSyncMany(targets.map((t) => t.id));
    ElMessage.success(`同步完成：成功 ${r.ok}，失败 ${r.failed.length}`);
    load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '批量同步失败');
  } finally {
    batchSyncing.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}
</script>

<template>
  <AdminPageHeader title="订阅号池" subtitle="Cursor 订阅账号管理（合并自 cursor-jb）：导入 → 推送仓库上架 → 售出">
    <template #actions>
      <input v-model="keyword" placeholder="搜索邮箱" class="admin-input w-44" @keyup.enter="search" />
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="search">查询</button>
      <button
        class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700 disabled:opacity-50"
        :disabled="batchSyncing"
        @click="batchSync"
      >{{ batchSyncing ? '同步中…' : '批量同步订阅' }}</button>
      <button
        class="px-3 h-9 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm disabled:opacity-50"
        :disabled="batchGenerating"
        @click="batchGenLinks"
      >{{ batchGenerating ? '生成中…' : '批量生成订阅链接' }}</button>
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="openImport">批量导入</button>
      <button class="px-3 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openCreate">+ 新增账号</button>
    </template>
  </AdminPageHeader>

  <!-- 状态 tab -->
  <div class="mb-4 flex items-center gap-1.5 border-b border-ink-100">
    <button
      v-for="t in tabs"
      :key="t.key"
      class="px-4 py-2 text-sm -mb-px border-b-2 transition"
      :class="activeTab === t.key
        ? 'border-brand-600 text-brand-700 font-medium'
        : 'border-transparent text-ink-500 hover:text-ink-800'"
      @click="switchTab(t.key)"
    >
      {{ t.label }}
      <span
        class="ml-1 text-xs px-1.5 py-0.5 rounded-full"
        :class="activeTab === t.key ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500'"
      >{{ counts[t.key] }}</span>
    </button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="暂无账号，点右上角新增或批量导入" min-width="920px">
    <thead>
      <tr>
        <th style="width:60px">ID</th>
        <th>邮箱</th>
        <th>凭据</th>
        <th>订阅状态</th>
        <th>到期</th>
        <th>销售状态</th>
        <th class="!text-right" style="width:120px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id" class="cursor-pointer" @click="openDetail(row)">
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td class="text-sm text-ink-800">{{ row.email }}</td>
        <td class="text-xs">
          <span :class="row.hasCursorToken ? 'text-emerald-600' : 'text-ink-300'" title="cursor token">T</span>
          <span class="mx-1 text-ink-200">·</span>
          <span :class="row.hasPassword ? 'text-emerald-600' : 'text-ink-300'" title="cursor 密码">P</span>
          <span class="mx-1 text-ink-200">·</span>
          <span :class="row.hasEmailPassword ? 'text-emerald-600' : 'text-ink-300'" title="邮箱密码">M</span>
        </td>
        <td>
          <span
            class="px-2 py-0.5 rounded text-xs font-medium"
            :class="membershipLabel(row.membershipType).cls"
            title="Cursor 真实订阅类型（点批量同步刷新）"
          >{{ membershipLabel(row.membershipType).text }}</span>
        </td>
        <td class="text-xs text-ink-600">{{ remainText(row) }}</td>
        <td class="text-xs">
          <span v-if="row.saleStatus" :class="(saleMeta[row.saleStatus] || {}).cls">
            {{ (saleMeta[row.saleStatus] || { text: row.saleStatus }).text }}
          </span>
          <span v-else class="text-ink-300">未推送</span>
        </td>
        <td class="text-right whitespace-nowrap text-sm" @click.stop>
          <button class="text-brand-600 hover:text-brand-700 font-medium" @click="openDetail(row)">详情</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="total > pageSize" class="mt-4 flex items-center justify-center gap-2 text-sm">
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-40" :disabled="page <= 1" @click="page--">上一页</button>
    <span class="text-ink-500">{{ page }} / {{ totalPages }}</span>
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-40" :disabled="page >= totalPages" @click="page++">下一页</button>
  </div>

  <!-- 新增 / 编辑 -->
  <el-dialog
    :model-value="!!editing"
    width="520px"
    :title="editing?.id ? '编辑账号' : '新增账号'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">邮箱</label>
        <input v-model="editing.email" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-ink-500 mb-1">Cursor 密码<span v-if="editing.id && editing.hasPassword" class="text-emerald-600">（已设置，留空不变）</span></label>
          <input v-model="editing.password" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">邮箱密码<span v-if="editing.id && editing.hasEmailPassword" class="text-emerald-600">（已设置）</span></label>
          <input v-model="editing.emailPassword" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">Cursor Token<span v-if="editing.id && editing.hasCursorToken" class="text-emerald-600">（已设置，留空不变）</span></label>
        <input v-model="editing.cursorToken" placeholder="user_xxx::eyJ..." class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-ink-500 mb-1">订阅周期（天）</label>
          <input v-model.number="editing.subscriptionDays" type="number" min="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">备注</label>
          <input v-model="editing.note" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="saveEdit">保存</button>
    </template>
  </el-dialog>

  <!-- 批量导入 -->
  <el-dialog
    :model-value="!!importing"
    width="640px"
    title="批量导入账号"
    @update:model-value="(v: boolean) => !v && (importing = null)"
    @close="importing = null"
  >
    <div v-if="importing" class="space-y-3 text-sm">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-ink-500 mb-1">分隔符</label>
          <input v-model="importing.separator" class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">订阅周期（天）</label>
          <input v-model.number="importing.subscriptionDays" type="number" min="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">账号（一行一条）</label>
        <textarea
          v-model="importing.text"
          rows="10"
          placeholder="两种格式自动识别：&#10;① 邮箱----邮箱密码----cursor密码----cursor token&#10;② 邮箱：a@b.com | WorkosCursorSessionToken：user_xxx::eyJ... | access_token：eyJ..."
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
        />
      </div>
      <div v-if="importResult" class="text-xs text-ink-600 bg-ink-50/60 rounded p-2">
        导入完成：新增 <b class="text-emerald-600">{{ importResult.created }}</b>，
        跳过 <b class="text-amber-600">{{ importResult.skipped?.length || 0 }}</b>
        <div v-if="importResult.skipped?.length" class="mt-1 max-h-32 overflow-auto">
          <div v-for="(s, i) in importResult.skipped.slice(0, 20)" :key="i" class="text-rose-500">
            第 {{ s.line }} 行：{{ s.error }}
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="importing = null">关闭</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doImport">开始导入</button>
    </template>
  </el-dialog>

  <!-- 详情抽屉：所有账号操作都在这里 -->
  <CursorSubDetailDrawer
    :id="detailId"
    @close="detailId = null"
    @changed="load"
    @edit="(row) => { detailId = null; openEdit(row); }"
  />
</template>
