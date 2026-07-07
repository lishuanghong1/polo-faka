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
const sourceRefFilter = ref('');
const page = ref(1);
const pageSize = ref(50);

const assignTarget = ref<any | null>(null);
const productsCache = ref<any[]>([]);
const productsLoading = ref(false);
const selectedProductId = ref<number | null>(null);
const selectedSkuId = ref<number | null>(null);
const productSkus = ref<{ id: number; name: string }[]>([]);

// 后台手动添加账号入库
const adding = ref<{ content: string; remark: string } | null>(null);
const addLineCount = computed(
  () => (adding.value?.content || '').split(/\r?\n/).filter((s) => s.trim()).length,
);
function openAdd() {
  adding.value = { content: '', remark: '' };
}
async function doAdd() {
  if (!adding.value?.content.trim()) {
    ElMessage.warning('请填写账号内容');
    return;
  }
  const r = await api.admin.warehouseManualAdd({
    content: adding.value.content,
    remark: adding.value.remark || undefined,
  });
  if (r.duplicated) {
    ElMessage.success(`入库 ${r.created} 条，跳过 ${r.duplicated} 条重复`);
  } else {
    ElMessage.success(`成功入库 ${r.created} 条账号`);
  }
  adding.value = null;
  load();
}

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.warehouseList({
      status: filterStatus.value || undefined,
      sourceRef: sourceRefFilter.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    list.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch([filterStatus, page], load);

const stats = computed(() => {
  const pending = list.value.filter((i) => i.status === 'PENDING').length;
  const assigned = list.value.filter((i) => i.status === 'ASSIGNED').length;
  const sold = list.value.filter((i) => i.status === 'SOLD').length;
  return { pending, assigned, sold };
});

function statusColor(s: string) {
  if (s === 'PENDING') return 'bg-amber-100 text-amber-700';
  if (s === 'ASSIGNED') return 'bg-sky-100 text-sky-700';
  if (s === 'SOLD') return 'bg-emerald-100 text-emerald-700';
  if (s === 'UNLISTED') return 'bg-ink-200 text-ink-600';
  return 'bg-ink-100 text-ink-700';
}
function statusLabel(s: string) {
  if (s === 'PENDING') return '未分配';
  if (s === 'ASSIGNED') return '已上架';
  if (s === 'SOLD') return '已售出';
  if (s === 'UNLISTED') return '已下架';
  return s;
}
function previewContent(c: string) {
  if (!c) return '';
  if (c.length <= 50) return c;
  return c.slice(0, 24) + '...' + c.slice(-12);
}

async function openAssign(row: any) {
  assignTarget.value = row;
  selectedProductId.value = null;
  selectedSkuId.value = null;
  productSkus.value = [];
  if (productsCache.value.length === 0) {
    productsLoading.value = true;
    try {
      const r = await api.products({ page: 1, pageSize: 200 });
      productsCache.value = r.items || r;
    } finally {
      productsLoading.value = false;
    }
  }
}
async function onProductChange(pid: number | null) {
  selectedSkuId.value = null;
  productSkus.value = [];
  if (!pid) return;
  productsLoading.value = true;
  try {
    const detail: any = await api.product(pid);
    productSkus.value = (detail.skus || []).map((s: any) => ({ id: s.id, name: s.name }));
  } finally {
    productsLoading.value = false;
  }
}
async function doAssign() {
  if (!assignTarget.value || !selectedProductId.value || !selectedSkuId.value) {
    ElMessage.warning('请选择商品和 SKU');
    return;
  }
  try {
    await api.admin.warehouseAssign(assignTarget.value.id, {
      productId: selectedProductId.value,
      skuId: selectedSkuId.value,
    });
    ElMessage.success('分配成功，已生成卡密');
    assignTarget.value = null;
    load();
  } catch (e) {
    // 错误由全局拦截器处理
  }
}

async function unassign(row: any) {
  await ElMessageBox.confirm(`撤回 #${row.id} 的分配？关联的卡密会被删除（必须是 AVAILABLE 状态）`, '撤回分配', {
    type: 'warning',
  });
  await api.admin.warehouseUnassign(row.id);
  ElMessage.success('已撤回');
  load();
}

async function del(row: any) {
  const tip =
    row.status === 'SOLD'
      ? `确认从仓库删除已售出账号 #${row.id}？订单与卡密会保留，仅移除仓库记录`
      : `确认删除仓库账号 #${row.id}？`;
  await ElMessageBox.confirm(tip, '删除', { type: 'warning' });
  await api.admin.warehouseRemove(row.id);
  ElMessage.success('已删除');
  load();
}

async function reveal(row: any) {
  await ElMessageBox({
    title: `仓库账号 #${row.id} content`,
    message: row.content,
    customClass: 'token-reveal-dialog',
    confirmButtonText: '我已复制',
    type: 'info',
  } as any).catch(() => null);
}

// ── 退款时间 / 企业微信通知 ──────────────────────────
/** datetime-local 需要 'YYYY-MM-DDTHH:mm' 本地时间字符串 */
function toLocalInput(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const refundTarget = ref<any | null>(null);
const refundForm = ref<{ refundAt: string; refundNote: string }>({ refundAt: '', refundNote: '' });

function openRefund(row: any) {
  refundTarget.value = row;
  refundForm.value = {
    refundAt: toLocalInput(row.refundAt),
    refundNote: row.refundNote || '',
  };
}
async function saveRefund() {
  if (!refundTarget.value) return;
  try {
    // datetime-local 是本地时间，转成 ISO 交给后端
    const iso = refundForm.value.refundAt ? new Date(refundForm.value.refundAt).toISOString() : null;
    await api.admin.warehouseSetRefundTime(refundTarget.value.id, {
      refundAt: iso,
      refundNote: refundForm.value.refundNote || null,
    });
    ElMessage.success('已保存退款时间');
    refundTarget.value = null;
    load();
  } catch {
    /* 全局拦截器已提示 */
  }
}
async function notifyRefund(row: any) {
  await ElMessageBox.confirm(
    `立即把账号 #${row.id} 的完整信息推送到企业微信？`,
    '立即通知',
    { type: 'warning', confirmButtonText: '推送' },
  );
  try {
    await api.admin.warehouseNotifyRefund(row.id);
    ElMessage.success('已推送到企业微信');
    load();
  } catch {
    /* 全局拦截器已提示 */
  }
}

function refundLabel(row: any): { text: string; cls: string } {
  if (row.status !== 'SOLD') return { text: '—', cls: 'text-ink-400' };
  // 自动退款状态优先展示
  if (row.refundStatus === 'DONE') {
    const amt = row.refundAmount ? `（$${Number(row.refundAmount).toFixed(2)}）` : '';
    return { text: `已退款${amt}`, cls: 'text-emerald-600' };
  }
  if (row.refundStatus === 'FAILED') return { text: '退款失败', cls: 'text-rose-600' };
  if (row.refundNotifiedAt) return { text: '已通知', cls: 'text-emerald-600' };
  if (!row.refundAt) return { text: '未设置', cls: 'text-ink-400' };
  const due = new Date(row.refundAt).getTime();
  if (due <= Date.now()) return { text: '待处理', cls: 'text-amber-600' };
  return { text: new Date(row.refundAt).toLocaleString(), cls: 'text-ink-600' };
}

async function refundNow(row: any) {
  await ElMessageBox.confirm(
    `立即对账号 #${row.id} 执行 Cursor 退款（团队邀请按比例退款，账号将变 Free）？`,
    '立即退款',
    { type: 'warning', confirmButtonText: '退款' },
  );
  try {
    const r = await api.admin.warehouseRefundNow(row.id);
    ElMessage.success(`退款成功${r.amount ? `，约 $${Number(r.amount).toFixed(2)}` : ''}`);
    load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.response?.data?.message || '退款失败');
    load();
  }
}
async function resetRefund(row: any) {
  try {
    await api.admin.warehouseRefundReset(row.id);
    ElMessage.success('已重置，将重新排入自动退款');
    load();
  } catch { /* 全局拦截器提示 */ }
}
</script>

<template>
  <AdminPageHeader title="仓库" subtitle="外部推送或后台手动入库的账号，可分配到商品上架">
    <template #actions>
      <select v-model="filterStatus" class="admin-select">
        <option value="">全部状态</option>
        <option value="PENDING">未分配</option>
        <option value="ASSIGNED">已上架</option>
        <option value="SOLD">已售出</option>
        <option value="UNLISTED">已下架</option>
      </select>
      <input
        v-model="sourceRefFilter"
        placeholder="按来源过滤"
        class="admin-input w-40"
        @keyup.enter="load"
      />
      <button class="px-3 h-9 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="load">
        刷新
      </button>
      <button class="px-3 h-9 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openAdd">
        + 添加账号
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-y-3 sm:divide-x sm:divide-ink-100">
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">总数（当前页）</div>
      <div class="mt-1 text-lg font-medium text-ink-900">{{ list.length }} / {{ total }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">未分配</div>
      <div class="mt-1 text-lg font-medium text-amber-700">{{ stats.pending }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">已上架</div>
      <div class="mt-1 text-lg font-medium text-sky-700">{{ stats.assigned }}</div>
    </div>
    <div class="px-3 sm:px-4">
      <div class="text-xs text-ink-500">已售出</div>
      <div class="mt-1 text-lg font-medium text-emerald-700">{{ stats.sold }}</div>
    </div>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="仓库为空，请从外部系统推送账号" min-width="1360px">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>来源</th>
        <th>邮箱 / 内容预览</th>
        <th>状态</th>
        <th>分配到</th>
        <th>售出时间</th>
        <th>退款时间</th>
        <th>订单</th>
        <th class="!text-right" style="width: 300px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td class="text-ink-400 font-mono text-xs">#{{ row.id }}</td>
        <td class="text-ink-600 font-mono text-xs">{{ row.sourceRef || '—' }}</td>
        <td>
          <div v-if="row.email" class="text-sm text-ink-800">{{ row.email }}</div>
          <div class="font-mono text-xs text-ink-500">{{ previewContent(row.content) }}</div>
        </td>
        <td>
          <span class="px-2 py-0.5 rounded text-xs font-medium" :class="statusColor(row.status)">
            {{ statusLabel(row.status) }}
          </span>
        </td>
        <td class="text-xs">
          <template v-if="row.productTitle">
            <div class="text-ink-800">{{ row.productTitle }}</div>
            <div class="text-ink-500">{{ row.skuName }}</div>
          </template>
          <span v-else class="text-ink-400">—</span>
        </td>
        <td class="text-ink-500 text-xs">{{ row.soldAt ? new Date(row.soldAt).toLocaleString() : '—' }}</td>
        <td class="text-xs">
          <span :class="refundLabel(row).cls">{{ refundLabel(row).text }}</span>
        </td>
        <td class="text-ink-500 text-xs font-mono">{{ row.orderNo || '—' }}</td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-amber-600 mr-3 text-sm" @click="reveal(row)">查看</button>
          <button
            v-if="row.status === 'SOLD'"
            class="text-brand-600 hover:text-brand-700 mr-3 text-sm"
            @click="openRefund(row)"
          >
            退款时间
          </button>
          <button
            v-if="row.status === 'SOLD' && row.refundStatus !== 'DONE'"
            class="text-rose-600 hover:text-rose-700 mr-3 text-sm"
            @click="refundNow(row)"
          >
            立即退款
          </button>
          <button
            v-if="row.status === 'SOLD' && row.refundStatus === 'FAILED'"
            class="text-amber-600 hover:text-amber-700 mr-3 text-sm"
            @click="resetRefund(row)"
          >
            重置重试
          </button>
          <button
            v-if="row.status === 'SOLD'"
            class="text-emerald-600 hover:text-emerald-700 mr-3 text-sm"
            @click="notifyRefund(row)"
          >
            通知
          </button>
          <button
            v-if="row.status === 'PENDING'"
            class="text-sky-600 hover:text-sky-700 mr-3 text-sm"
            @click="openAssign(row)"
          >
            分配
          </button>
          <button
            v-if="row.status === 'ASSIGNED'"
            class="text-ink-500 hover:text-amber-600 mr-3 text-sm"
            @click="unassign(row)"
          >
            撤回
          </button>
          <button
            class="text-ink-500 hover:text-rose-600 text-sm"
            @click="del(row)"
          >
            删除
          </button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="total > pageSize" class="mt-4 flex justify-end gap-2">
    <button
      class="px-3 py-1.5 rounded border border-ink-200 text-sm"
      :disabled="page <= 1"
      @click="page--"
    >
      上一页
    </button>
    <span class="self-center text-sm text-ink-600">第 {{ page }} 页 / 共 {{ Math.ceil(total / pageSize) }} 页</span>
    <button
      class="px-3 py-1.5 rounded border border-ink-200 text-sm"
      :disabled="page * pageSize >= total"
      @click="page++"
    >
      下一页
    </button>
  </div>

  <el-dialog
    :model-value="!!assignTarget"
    width="540px"
    title="分配到商品"
    @update:model-value="(v: boolean) => !v && (assignTarget = null)"
    @close="assignTarget = null"
  >
    <div v-if="assignTarget" class="space-y-3 text-sm">
      <div class="text-ink-600">
        仓库账号 <span class="font-mono">#{{ assignTarget.id }}</span>
        <span v-if="assignTarget.email" class="ml-2 text-ink-500">{{ assignTarget.email }}</span>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">商品</label>
        <select
          v-model="selectedProductId"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white"
          :disabled="productsLoading"
          @change="onProductChange(selectedProductId)"
        >
          <option :value="null">{{ productsLoading ? '加载中...' : '请选择' }}</option>
          <option v-for="p in productsCache" :key="p.id" :value="p.id">
            #{{ p.id }} - {{ p.title }}
          </option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">SKU 规格</label>
        <select
          v-model="selectedSkuId"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white"
          :disabled="!selectedProductId || productsLoading"
        >
          <option :value="null">请选择</option>
          <option v-for="s in productSkus" :key="s.id" :value="s.id">
            #{{ s.id }} - {{ s.name }}
          </option>
        </select>
      </div>
      <div class="text-xs text-ink-500">
        分配后会自动生成一条 AVAILABLE 状态的 CardKey 上架；售出后这里会自动更新为 SOLD 并回填订单号。
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="assignTarget = null">
        取消
      </button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm"
        :disabled="!selectedProductId || !selectedSkuId"
        @click="doAssign"
      >
        确认分配
      </button>
    </template>
  </el-dialog>

  <el-dialog
    :model-value="!!adding"
    :show-close="true"
    width="640px"
    title="添加账号到仓库"
    @update:model-value="(v: boolean) => !v && (adding = null)"
    @close="adding = null"
  >
    <div v-if="adding" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注（可选）</label>
        <input v-model="adding.remark" placeholder="如：批次号 / 来源" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-ink-500">账号内容（一行一条，自动去重并解析邮箱）</label>
          <span class="text-xs text-ink-400">{{ addLineCount }} 行</span>
        </div>
        <textarea
          v-model="adding.content"
          rows="12"
          placeholder="一行一条账号&#10;格式：邮箱----邮箱密码----cursor密码----token&#10;也可只填邮箱&#10;例如：&#10;user1@example.com----pwd1----pwd2----eyJ...&#10;user2@example.com"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
        />
      </div>
      <div class="text-xs text-ink-500">
        入库后为「未分配」状态，需在列表中分配到商品/SKU 才会上架；售出时仅向买家发送邮箱（凭邮箱验证码登录）。
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="adding = null">
        取消
      </button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm"
        :disabled="!addLineCount"
        @click="doAdd"
      >
        入库 {{ addLineCount }} 条
      </button>
    </template>
  </el-dialog>

  <!-- 设置退款时间 -->
  <el-dialog
    :model-value="!!refundTarget"
    width="480px"
    title="设置退款时间"
    @update:model-value="(v: boolean) => !v && (refundTarget = null)"
    @close="refundTarget = null"
  >
    <div v-if="refundTarget" class="space-y-3 text-sm">
      <div class="text-ink-600">
        仓库账号 <span class="font-mono">#{{ refundTarget.id }}</span>
        <span v-if="refundTarget.email" class="ml-2 text-ink-500">{{ refundTarget.email }}</span>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">退款时间（到点自动推企业微信；留空 = 不自动推）</label>
        <input
          v-model="refundForm.refundAt"
          type="datetime-local"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg"
        />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注（可选，随提醒一起发出）</label>
        <input
          v-model="refundForm.refundNote"
          placeholder="如：闲鱼订单号 / 买家要求 24h 退"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg"
        />
      </div>
      <div class="text-xs text-ink-500">
        修改时间会重置「已通知」标记；到点后由后台每分钟轮询自动推送完整账号信息到企业微信。
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="refundTarget = null">
        取消
      </button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm"
        @click="saveRefund"
      >
        保存
      </button>
    </template>
  </el-dialog>
</template>
