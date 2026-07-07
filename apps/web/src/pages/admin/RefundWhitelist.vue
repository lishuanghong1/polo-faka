<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const filterStatus = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = 50;
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  loading.value = true;
  try {
    const r: any = await api.admin.refundWlList({
      status: filterStatus.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize,
    });
    list.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([filterStatus, page], load);
function search() { page.value = 1; load(); }

const statusMeta: Record<string, { text: string; cls: string }> = {
  NONE: { text: '可退', cls: 'bg-ink-100 text-ink-600' },
  PROCESSING: { text: '退款中', cls: 'bg-sky-100 text-sky-700' },
  DONE: { text: '已退款', cls: 'bg-emerald-100 text-emerald-700' },
  FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
};

// 新增
const editing = ref<any | null>(null);
function openCreate() { editing.value = { id: null, email: '', cursorToken: '', note: '' }; }
function openEdit(row: any) { editing.value = { id: row.id, email: row.email, cursorToken: '', note: row.note || '' }; }
async function saveEdit() {
  const e = editing.value; if (!e) return;
  if (!e.email.trim()) return ElMessage.warning('请填写邮箱');
  try {
    if (e.id) {
      const body: any = { email: e.email.trim(), note: e.note };
      if (e.cursorToken) body.cursorToken = e.cursorToken;
      await api.admin.refundWlUpdate(e.id, body);
    } else {
      if (!e.cursorToken.trim()) return ElMessage.warning('请填写 cursor token');
      await api.admin.refundWlAdd({ email: e.email.trim(), cursorToken: e.cursorToken.trim(), note: e.note || undefined });
    }
    ElMessage.success('已保存');
    editing.value = null;
    load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error?.message || err?.response?.data?.message || '保存失败');
  }
}

// 批量导入
const importing = ref<{ text: string; separator: string } | null>(null);
const importResult = ref<any | null>(null);
function openImport() { importing.value = { text: '', separator: '----' }; importResult.value = null; }
async function doImport() {
  if (!importing.value?.text.trim()) return ElMessage.warning('请粘贴账号');
  try {
    importResult.value = await api.admin.refundWlBulkImport({
      text: importing.value.text,
      separator: importing.value.separator || '----',
    });
    ElMessage.success(`导入成功 ${importResult.value.created} 条`);
    load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error?.message || '导入失败');
  }
}

const acting = ref<number | null>(null);
async function refundNow(row: any) {
  await ElMessageBox.confirm(`立即对 ${row.email} 执行退款（账号将变 Free）？`, '手动退款', { type: 'warning', confirmButtonText: '退款' });
  acting.value = row.id;
  try {
    await api.admin.refundWlRefundNow(row.id);
    ElMessage.success('退款已执行');
    load();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error?.message || err?.response?.data?.message || '退款失败');
    load();
  } finally { acting.value = null; }
}
async function resetRow(row: any) {
  try { await api.admin.refundWlReset(row.id); ElMessage.success('已重置'); load(); } catch { /* ignore */ }
}
async function del(row: any) {
  await ElMessageBox.confirm(`从退款名单删除 ${row.email}？`, '删除', { type: 'warning' });
  try { await api.admin.refundWlRemove(row.id); ElMessage.success('已删除'); load(); } catch { /* ignore */ }
}
</script>

<template>
  <AdminPageHeader title="客户退款名单" subtitle="只有名单里的邮箱，客户在前台「账号退款」输入邮箱才能自助退款">
    <template #actions>
      <select v-model="filterStatus" class="admin-select" @change="search">
        <option value="">全部状态</option>
        <option value="NONE">可退</option>
        <option value="PROCESSING">退款中</option>
        <option value="DONE">已退款</option>
        <option value="FAILED">失败</option>
      </select>
      <input v-model="keyword" placeholder="搜索邮箱" class="admin-input w-44" @keyup.enter="search" />
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="search">查询</button>
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="openImport">批量导入</button>
      <button class="px-3 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openCreate">+ 新增</button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length" empty="退款名单为空，点右上角新增或批量导入" min-width="920px">
    <thead>
      <tr>
        <th style="width:60px">ID</th>
        <th>邮箱</th>
        <th>状态</th>
        <th>退款金额</th>
        <th>申请时间</th>
        <th>备注</th>
        <th class="!text-right" style="width:220px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td class="text-sm text-ink-800">{{ row.email }}</td>
        <td>
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="(statusMeta[row.refundStatus] || {}).cls">
            {{ (statusMeta[row.refundStatus] || { text: row.refundStatus }).text }}
          </span>
          <div v-if="row.refundError" class="text-[10px] text-rose-500 mt-0.5 max-w-[200px] truncate" :title="row.refundError">{{ row.refundError }}</div>
        </td>
        <td class="text-xs text-ink-600">{{ row.refundAmount ? '$' + Number(row.refundAmount).toFixed(2) : '—' }}</td>
        <td class="text-xs text-ink-500">{{ row.appliedAt ? new Date(row.appliedAt).toLocaleString() : '—' }}</td>
        <td class="text-xs text-ink-500 max-w-[160px] truncate">{{ row.note || '—' }}</td>
        <td class="text-right whitespace-nowrap text-sm">
          <button
            v-if="row.refundStatus !== 'DONE'"
            class="text-rose-600 hover:text-rose-700 mr-2 disabled:opacity-40"
            :disabled="acting === row.id"
            @click="refundNow(row)"
          >立即退款</button>
          <button v-if="row.refundStatus === 'FAILED'" class="text-amber-600 hover:text-amber-700 mr-2" @click="resetRow(row)">重置</button>
          <button class="text-ink-500 hover:text-brand-600 mr-2" @click="openEdit(row)">编辑</button>
          <button class="text-ink-500 hover:text-rose-600" @click="del(row)">删除</button>
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
    :title="editing?.id ? '编辑' : '新增退款账号'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">邮箱</label>
        <input v-model="editing.email" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">Cursor Token{{ editing.id ? '（留空不变）' : '' }}</label>
        <input v-model="editing.cursorToken" placeholder="user_xxx::eyJ..." class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注（可选）</label>
        <input v-model="editing.note" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
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
    title="批量导入退款账号"
    @update:model-value="(v: boolean) => !v && (importing = null)"
    @close="importing = null"
  >
    <div v-if="importing" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">分隔符</label>
        <input v-model="importing.separator" class="w-40 px-3 py-2 border border-ink-200 rounded-lg font-mono" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">账号（一行一条，需含邮箱 + cursor token）</label>
        <textarea
          v-model="importing.text"
          rows="10"
          placeholder="两种格式自动识别：&#10;① 邮箱----邮箱密码----cursor密码----cursor token&#10;② 邮箱：a@b.com | WorkosCursorSessionToken：user_xxx::eyJ..."
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
        />
      </div>
      <div v-if="importResult" class="text-xs text-ink-600 bg-ink-50/60 rounded p-2">
        导入完成：新增 <b class="text-emerald-600">{{ importResult.created }}</b>，跳过 <b class="text-amber-600">{{ importResult.skipped?.length || 0 }}</b>
        <div v-if="importResult.skipped?.length" class="mt-1 max-h-32 overflow-auto">
          <div v-for="(s, i) in importResult.skipped.slice(0, 20)" :key="i" class="text-rose-500">
            {{ s.line ? '第 ' + s.line + ' 行：' : '' }}{{ s.error }}
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="importing = null">关闭</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doImport">开始导入</button>
    </template>
  </el-dialog>
</template>
