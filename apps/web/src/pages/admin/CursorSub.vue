<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import { copyText } from '@/utils/format';

const list = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const filterStatus = ref('');
const keyword = ref('');
const page = ref(1);
const pageSize = 50;
const acting = ref<number | null>(null);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  loading.value = true;
  try {
    const r: any = await api.admin.cursorSubList({
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

const statusMeta: Record<string, { text: string; cls: string }> = {
  unsubscribed: { text: '未订阅', cls: 'bg-ink-100 text-ink-600' },
  subscribed: { text: '已订阅', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { text: '已过期', cls: 'bg-rose-100 text-rose-700' },
  unlisted: { text: '已下架', cls: 'bg-amber-100 text-amber-700' },
};
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

// ── 行操作 ──────────────────────────────────────────
async function markPaid(row: any) {
  acting.value = row.id;
  try {
    await api.admin.cursorSubMarkPaid(row.id);
    ElMessage.success('已标记已付款');
    load();
  } catch { /* ignore */ } finally { acting.value = null; }
}
async function sync(row: any) {
  acting.value = row.id;
  try {
    const r: any = await api.admin.cursorSubSync(row.id);
    ElMessage.success(`已同步：${r.usage?.membershipType || '未知'}`);
    load();
  } catch { /* ignore */ } finally { acting.value = null; }
}
async function usage(row: any) {
  acting.value = row.id;
  try {
    const r: any = await api.admin.cursorSubUsage(row.id);
    if (!r.success) return ElMessage.warning(r.error || '查询失败');
    ElMessageBox.alert(
      `会员：${r.membershipType || '-'}\n额度：${r.planUsed ?? '-'} / ${r.planLimit ?? '-'}\n账期：${r.billingCycleStart || '-'} ~ ${r.billingCycleEnd || '-'}`,
      `用量 · ${row.email}`,
      { confirmButtonText: '关闭' },
    );
  } catch { /* ignore */ } finally { acting.value = null; }
}
async function pushWarehouse(row: any) {
  await ElMessageBox.confirm(`把账号 ${row.email} 推送到仓库（待分配）？`, '推送到仓库', { type: 'info', confirmButtonText: '推送' });
  acting.value = row.id;
  try {
    await api.admin.cursorSubPush(row.id);
    ElMessage.success('已推送到仓库');
    load();
  } catch { /* ignore */ } finally { acting.value = null; }
}
async function genLink(row: any) {
  if (!row.hasCursorToken) return ElMessage.warning('该账号没有 token，无法生成');
  acting.value = row.id;
  try {
    const r = await api.admin.cursorSubCheckoutLink(row.id);
    row.lastCheckoutUrl = r.url;
    row.lastCheckoutAt = r.at;
    const ok = await copyText(r.url);
    ElMessage.success(ok ? '订阅链接已生成并复制' : '订阅链接已生成');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '生成失败');
  } finally {
    acting.value = null;
  }
}
async function copyLink(row: any) {
  if (!row.lastCheckoutUrl) return;
  const ok = await copyText(row.lastCheckoutUrl);
  if (ok) ElMessage.success('已复制订阅链接');
}
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

async function exportOne(row: any) {
  try {
    const r: any = await api.admin.cursorSubExport(row.id);
    const ok = await copyText(r.formatted);
    if (ok) ElMessage.success('已复制账号完整信息');
    else ElMessageBox.alert(r.formatted, `账号 · ${row.email}`, { confirmButtonText: '关闭' });
  } catch { /* ignore */ }
}
async function del(row: any) {
  await ElMessageBox.confirm(`删除账号 ${row.email}？（仓库记录也会移除，保留订单/卡密）`, '删除', { type: 'warning' });
  try {
    await api.admin.cursorSubRemove(row.id);
    ElMessage.success('已删除');
    load();
  } catch { /* ignore */ }
}

function search() {
  page.value = 1;
  load();
}
</script>

<template>
  <AdminPageHeader title="订阅号池" subtitle="Cursor 订阅账号管理（合并自 cursor-jb）：导入 → 推送仓库上架 → 售出">
    <template #actions>
      <select v-model="filterStatus" class="admin-select" @change="search">
        <option value="">全部状态</option>
        <option value="unsubscribed">未订阅</option>
        <option value="subscribed">已订阅</option>
        <option value="expired">已过期</option>
        <option value="unlisted">已下架</option>
      </select>
      <input v-model="keyword" placeholder="搜索邮箱" class="admin-input w-44" @keyup.enter="search" />
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="search">查询</button>
      <button
        class="px-3 h-9 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm disabled:opacity-50"
        :disabled="batchGenerating"
        @click="batchGenLinks"
      >{{ batchGenerating ? '生成中…' : '批量生成订阅链接' }}</button>
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="openImport">批量导入</button>
      <button class="px-3 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openCreate">+ 新增账号</button>
    </template>
  </AdminPageHeader>

  <DataTable :loading="loading" :is-empty="!list.length" empty="暂无账号，点右上角新增或批量导入" min-width="1280px">
    <thead>
      <tr>
        <th style="width:60px">ID</th>
        <th>邮箱</th>
        <th>凭据</th>
        <th>订阅状态</th>
        <th>到期</th>
        <th>销售状态</th>
        <th class="!text-right" style="width:360px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
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
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="(statusMeta[row.status] || {}).cls">
            {{ (statusMeta[row.status] || { text: row.status }).text }}
          </span>
        </td>
        <td class="text-xs text-ink-600">{{ remainText(row) }}</td>
        <td class="text-xs">
          <span v-if="row.saleStatus" :class="(saleMeta[row.saleStatus] || {}).cls">
            {{ (saleMeta[row.saleStatus] || { text: row.saleStatus }).text }}
          </span>
          <span v-else class="text-ink-300">未推送</span>
        </td>
        <td class="text-right whitespace-nowrap text-sm">
          <button
            class="text-emerald-600 hover:text-emerald-700 font-medium mr-2 disabled:opacity-40"
            :disabled="acting === row.id || !row.hasCursorToken"
            :title="row.hasCursorToken ? '生成订阅结账链接' : '缺少 token'"
            @click="genLink(row)"
          >生成链接</button>
          <button
            v-if="row.lastCheckoutUrl"
            class="text-ink-500 hover:text-brand-600 mr-2"
            title="复制上次生成的链接"
            @click="copyLink(row)"
          >复制链接</button>
          <button class="text-ink-500 hover:text-brand-600 mr-2" :disabled="acting === row.id" @click="sync(row)">同步</button>
          <button class="text-ink-500 hover:text-brand-600 mr-2" :disabled="acting === row.id" @click="usage(row)">用量</button>
          <button class="text-ink-500 hover:text-emerald-600 mr-2" :disabled="acting === row.id" @click="markPaid(row)">标记已付</button>
          <button v-if="!row.saleStatus" class="text-sky-600 hover:text-sky-700 mr-2" :disabled="acting === row.id" @click="pushWarehouse(row)">推送仓库</button>
          <button class="text-ink-500 hover:text-brand-600 mr-2" @click="exportOne(row)">导出</button>
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
</template>
