<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import VaultUsageDrawer from '@/components/admin/VaultUsageDrawer.vue';

type VaultAccount = {
  id: number;
  email: string;
  groupId: number | null;
  status: string;
  tags: string | null;
  note: string | null;
  batchTag: string | null;
  expiresAt: string | null;
  checkResult: string | null;
  checkMessage: string | null;
  membershipType: string | null;
  planPercent: number | null;
  lastCheckAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasToken: boolean;
  group?: { id: number; name: string } | null;
};

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: '可用',
  USED: '已用',
  DISABLED: '停用',
};
const STATUS_CLS: Record<string, string> = {
  AVAILABLE: 'bg-brand-50 text-brand-700 border-brand-200',
  USED: 'bg-ink-100 text-ink-500 border-ink-200',
  DISABLED: 'bg-rose-50 text-rose-700 border-rose-200',
};
const CHECK_LABELS: Record<string, string> = {
  VALID: '有效',
  INVALID: '失效',
  ERROR: '异常',
};
const CHECK_CLS: Record<string, string> = {
  VALID: 'bg-brand-50 text-brand-700 border-brand-200',
  INVALID: 'bg-rose-50 text-rose-700 border-rose-200',
  ERROR: 'bg-amber-50 text-amber-700 border-amber-200',
};

const list = ref<VaultAccount[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 50;
const loading = ref(false);
const stats = ref<any>({});
const groups = ref<Array<{ id: number; name: string; sort: number; accountCount: number }>>([]);
const batches = ref<Array<{ batchTag: string; count: number }>>([]);
const selected = ref<Set<number>>(new Set());

const filter = reactive<{
  keyword: string;
  status: string;
  groupId: string;
  batchTag: string;
  checkResult: string;
  expiring: string;
  recycled: boolean;
}>({
  keyword: '',
  status: '',
  groupId: '',
  batchTag: '',
  checkResult: '',
  expiring: '',
  recycled: false,
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function buildParams() {
  const p: any = { page: page.value, pageSize };
  if (filter.keyword.trim()) p.keyword = filter.keyword.trim();
  if (filter.status) p.status = filter.status;
  if (filter.groupId !== '') p.groupId = Number(filter.groupId);
  if (filter.batchTag) p.batchTag = filter.batchTag;
  if (filter.checkResult) p.checkResult = filter.checkResult;
  if (filter.expiring) p.expiring = '1';
  if (filter.recycled) p.recycled = '1';
  return p;
}

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.vaultList(buildParams());
    list.value = r.items;
    total.value = r.total;
    selected.value = new Set();
  } finally {
    loading.value = false;
  }
}

async function loadMeta() {
  const [s, g, b] = await Promise.all([
    api.admin.vaultStats(),
    api.admin.vaultGroups(),
    api.admin.vaultBatches(),
  ]);
  stats.value = s;
  groups.value = g;
  batches.value = b;
}

onMounted(async () => {
  await loadMeta();
  await load();
});

watch(page, load);
watch(
  () => [filter.status, filter.groupId, filter.batchTag, filter.checkResult, filter.expiring, filter.recycled],
  () => {
    page.value = 1;
    load();
  },
);

function search() {
  page.value = 1;
  load();
}

function refreshAll() {
  loadMeta();
  load();
}

// ── 选择 ──
function toggle(id: number) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}
function toggleAll() {
  if (selected.value.size === list.value.length && list.value.length > 0) {
    selected.value = new Set();
  } else {
    selected.value = new Set(list.value.map((r) => r.id));
  }
}
const allChecked = computed(() => selected.value.size === list.value.length && list.value.length > 0);

// ── 复制 ──
function copy(text: string, label = '内容') {
  navigator.clipboard.writeText(text);
  ElMessage.success(`已复制${label}`);
}

// ─────────── 新增 / 编辑 ───────────
const editing = ref<any | null>(null);
const editIsNew = computed(() => !editing.value?.id);

function openCreate() {
  editing.value = {
    email: '',
    password: '',
    emailPassword: '',
    token: '',
    groupId: '',
    status: 'AVAILABLE',
    tags: '',
    note: '',
    expiresAt: '',
  };
}

async function openEdit(row: VaultAccount) {
  const full: any = await api.admin.vaultGet(row.id);
  editing.value = {
    id: row.id,
    email: full.email,
    password: '',
    emailPassword: '',
    token: '',
    passwordMasked: full.passwordMasked,
    emailPasswordMasked: full.emailPasswordMasked,
    tokenMasked: full.tokenMasked,
    groupId: full.groupId ?? '',
    status: full.status,
    tags: full.tags || '',
    note: full.note || '',
    expiresAt: full.expiresAt ? full.expiresAt.slice(0, 10) : '',
  };
}

async function saveEdit() {
  const e = editing.value;
  if (!e.email?.trim() || !e.email.includes('@')) {
    ElMessage.warning('请填写正确的邮箱');
    return;
  }
  const body: any = {
    email: e.email.trim(),
    groupId: e.groupId === '' ? null : Number(e.groupId),
    status: e.status,
    tags: e.tags?.trim() || '',
    note: e.note?.trim() || '',
    expiresAt: e.expiresAt || null,
  };
  // 编辑时仅在填写了新值时才覆盖密文字段（留空 = 不改）
  if (editIsNew.value) {
    body.password = e.password?.trim() || undefined;
    body.emailPassword = e.emailPassword?.trim() || undefined;
    body.token = e.token?.trim() || undefined;
    await api.admin.vaultCreate(body);
    ElMessage.success('已新增账号');
  } else {
    if (e.password?.trim()) body.password = e.password.trim();
    if (e.emailPassword?.trim()) body.emailPassword = e.emailPassword.trim();
    if (e.token?.trim()) body.token = e.token.trim();
    await api.admin.vaultUpdate(e.id, body);
    ElMessage.success('已保存');
  }
  editing.value = null;
  refreshAll();
}

// ─────────── 查看明文 ───────────
const revealing = ref<any | null>(null);
async function openReveal(row: VaultAccount) {
  const r = await api.admin.vaultReveal(row.id);
  revealing.value = r;
}

// ─────────── 批量导入 ───────────
const IMPORT_FIELD_OPTIONS = [
  { key: 'email', label: '邮箱' },
  { key: 'password', label: '密码' },
  { key: 'emailPassword', label: '邮箱密码' },
  { key: 'token', label: 'Token' },
  { key: 'note', label: '备注' },
];
const importing = ref<{
  text: string;
  separator: string;
  fields: string[];
  groupId: string;
  status: string;
  tags: string;
} | null>(null);
const importResult = ref<any | null>(null);

function openImport() {
  importResult.value = null;
  importing.value = {
    text: '',
    separator: '----',
    fields: ['email', 'password', 'emailPassword', 'token'],
    groupId: '',
    status: 'AVAILABLE',
    tags: '',
  };
}
const importLineCount = computed(
  () => (importing.value?.text || '').split(/\r?\n/).filter((s) => s.trim()).length,
);
function toggleImportField(key: string) {
  if (!importing.value) return;
  const arr = importing.value.fields;
  const i = arr.indexOf(key);
  if (i >= 0) {
    if (key === 'email') return; // email 必选
    arr.splice(i, 1);
  } else {
    arr.push(key);
  }
}
async function doImport() {
  if (!importing.value?.text.trim()) {
    ElMessage.warning('请粘贴要导入的账号');
    return;
  }
  const r = await api.admin.vaultBulkImport({
    text: importing.value.text,
    separator: importing.value.separator || '----',
    fields: importing.value.fields,
    groupId: importing.value.groupId === '' ? null : Number(importing.value.groupId),
    status: importing.value.status,
    tags: importing.value.tags?.trim() || undefined,
  });
  importResult.value = r;
  ElMessage.success(`成功导入 ${r.created} 条`);
  refreshAll();
}

// ─────────── 批量操作 ───────────
async function bulkDelete() {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  await ElMessageBox.confirm(`将选中的 ${selected.value.size} 个账号移入回收站？`, '提示', {
    type: 'warning',
  });
  const r = await api.admin.vaultBulkAction({ ids: [...selected.value], action: 'delete' });
  ElMessage.success(`已移入回收站 ${r.affected} 个`);
  refreshAll();
}
async function bulkRestore() {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  const r = await api.admin.vaultBulkAction({ ids: [...selected.value], action: 'restore' });
  ElMessage.success(`已恢复 ${r.affected} 个`);
  refreshAll();
}
async function bulkPurge() {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  await ElMessageBox.confirm(
    `彻底删除选中的 ${selected.value.size} 个账号？此操作不可恢复！`,
    '危险操作',
    { type: 'warning', confirmButtonText: '彻底删除', confirmButtonClass: 'el-button--danger' },
  );
  const r = await api.admin.vaultBulkAction({ ids: [...selected.value], action: 'purge' });
  ElMessage.success(`已彻底删除 ${r.affected} 个`);
  refreshAll();
}
async function bulkStatus(status: string) {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  const r = await api.admin.vaultBulkAction({ ids: [...selected.value], action: 'status', status });
  ElMessage.success(`已更新 ${r.affected} 个为「${STATUS_LABELS[status]}」`);
  refreshAll();
}
async function bulkMove(groupId: string) {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  const r = await api.admin.vaultBulkAction({
    ids: [...selected.value],
    action: 'move',
    groupId: groupId === '' ? null : Number(groupId),
  });
  ElMessage.success(`已移动 ${r.affected} 个`);
  refreshAll();
}

// ─────────── 有效性检测 ───────────
const checkingId = ref<number | null>(null);
const batchChecking = ref(false);

async function checkOne(row: VaultAccount) {
  checkingId.value = row.id;
  try {
    const r = await api.admin.vaultCheck(row.id);
    const idx = list.value.findIndex((x) => x.id === row.id);
    if (idx >= 0 && r.account) list.value[idx] = r.account;
    const tip = { VALID: 'success', INVALID: 'error', ERROR: 'warning' } as const;
    ElMessage[tip[r.result as keyof typeof tip] || 'info'](`${row.email}：${r.message}`);
  } finally {
    checkingId.value = null;
  }
}
async function checkSelected() {
  if (!selected.value.size) return ElMessage.warning('请先勾选账号');
  if (selected.value.size > 200) return ElMessage.warning('单次最多检测 200 个');
  batchChecking.value = true;
  try {
    const r = await api.admin.vaultCheckBatch([...selected.value]);
    ElMessage.success(`检测完成：有效 ${r.ok}，失效 ${r.invalid}，异常 ${r.error}`);
    load();
  } finally {
    batchChecking.value = false;
  }
}

// ─────────── 导出 ───────────
const exporting = ref<{ scope: 'selected' | 'filtered'; fields: string[]; separator: string } | null>(
  null,
);
const EXPORT_FIELD_OPTIONS = [
  { key: 'email', label: '邮箱' },
  { key: 'password', label: '密码' },
  { key: 'emailPassword', label: '邮箱密码' },
  { key: 'token', label: 'Token' },
  { key: 'status', label: '状态' },
  { key: 'tags', label: '标签' },
  { key: 'note', label: '备注' },
];
function openExport() {
  exporting.value = {
    scope: selected.value.size ? 'selected' : 'filtered',
    fields: ['email', 'password', 'token'],
    separator: '----',
  };
}
function toggleExportField(key: string) {
  if (!exporting.value) return;
  const arr = exporting.value.fields;
  const i = arr.indexOf(key);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(key);
}
async function doExport() {
  if (!exporting.value?.fields.length) return ElMessage.warning('请至少选择一个导出字段');
  const body: any = {
    fields: exporting.value.fields,
    separator: exporting.value.separator || '----',
  };
  if (exporting.value.scope === 'selected') {
    if (!selected.value.size) return ElMessage.warning('未勾选任何账号');
    body.ids = [...selected.value];
  } else {
    Object.assign(body, buildParams());
    delete body.page;
    delete body.pageSize;
  }
  const r = await api.admin.vaultExport(body);
  const blob = new Blob([r.text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `账号库导出_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success(`已导出 ${r.count} 条`);
  exporting.value = null;
}

// ─────────── 分组管理 ───────────
const groupPanel = ref(false);
const newGroupName = ref('');
async function addGroup() {
  if (!newGroupName.value.trim()) return;
  await api.admin.vaultCreateGroup({ name: newGroupName.value.trim() });
  newGroupName.value = '';
  await loadMeta();
  ElMessage.success('已添加分组');
}
async function renameGroup(g: { id: number; name: string }) {
  const { value } = await ElMessageBox.prompt('新的分组名', '重命名', {
    inputValue: g.name,
    inputPattern: /\S+/,
    inputErrorMessage: '名称不能为空',
  });
  await api.admin.vaultUpdateGroup(g.id, { name: value.trim() });
  await loadMeta();
  ElMessage.success('已重命名');
}
async function removeGroup(g: { id: number; name: string; accountCount: number }) {
  await ElMessageBox.confirm(
    `删除分组「${g.name}」？组内 ${g.accountCount} 个账号会变为未分组（账号不删除）。`,
    '提示',
    { type: 'warning' },
  );
  await api.admin.vaultRemoveGroup(g.id);
  await loadMeta();
  if (filter.groupId === String(g.id)) filter.groupId = '';
  ElMessage.success('已删除分组');
}

// ─────────── 单个删除 / 回收站 ───────────
async function del(row: VaultAccount) {
  await ElMessageBox.confirm(`将「${row.email}」移入回收站？`, '提示', { type: 'warning' });
  await api.admin.vaultRemove(row.id);
  ElMessage.success('已移入回收站');
  refreshAll();
}
async function restore(row: VaultAccount) {
  await api.admin.vaultRestore(row.id);
  ElMessage.success('已恢复');
  refreshAll();
}
async function purge(row: VaultAccount) {
  await ElMessageBox.confirm(`彻底删除「${row.email}」？不可恢复！`, '危险操作', {
    type: 'warning',
    confirmButtonText: '彻底删除',
    confirmButtonClass: 'el-button--danger',
  });
  await api.admin.vaultPurge(row.id);
  ElMessage.success('已彻底删除');
  refreshAll();
}

// ─────────── 操作历史 ───────────
const eventPanel = ref<{ row: VaultAccount; items: any[] } | null>(null);
const EVENT_LABELS: Record<string, string> = {
  CREATE: '新增',
  UPDATE: '编辑',
  DELETE: '移入回收站',
  RESTORE: '恢复',
  REVEAL: '查看明文',
  EXPORT: '导出',
  CHECK: '有效性检测',
  USAGE: '查询用量',
  STATUS: '改状态',
  MOVE_GROUP: '移动分组',
};
async function openEvents(row: VaultAccount) {
  const r = await api.admin.vaultEvents(row.id, { pageSize: 50 });
  eventPanel.value = { row, items: r.items };
}

// ─────────── 详细用量 ───────────
const usageId = ref<number | null>(null);
const usageEmail = ref('');
function openUsage(row: VaultAccount) {
  if (!row.hasToken) {
    ElMessage.warning('该账号未录入 Token，无法查询用量');
    return;
  }
  usageId.value = row.id;
  usageEmail.value = row.email;
}

function fmtDate(s: string | null, withTime = false) {
  if (!s) return '—';
  const d = new Date(s);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!withTime) return date;
  return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function isExpiringSoon(s: string | null) {
  if (!s) return false;
  const t = new Date(s).getTime();
  return t <= Date.now() + 7 * 24 * 3600 * 1000;
}
</script>

<template>
  <AdminPageHeader
    title="账号库"
    :subtitle="`共 ${stats.total || 0} 个账号 · 可用 ${stats.AVAILABLE || 0} · 回收站 ${stats.recycled || 0}`"
  >
    <template #actions>
      <button class="admin-btn-ghost" @click="groupPanel = true">分组管理</button>
      <button class="admin-btn-ghost" @click="openExport">导出</button>
      <button class="admin-btn-ghost" @click="openImport">批量导入</button>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openCreate">
        + 新增账号
      </button>
    </template>
  </AdminPageHeader>

  <!-- 统计 -->
  <div class="card p-4 mb-4 flex items-center divide-x divide-ink-100 overflow-x-auto">
    <div class="flex-1 px-4 first:pl-2 min-w-[90px]">
      <div class="text-xs text-ink-500">总数</div>
      <div class="mt-1 text-lg font-medium text-ink-900">{{ stats.total || 0 }}</div>
    </div>
    <div class="flex-1 px-4 min-w-[90px]">
      <div class="text-xs text-ink-500">可用</div>
      <div class="mt-1 text-lg font-semibold text-brand-700">{{ stats.AVAILABLE || 0 }}</div>
    </div>
    <div class="flex-1 px-4 min-w-[90px]">
      <div class="text-xs text-ink-500">已用</div>
      <div class="mt-1 text-lg font-medium text-ink-700">{{ stats.USED || 0 }}</div>
    </div>
    <div class="flex-1 px-4 min-w-[90px]">
      <div class="text-xs text-ink-500">停用</div>
      <div class="mt-1 text-lg font-medium text-ink-700">{{ stats.DISABLED || 0 }}</div>
    </div>
    <div class="flex-1 px-4 min-w-[90px]">
      <div class="text-xs text-ink-500">7天内到期</div>
      <div class="mt-1 text-lg font-medium text-amber-700">{{ stats.expiring || 0 }}</div>
    </div>
    <div class="flex-1 px-4 min-w-[90px]">
      <div class="text-xs text-ink-500">检测失效</div>
      <div class="mt-1 text-lg font-medium text-rose-700">{{ stats.invalid || 0 }}</div>
    </div>
    <div class="flex-1 px-4 last:pr-2 min-w-[90px]">
      <div class="text-xs text-ink-500">回收站</div>
      <div class="mt-1 text-lg font-medium text-ink-500">{{ stats.recycled || 0 }}</div>
    </div>
  </div>

  <!-- 筛选栏 -->
  <div class="card p-3 mb-3 flex flex-wrap items-center gap-2">
    <input
      v-model="filter.keyword"
      placeholder="搜索邮箱 / 备注 / 标签 / 批次"
      class="admin-input flex-1 min-w-[180px]"
      @keyup.enter="search"
    />
    <select v-model="filter.status" class="admin-select">
      <option value="">全部状态</option>
      <option value="AVAILABLE">可用</option>
      <option value="USED">已用</option>
      <option value="DISABLED">停用</option>
    </select>
    <select v-model="filter.groupId" class="admin-select">
      <option value="">全部分组</option>
      <option value="0">未分组</option>
      <option v-for="g in groups" :key="g.id" :value="String(g.id)">{{ g.name }} ({{ g.accountCount }})</option>
    </select>
    <select v-model="filter.batchTag" class="admin-select">
      <option value="">全部批次</option>
      <option v-for="b in batches" :key="b.batchTag" :value="b.batchTag">{{ b.batchTag }} ({{ b.count }})</option>
    </select>
    <select v-model="filter.checkResult" class="admin-select">
      <option value="">全部检测</option>
      <option value="VALID">有效</option>
      <option value="INVALID">失效</option>
      <option value="ERROR">异常</option>
      <option value="UNCHECKED">未检测</option>
    </select>
    <label class="flex items-center gap-1 text-sm text-ink-600 px-1">
      <input v-model="filter.expiring" type="checkbox" true-value="1" false-value="" /> 快到期
    </label>
    <label class="flex items-center gap-1 text-sm text-ink-600 px-1">
      <input v-model="filter.recycled" type="checkbox" /> 回收站
    </label>
    <button class="px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="search">查询</button>
  </div>

  <!-- 批量操作条 -->
  <div v-if="selected.size" class="card p-2.5 mb-3 flex flex-wrap items-center gap-2 text-sm">
    <span class="text-ink-600 px-1">已选 <b>{{ selected.size }}</b> 个</span>
    <template v-if="!filter.recycled">
      <button class="admin-btn-ghost" :disabled="batchChecking" @click="checkSelected">
        {{ batchChecking ? '检测中…' : '检测有效性' }}
      </button>
      <div class="inline-flex items-center gap-1">
        <span class="text-ink-400 text-xs">改状态</span>
        <button class="admin-chip" @click="bulkStatus('AVAILABLE')">可用</button>
        <button class="admin-chip" @click="bulkStatus('USED')">已用</button>
        <button class="admin-chip" @click="bulkStatus('DISABLED')">停用</button>
      </div>
      <select class="admin-select" @change="(e: any) => { bulkMove(e.target.value); e.target.value = ''; }">
        <option value="" disabled selected>移动到分组…</option>
        <option value="__none">未分组</option>
        <option v-for="g in groups" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
      </select>
      <button class="admin-btn-ghost !text-rose-600 !border-rose-200 hover:!bg-rose-50" @click="bulkDelete">移入回收站</button>
    </template>
    <template v-else>
      <button class="admin-btn-ghost" @click="bulkRestore">恢复</button>
      <button class="admin-btn-ghost !text-rose-600 !border-rose-200 hover:!bg-rose-50" @click="bulkPurge">彻底删除</button>
    </template>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1080px">
    <thead>
      <tr>
        <th style="width: 36px">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
        </th>
        <th style="width: 56px">ID</th>
        <th>邮箱</th>
        <th style="width: 80px">分组</th>
        <th style="width: 64px">状态</th>
        <th style="width: 96px">凭据</th>
        <th style="width: 120px">检测</th>
        <th style="width: 96px">到期</th>
        <th>标签 / 备注</th>
        <th class="!text-right" style="width: 150px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td><input type="checkbox" :checked="selected.has(row.id)" @change="toggle(row.id)" /></td>
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td>
          <button class="text-ink-900 hover:text-brand-700 font-medium break-all text-left" @click="copy(row.email, '邮箱')">
            {{ row.email }}
          </button>
        </td>
        <td class="text-ink-600 text-xs">{{ row.group?.name || '—' }}</td>
        <td>
          <span class="inline-flex px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap" :class="STATUS_CLS[row.status]">
            {{ STATUS_LABELS[row.status] || row.status }}
          </span>
        </td>
        <td class="text-xs">
          <div class="flex gap-1 text-ink-400">
            <span :class="row.hasPassword ? 'text-brand-600' : ''" title="密码">密</span>
            <span :class="row.hasEmailPassword ? 'text-brand-600' : ''" title="邮箱密码">邮</span>
            <span :class="row.hasToken ? 'text-brand-600' : ''" title="Token">T</span>
          </div>
        </td>
        <td>
          <div v-if="row.checkResult" class="flex flex-col gap-0.5">
            <span class="inline-flex w-fit px-1.5 py-0.5 rounded text-[11px] border" :class="CHECK_CLS[row.checkResult]">
              {{ CHECK_LABELS[row.checkResult] || row.checkResult }}
              <template v-if="row.checkResult === 'VALID' && row.planPercent != null">· {{ Math.round(row.planPercent) }}%</template>
            </span>
            <span v-if="row.membershipType" class="text-[10px] text-ink-400">{{ row.membershipType }}</span>
          </div>
          <span v-else class="text-ink-300 text-xs">未检测</span>
        </td>
        <td class="text-xs" :class="isExpiringSoon(row.expiresAt) ? 'text-amber-700 font-medium' : 'text-ink-500'">
          {{ fmtDate(row.expiresAt) }}
        </td>
        <td>
          <div v-if="row.tags" class="flex flex-wrap gap-1 mb-0.5">
            <span v-for="t in row.tags.split(',')" :key="t" class="px-1.5 py-0.5 bg-ink-50 text-ink-600 rounded text-[10px]">{{ t }}</span>
          </div>
          <div v-if="row.note" class="text-xs text-ink-400 max-w-[200px] truncate" :title="row.note">{{ row.note }}</div>
        </td>
        <td class="text-right whitespace-nowrap">
          <template v-if="!filter.recycled">
            <button class="admin-link" @click="openReveal(row)">查看</button>
            <button class="admin-link" @click="openEdit(row)">编辑</button>
            <button class="admin-link" :disabled="checkingId === row.id" @click="checkOne(row)">
              {{ checkingId === row.id ? '检测中' : '检测' }}
            </button>
            <button v-if="row.hasToken" class="admin-link" @click="openUsage(row)">用量</button>
            <button class="admin-link" @click="openEvents(row)">历史</button>
            <button class="admin-link !text-rose-500" @click="del(row)">删除</button>
          </template>
          <template v-else>
            <button class="admin-link" @click="restore(row)">恢复</button>
            <button class="admin-link !text-rose-500" @click="purge(row)">彻底删除</button>
          </template>
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
    :title="editIsNew ? '新增账号' : '编辑账号'"
    width="560px"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="admin-label">邮箱 <span class="text-rose-500">*</span></label>
        <input v-model="editing.email" class="admin-input w-full" placeholder="account@example.com" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="admin-label">密码 <span v-if="!editIsNew" class="text-ink-400">（留空不改）</span></label>
          <input v-model="editing.password" class="admin-input w-full" :placeholder="editing.passwordMasked || '未设置'" />
        </div>
        <div>
          <label class="admin-label">邮箱密码</label>
          <input v-model="editing.emailPassword" class="admin-input w-full" :placeholder="editing.emailPasswordMasked || '未设置'" />
        </div>
      </div>
      <div>
        <label class="admin-label">Token <span v-if="!editIsNew" class="text-ink-400">（留空不改）</span></label>
        <textarea v-model="editing.token" rows="2" class="admin-input w-full font-mono text-xs" :placeholder="editing.tokenMasked || 'WorkosCursorSessionToken 值'" />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="admin-label">分组</label>
          <select v-model="editing.groupId" class="admin-select w-full">
            <option value="">未分组</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>
        <div>
          <label class="admin-label">状态</label>
          <select v-model="editing.status" class="admin-select w-full">
            <option value="AVAILABLE">可用</option>
            <option value="USED">已用</option>
            <option value="DISABLED">停用</option>
          </select>
        </div>
        <div>
          <label class="admin-label">到期日期</label>
          <input v-model="editing.expiresAt" type="date" class="admin-input w-full" />
        </div>
      </div>
      <div>
        <label class="admin-label">标签（逗号分隔）</label>
        <input v-model="editing.tags" class="admin-input w-full" placeholder="如：渠道A,自用" />
      </div>
      <div>
        <label class="admin-label">备注</label>
        <input v-model="editing.note" class="admin-input w-full" />
      </div>
    </div>
    <template #footer>
      <button class="admin-btn-ghost mr-2" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="saveEdit">保存</button>
    </template>
  </el-dialog>

  <!-- 查看明文 -->
  <el-dialog
    :model-value="!!revealing"
    title="账号明文"
    width="520px"
    @update:model-value="(v: boolean) => !v && (revealing = null)"
    @close="revealing = null"
  >
    <div v-if="revealing" class="space-y-3 text-sm">
      <div v-for="f in [
        { k: 'email', label: '邮箱' },
        { k: 'password', label: '密码' },
        { k: 'emailPassword', label: '邮箱密码' },
        { k: 'token', label: 'Token' },
      ]" :key="f.k">
        <label class="admin-label">{{ f.label }}</label>
        <div class="flex items-center gap-2">
          <code class="flex-1 px-3 py-2 bg-ink-50 rounded-lg font-mono text-xs break-all min-h-[38px]">
            {{ (revealing as any)[f.k] || '—' }}
          </code>
          <button v-if="(revealing as any)[f.k]" class="admin-btn-ghost shrink-0" @click="copy((revealing as any)[f.k], f.label)">复制</button>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- 批量导入 -->
  <el-dialog
    :model-value="!!importing"
    title="批量导入账号"
    width="680px"
    @update:model-value="(v: boolean) => !v && (importing = null)"
    @close="importing = null"
  >
    <div v-if="importing" class="space-y-3 text-sm">
      <div v-if="importResult" class="p-3 rounded-lg bg-brand-50 border border-brand-100 text-xs space-y-1">
        <div>本次共 {{ importResult.total }} 行：成功 <b class="text-brand-700">{{ importResult.created }}</b>，重复 {{ importResult.duplicatedCount ?? importResult.duplicated.length }}，格式错误 {{ importResult.invalidCount ?? importResult.invalid.length }}。</div>
        <div v-if="importResult.batchTag">批次号：<code class="font-mono">{{ importResult.batchTag }}</code></div>
        <div v-if="importResult.invalid?.length" class="text-amber-700">
          错误示例：{{ importResult.invalid.slice(0, 3).map((i: any) => i.reason).join('；') }}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="admin-label">分隔符</label>
          <input v-model="importing.separator" class="admin-input w-full font-mono" placeholder="----" />
        </div>
        <div>
          <label class="admin-label">导入到分组</label>
          <select v-model="importing.groupId" class="admin-select w-full">
            <option value="">未分组</option>
            <option v-for="g in groups" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="admin-label">列顺序（点击切换，邮箱必选且需与文本每列对应）</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="f in IMPORT_FIELD_OPTIONS"
            :key="f.key"
            class="px-2.5 py-1 rounded-lg border text-xs"
            :class="importing.fields.includes(f.key)
              ? 'bg-brand-50 border-brand-300 text-brand-700'
              : 'border-ink-200 text-ink-500 hover:bg-ink-50'"
            @click="toggleImportField(f.key)"
          >
            <template v-if="importing.fields.includes(f.key)">{{ importing.fields.indexOf(f.key) + 1 }}. </template>{{ f.label }}
          </button>
        </div>
        <div class="mt-1 text-[11px] text-ink-400">
          当前格式：<code class="font-mono">{{ importing.fields.map(k => IMPORT_FIELD_OPTIONS.find(o => o.key === k)?.label).join(importing.separator || '----') }}</code>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="admin-label">初始状态</label>
          <select v-model="importing.status" class="admin-select w-full">
            <option value="AVAILABLE">可用</option>
            <option value="USED">已用</option>
            <option value="DISABLED">停用</option>
          </select>
        </div>
        <div>
          <label class="admin-label">统一标签（可选）</label>
          <input v-model="importing.tags" class="admin-input w-full" placeholder="逗号分隔" />
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="admin-label !mb-0">账号文本（一行一条，按邮箱自动去重）</label>
          <span class="text-xs text-ink-400">{{ importLineCount }} 行</span>
        </div>
        <textarea
          v-model="importing.text"
          rows="10"
          class="admin-input w-full font-mono text-xs"
          placeholder="a@example.com----pwd1----emailpwd1----user_xxx::eyJ...&#10;b@example.com----pwd2"
        />
      </div>
    </div>
    <template #footer>
      <button class="admin-btn-ghost mr-2" @click="importing = null">关闭</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doImport">导入 {{ importLineCount }} 条</button>
    </template>
  </el-dialog>

  <!-- 导出 -->
  <el-dialog
    :model-value="!!exporting"
    title="导出账号"
    width="520px"
    @update:model-value="(v: boolean) => !v && (exporting = null)"
    @close="exporting = null"
  >
    <div v-if="exporting" class="space-y-3 text-sm">
      <div>
        <label class="admin-label">导出范围</label>
        <div class="flex gap-4">
          <label class="flex items-center gap-1.5">
            <input v-model="exporting.scope" type="radio" value="selected" :disabled="!selected.size" />
            勾选的 {{ selected.size }} 个
          </label>
          <label class="flex items-center gap-1.5">
            <input v-model="exporting.scope" type="radio" value="filtered" />
            当前筛选结果（最多 5000）
          </label>
        </div>
      </div>
      <div>
        <label class="admin-label">导出字段（按顺序拼接）</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="f in EXPORT_FIELD_OPTIONS"
            :key="f.key"
            class="px-2.5 py-1 rounded-lg border text-xs"
            :class="exporting.fields.includes(f.key)
              ? 'bg-brand-50 border-brand-300 text-brand-700'
              : 'border-ink-200 text-ink-500 hover:bg-ink-50'"
            @click="toggleExportField(f.key)"
          >
            <template v-if="exporting.fields.includes(f.key)">{{ exporting.fields.indexOf(f.key) + 1 }}. </template>{{ f.label }}
          </button>
        </div>
      </div>
      <div>
        <label class="admin-label">分隔符</label>
        <input v-model="exporting.separator" class="admin-input w-full font-mono" placeholder="----" />
      </div>
      <p class="text-[11px] text-ink-400">导出含密码 / Token 等敏感字段的操作会写入操作历史与审计日志。</p>
    </div>
    <template #footer>
      <button class="admin-btn-ghost mr-2" @click="exporting = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doExport">下载 TXT</button>
    </template>
  </el-dialog>

  <!-- 分组管理 -->
  <el-dialog
    :model-value="groupPanel"
    title="分组管理"
    width="460px"
    @update:model-value="(v: boolean) => (groupPanel = v)"
    @close="groupPanel = false"
  >
    <div class="space-y-3 text-sm">
      <div class="flex gap-2">
        <input v-model="newGroupName" class="admin-input flex-1" placeholder="新分组名称" @keyup.enter="addGroup" />
        <button class="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm shrink-0" @click="addGroup">添加</button>
      </div>
      <div v-if="!groups.length" class="py-6 text-center text-ink-400">还没有分组</div>
      <div v-else class="divide-y divide-ink-100">
        <div v-for="g in groups" :key="g.id" class="flex items-center justify-between py-2">
          <div>
            <span class="text-ink-900">{{ g.name }}</span>
            <span class="text-ink-400 text-xs ml-2">{{ g.accountCount }} 个账号</span>
          </div>
          <div class="flex gap-2">
            <button class="admin-link" @click="renameGroup(g)">重命名</button>
            <button class="admin-link !text-rose-500" @click="removeGroup(g)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- 操作历史 -->
  <el-dialog
    :model-value="!!eventPanel"
    :title="eventPanel ? `操作历史 · ${eventPanel.row.email}` : '操作历史'"
    width="560px"
    @update:model-value="(v: boolean) => !v && (eventPanel = null)"
    @close="eventPanel = null"
  >
    <div v-if="eventPanel" class="text-sm">
      <div v-if="!eventPanel.items.length" class="py-8 text-center text-ink-400">暂无记录</div>
      <div v-else class="max-h-[420px] overflow-auto divide-y divide-ink-100">
        <div v-for="ev in eventPanel.items" :key="ev.id" class="py-2 flex items-start justify-between gap-3">
          <div>
            <span class="text-ink-900">{{ EVENT_LABELS[ev.action] || ev.action }}</span>
            <span v-if="ev.detail" class="text-ink-400 text-xs ml-2">{{ ev.detail }}</span>
          </div>
          <div class="text-right text-xs text-ink-400 shrink-0">
            <div>{{ ev.actor || 'system' }}</div>
            <div>{{ fmtDate(ev.createdAt, true) }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- 详细用量 -->
  <VaultUsageDrawer :id="usageId" :email="usageEmail" @close="usageId = null" @refreshed="load" />
</template>

<style scoped>
.admin-input {
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e7e5e4;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
}
.admin-input:focus {
  outline: none;
  border-color: var(--el-color-primary, #6366f1);
}
textarea.admin-input {
  height: auto;
  padding: 8px 12px;
  line-height: 1.5;
}
.admin-select {
  height: 36px;
  padding: 0 8px;
  border: 1px solid #e7e5e4;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
}
.admin-label {
  display: block;
  font-size: 12px;
  color: #78716c;
  margin-bottom: 4px;
}
.admin-btn-ghost {
  padding: 6px 12px;
  border: 1px solid #e7e5e4;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  color: #57534e;
}
.admin-btn-ghost:hover {
  background: #fafaf9;
}
.admin-btn-ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.admin-chip {
  padding: 2px 8px;
  border: 1px solid #e7e5e4;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #57534e;
}
.admin-chip:hover {
  background: #fafaf9;
}
.admin-link {
  font-size: 13px;
  color: #78716c;
  margin-left: 10px;
}
.admin-link:first-child {
  margin-left: 0;
}
.admin-link:hover {
  color: #4f46e5;
}
.admin-link:disabled {
  opacity: 0.5;
}
</style>
