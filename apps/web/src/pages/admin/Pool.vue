<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';

const list = ref<any[]>([]);
const editing = ref<any | null>(null);
const loading = ref(false);
const refreshing = ref(false);

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.poolAccounts({ page: 1, pageSize: 50 });
    list.value = a.items;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function newOne() {
  editing.value = { label: '', type: 'CURSOR_PRO', token: '', email: '', totalQuota: 0, usedQuota: 0, _tokenChanged: true };
}
function startEdit(a: any) {
  editing.value = { ...a, token: '', _tokenChanged: false };
}
async function save() {
  const body = { ...editing.value };
  // 编辑模式下用户没改 token → 不要把空 token 发上去覆盖
  if (editing.value.id && !editing.value._tokenChanged) {
    delete body.token;
  }
  delete body._tokenChanged;
  delete body.tokenMasked;
  if (editing.value.id) await api.admin.poolUpdate(editing.value.id, body);
  else await api.admin.poolCreate(body);
  ElMessage.success('已保存');
  editing.value = null;
  load();
}

async function reveal(a: any) {
  await ElMessageBox.confirm(
    `即将显示「${a.label}」的完整 Cursor Token，该操作会被记录到审计日志。\n\n确认继续？`,
    '查看明文 Token',
    { type: 'warning' },
  );
  const r = await api.admin.poolReveal(a.id);
  // 用 ElMessageBox.prompt 安全显示（input 不会执行 HTML），避免 token 中含恶意字符触发 XSS
  await ElMessageBox({
    title: `${a.label} 的 Token`,
    message: r.token,
    customClass: 'token-reveal-dialog',
    confirmButtonText: '我已复制',
    type: 'info',
  } as any).catch(() => null);
}
async function del(a: any) {
  await ElMessageBox.confirm(`删除「${a.label}」？`, '提示', { type: 'warning' });
  await api.admin.poolRemove(a.id);
  load();
}
async function refresh() {
  refreshing.value = true;
  try {
    const r = await api.admin.poolRefresh();
    ElMessage.success(`已刷新 ${r.length} 个账号的额度`);
    load();
  } finally {
    refreshing.value = false;
  }
}

const summary = computed(() => {
  const totalAccounts = list.value.length;
  const totalQuota = list.value.reduce((s, a) => s + Number(a.totalQuota || 0), 0);
  const usedQuota = list.value.reduce((s, a) => s + Number(a.usedQuota || 0), 0);
  const healthy = list.value.filter((a) => a.status === 'HEALTHY').length;
  return { totalAccounts, totalQuota, usedQuota, remain: totalQuota - usedQuota, healthy };
});
</script>

<template>
  <AdminPageHeader title="号池" subtitle="管理 Cursor / Ultra 账号与配额">
    <template #actions>
      <button
        class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700"
        :disabled="refreshing"
        @click="refresh"
      >
        <svg class="w-3.5 h-3.5 inline mr-1 -mt-0.5" :class="{ 'animate-spin': refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5l2 2M20 14a8 8 0 01-14 5l-2-2"/>
        </svg>
        {{ refreshing ? '刷新中' : '刷新额度' }}
      </button>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="newOne">
        + 新建账号
      </button>
    </template>
  </AdminPageHeader>

  <!-- Summary -->
  <div class="card p-4 mb-4 flex items-center divide-x divide-ink-100">
    <div class="flex-1 px-4 first:pl-2">
      <div class="text-xs text-ink-500">账号总数</div>
      <div class="mt-1 text-lg font-medium text-ink-900">{{ summary.totalAccounts }}</div>
    </div>
    <div class="flex-1 px-4">
      <div class="text-xs text-ink-500">健康账号</div>
      <div class="mt-1 text-lg font-medium text-brand-700">{{ summary.healthy }}</div>
    </div>
    <div class="flex-1 px-4">
      <div class="text-xs text-ink-500">总额度</div>
      <div class="mt-1 text-lg font-medium text-ink-900">${{ summary.totalQuota.toFixed(2) }}</div>
    </div>
    <div class="flex-1 px-4">
      <div class="text-xs text-ink-500">已用</div>
      <div class="mt-1 text-lg font-medium text-ink-700">${{ summary.usedQuota.toFixed(2) }}</div>
    </div>
    <div class="flex-1 px-4 last:pr-2">
      <div class="text-xs text-ink-500">剩余</div>
      <div class="mt-1 text-lg font-semibold text-price">${{ summary.remain.toFixed(2) }}</div>
    </div>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="尚未添加 Pool 账号">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>标签</th>
        <th>类型</th>
        <th>Token</th>
        <th class="!text-right">额度</th>
        <th class="!text-right">已用</th>
        <th class="!text-right">剩余</th>
        <th>状态</th>
        <th>最后检查</th>
        <th class="!text-right" style="width: 160px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="a in list" :key="a.id">
        <td class="text-ink-400 font-mono text-xs">#{{ a.id }}</td>
        <td>
          <div class="font-medium text-ink-900">{{ a.label }}</div>
          <div v-if="a.email" class="text-xs text-ink-500">{{ a.email }}</div>
        </td>
        <td class="text-ink-600 text-xs font-mono">{{ a.type }}</td>
        <td class="font-mono text-xs text-ink-500">{{ a.tokenMasked || '—' }}</td>
        <td class="text-right text-ink-600">${{ a.totalQuota }}</td>
        <td class="text-right text-ink-600">${{ a.usedQuota }}</td>
        <td class="text-right font-medium text-price">${{ (Number(a.totalQuota) - Number(a.usedQuota)).toFixed(2) }}</td>
        <td><StatusTag :status="a.status" /></td>
        <td class="text-ink-500 text-xs">{{ a.lastCheckAt ? new Date(a.lastCheckAt).toLocaleString() : '—' }}</td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-amber-600 mr-3 text-sm" @click="reveal(a)" title="审计日志会记录此操作">查看</button>
          <button class="text-ink-500 hover:text-brand-700 mr-3 text-sm" @click="startEdit(a)">编辑</button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(a)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!editing"
    width="560px"
    :title="editing?.id ? '编辑账号' : '新建账号'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">标签（内部识别）</label>
        <input v-model="editing.label" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">类型</label>
        <select v-model="editing.type" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
          <option value="CURSOR_PRO">Cursor Pro</option>
          <option value="CURSOR_ULTRA">Cursor Ultra</option>
          <option value="CURSOR_TEAM">Cursor Team</option>
          <option value="CUSTOM">自定义</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">邮箱（可选）</label>
        <input v-model="editing.email" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">
          Token
          <span v-if="editing.id" class="text-amber-600 ml-1">（留空表示不修改原 Token）</span>
        </label>
        <textarea
          v-model="editing.token"
          rows="4"
          :placeholder="editing.id ? '留空保持不变' : 'user_xxx::eyJhbG...'"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
          @input="editing._tokenChanged = true"
        />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注</label>
        <textarea v-model="editing.note" rows="2" class="w-full px-3 py-2 border border-ink-200 rounded-lg"></textarea>
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="save">保存</button>
    </template>
  </el-dialog>
</template>
