<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

const overview = ref<any>({ ACTIVE: 0, DISABLED: 0, EXHAUSTED: 0, EXPIRED: 0, total: 0 });
const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const filter = ref<{ status?: string; batchTag?: string; skuId?: number; keyword?: string }>({});
const products = ref<any[]>([]);
const batches = ref<any[]>([]);
const selected = ref<Set<number>>(new Set());

const statusLabels: Record<string, string> = {
  ACTIVE: '可用',
  DISABLED: '已禁用',
  EXHAUSTED: '已用完',
  EXPIRED: '已过期',
};
const statusClass: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISABLED: 'bg-ink-100 text-ink-500 border-ink-200',
  EXHAUSTED: 'bg-ink-100 text-ink-500 border-ink-200',
  EXPIRED: 'bg-amber-50 text-amber-700 border-amber-200',
};

const generateOpen = ref(false);
const gen = ref<{
  productId?: number;
  skuId?: number;
  count: number;
  qtyPerUse: number;
  maxUses: number;
  expireAt?: string;
  note?: string;
  prefix: string;
}>({ count: 10, qtyPerUse: 1, maxUses: 1, prefix: 'RD' });
const generatedResult = ref<{ batchTag: string; codes: string[]; product: string; sku: string } | null>(null);

const selectedProduct = computed(() => products.value.find((p: any) => p.id === gen.value.productId));

watch(() => gen.value.productId, () => {
  gen.value.skuId = undefined;
});

async function loadAll() {
  await Promise.all([loadOverview(), loadBatches(), loadList(), loadProducts()]);
}

async function loadOverview() {
  overview.value = await api.admin.redeemOverview();
}

async function loadBatches() {
  batches.value = await api.admin.redeemBatches();
}

async function loadProducts() {
  const a = await api.products({ pageSize: 200 });
  products.value = a.items;
}

async function loadList() {
  loading.value = true;
  try {
    const r = await api.admin.redeemList({ ...filter.value, page: page.value, pageSize: 50 });
    list.value = r.items;
    total.value = r.total;
    selected.value = new Set();
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

async function doGenerate() {
  if (!gen.value.productId || !gen.value.skuId) {
    ElMessage.warning('请选择商品 / 规格');
    return;
  }
  if (!gen.value.count || gen.value.count <= 0) {
    ElMessage.warning('生成数量必须 ≥ 1');
    return;
  }
  const r = await api.admin.redeemGenerate({
    productId: gen.value.productId,
    skuId: gen.value.skuId,
    count: gen.value.count,
    qtyPerUse: gen.value.qtyPerUse,
    maxUses: gen.value.maxUses,
    expireAt: gen.value.expireAt || null,
    note: gen.value.note,
    prefix: gen.value.prefix || 'RD',
  });
  generatedResult.value = r;
  ElMessage.success(`已生成 ${r.count} 个兑换码`);
  await loadAll();
}

function copyCodes() {
  if (!generatedResult.value) return;
  navigator.clipboard.writeText(generatedResult.value.codes.join('\n'));
  ElMessage.success('已复制到剪贴板');
}

function downloadCodes(codes: string[], filename: string) {
  const text = codes.join('\r\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadBatch(tag: string) {
  const r = await api.admin.redeemGetBatch(tag);
  downloadCodes(r.items.map((i: any) => i.code), `${tag}.txt`);
}

async function toggleStatus(row: any) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  if (row.status === 'EXHAUSTED' || row.status === 'EXPIRED') {
    ElMessage.warning('该状态不允许切换');
    return;
  }
  await api.admin.redeemSetStatus(row.id, next as any);
  ElMessage.success('已更新');
  await loadList();
  await loadOverview();
}

async function batchSetStatus(status: 'ACTIVE' | 'DISABLED') {
  const ids = Array.from(selected.value);
  if (!ids.length) return ElMessage.warning('未选择任何兑换码');
  await api.admin.redeemBatchStatus(ids, status);
  ElMessage.success(`已 ${status === 'ACTIVE' ? '启用' : '禁用'} ${ids.length} 个`);
  await loadList();
  await loadOverview();
}

async function batchRemove() {
  const ids = Array.from(selected.value);
  if (!ids.length) return ElMessage.warning('未选择任何兑换码');
  try {
    await ElMessageBox.confirm(
      `将永久删除 ${ids.length} 个未使用的兑换码（已用过的会被跳过）。继续？`,
      '危险操作',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const r = await api.admin.redeemBatchRemove(ids);
  ElMessage.success(`已删除 ${r.deleted} 个`);
  await loadList();
  await loadOverview();
}

function toggleSelectAll(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.checked) {
    selected.value = new Set(list.value.map((r) => r.id));
  } else {
    selected.value = new Set();
  }
}

function toggleOne(id: number, e: Event) {
  const target = e.target as HTMLInputElement;
  const s = new Set(selected.value);
  if (target.checked) s.add(id);
  else s.delete(id);
  selected.value = s;
}

const allSelected = computed(() => list.value.length > 0 && selected.value.size === list.value.length);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 50)));
</script>

<template>
  <AdminPageHeader title="兑换码管理" subtitle="批量生成兑换码，客户输入码即可获取卡密 / 号池资源">
    <template #actions>
      <button class="btn-primary" @click="generatedResult = null; generateOpen = true">
        生成兑换码
      </button>
    </template>
  </AdminPageHeader>

  <!-- 概览 -->
  <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
    <div class="card p-4">
      <div class="text-xs text-ink-500">总数</div>
      <div class="text-2xl font-semibold text-ink-800 mt-1">{{ overview.total }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-500">可用</div>
      <div class="text-2xl font-semibold text-emerald-600 mt-1">{{ overview.ACTIVE }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-500">已用完</div>
      <div class="text-2xl font-semibold text-ink-600 mt-1">{{ overview.EXHAUSTED }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-500">已禁用</div>
      <div class="text-2xl font-semibold text-ink-500 mt-1">{{ overview.DISABLED }}</div>
    </div>
    <div class="card p-4">
      <div class="text-xs text-ink-500">已过期</div>
      <div class="text-2xl font-semibold text-amber-600 mt-1">{{ overview.EXPIRED }}</div>
    </div>
  </div>

  <!-- 最近批次 -->
  <div v-if="batches.length" class="card p-4 mb-4">
    <div class="text-sm font-semibold text-ink-800 mb-2">最近批次</div>
    <div class="flex flex-wrap gap-2">
      <div
        v-for="b in batches.slice(0, 8)"
        :key="b.batchTag"
        class="px-3 py-1.5 rounded-lg bg-ink-50 border border-ink-200 text-xs cursor-pointer hover:bg-brand-50 hover:border-brand-300 transition"
        @click="filter.batchTag = b.batchTag; page = 1; loadList()"
      >
        <span class="font-mono">{{ b.batchTag }}</span>
        <span class="text-ink-500 ml-2">{{ b.count }} 个</span>
        <button class="ml-2 text-brand-600 hover:underline" @click.stop="downloadBatch(b.batchTag)">下载</button>
      </div>
    </div>
  </div>

  <!-- 过滤 + 批量动作 -->
  <div class="card p-3 mb-4 flex items-center gap-2 text-sm flex-wrap">
    <select v-model="filter.status" class="px-3 py-1.5 border border-ink-200 rounded-lg bg-white flex-1 sm:flex-none">
      <option :value="undefined">所有状态</option>
      <option value="ACTIVE">可用</option>
      <option value="DISABLED">已禁用</option>
      <option value="EXHAUSTED">已用完</option>
      <option value="EXPIRED">已过期</option>
    </select>
    <input
      v-model="filter.keyword"
      placeholder="码内容（支持模糊）"
      class="px-3 py-1.5 border border-ink-200 rounded-lg flex-1 min-w-40 sm:flex-none sm:w-52"
      @keydown.enter="page = 1; loadList()"
    />
    <input
      v-model="filter.batchTag"
      placeholder="批次号"
      class="px-3 py-1.5 border border-ink-200 rounded-lg flex-1 min-w-40 sm:flex-none sm:w-48 font-mono"
      @keydown.enter="page = 1; loadList()"
    />
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg shrink-0" @click="page = 1; loadList()">查询</button>
    <button class="px-3 py-1.5 border border-ink-200 hover:bg-ink-50 rounded-lg shrink-0" @click="filter = {}; page = 1; loadList()">重置</button>

    <div v-if="selected.size > 0" class="sm:ml-auto flex items-center gap-2 text-xs flex-wrap w-full sm:w-auto">
      <span class="text-ink-500">已选 {{ selected.size }} 个</span>
      <button class="px-3 py-1.5 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg" @click="batchSetStatus('ACTIVE')">启用</button>
      <button class="px-3 py-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-lg" @click="batchSetStatus('DISABLED')">禁用</button>
      <button class="px-3 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg" @click="batchRemove">删除</button>
    </div>
  </div>

  <!-- 列表 -->
  <DataTable :loading="loading" :is-empty="!list.length">
    <thead>
      <tr>
        <th style="width: 40px">
          <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
        </th>
        <th style="width: 280px">兑换码</th>
        <th>商品 / 规格</th>
        <th style="width: 90px">单次发货</th>
        <th style="width: 100px">使用 / 上限</th>
        <th style="width: 100px">状态</th>
        <th style="width: 150px">批次</th>
        <th style="width: 140px">过期时间</th>
        <th style="width: 80px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.id">
        <td>
          <input type="checkbox" :checked="selected.has(row.id)" @change="(e) => toggleOne(row.id, e)" />
        </td>
        <td>
          <div class="font-mono text-sm text-ink-800">{{ row.code }}</div>
          <div v-if="row.note" class="text-xs text-ink-500 mt-0.5">{{ row.note }}</div>
        </td>
        <td>
          <div class="text-sm text-ink-800">{{ row.productTitle }}</div>
          <div class="text-xs text-ink-500">{{ row.skuName }}</div>
        </td>
        <td class="text-center text-sm text-ink-700">{{ row.qtyPerUse }}</td>
        <td class="text-center text-sm">
          <span class="text-ink-800 font-medium">{{ row.usedCount }}</span>
          <span class="text-ink-400"> / {{ row.maxUses }}</span>
        </td>
        <td>
          <span class="text-[11px] px-2 py-0.5 rounded border" :class="statusClass[row.status]">
            {{ statusLabels[row.status] }}
          </span>
        </td>
        <td class="font-mono text-xs text-ink-500">{{ row.batchTag }}</td>
        <td class="text-xs text-ink-500">{{ row.expireAt ? new Date(row.expireAt).toLocaleDateString() : '—' }}</td>
        <td>
          <button
            v-if="['ACTIVE', 'DISABLED'].includes(row.status)"
            class="text-xs text-brand-600 hover:underline"
            @click="toggleStatus(row)"
          >
            {{ row.status === 'ACTIVE' ? '禁用' : '启用' }}
          </button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <div v-if="totalPages > 1" class="mt-3 flex items-center justify-center gap-2 text-sm">
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-30" :disabled="page <= 1" @click="page--; loadList()">上一页</button>
    <span class="text-ink-500">{{ page }} / {{ totalPages }}</span>
    <button class="px-3 py-1 rounded border border-ink-200 disabled:opacity-30" :disabled="page >= totalPages" @click="page++; loadList()">下一页</button>
  </div>

  <!-- 生成弹窗 -->
  <el-dialog
    :model-value="generateOpen"
    @update:model-value="(v: boolean) => !v && (generateOpen = false)"
    :title="generatedResult ? '生成成功' : '生成兑换码'"
    width="640px"
    :close-on-click-modal="false"
  >
    <div v-if="!generatedResult" class="space-y-4">
      <div>
        <label class="text-sm text-ink-700 block mb-1">选择商品 *</label>
        <select v-model="gen.productId" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm">
          <option :value="undefined">请选择</option>
          <option v-for="p in products" :key="p.id" :value="p.id">{{ p.title }}</option>
        </select>
      </div>
      <div>
        <label class="text-sm text-ink-700 block mb-1">选择规格 *</label>
        <select v-model="gen.skuId" :disabled="!selectedProduct" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm">
          <option :value="undefined">请选择</option>
          <option v-for="s in selectedProduct?.skus || []" :key="s.id" :value="s.id">
            {{ s.name }} - ¥{{ s.price }}
          </option>
        </select>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="text-sm text-ink-700 block mb-1">生成数量 *</label>
          <input type="number" v-model.number="gen.count" min="1" max="5000" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="text-sm text-ink-700 block mb-1">单次兑换发货数量</label>
          <input type="number" v-model.number="gen.qtyPerUse" min="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="text-sm text-ink-700 block mb-1">每码可用次数</label>
          <input type="number" v-model.number="gen.maxUses" min="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-sm text-ink-700 block mb-1">过期时间（可选）</label>
          <input type="datetime-local" v-model="gen.expireAt" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm" />
        </div>
        <div>
          <label class="text-sm text-ink-700 block mb-1">码前缀</label>
          <input v-model="gen.prefix" maxlength="6" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono" />
        </div>
      </div>
      <div>
        <label class="text-sm text-ink-700 block mb-1">备注</label>
        <input v-model="gen.note" placeholder="例如：618 大促赠码" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm" />
      </div>
    </div>

    <div v-else class="space-y-3">
      <div class="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
        批次 <span class="font-mono">{{ generatedResult.batchTag }}</span> · 共 {{ generatedResult.codes.length }} 个 · {{ generatedResult.product }} / {{ generatedResult.sku }}
      </div>
      <textarea
        readonly
        :value="generatedResult.codes.join('\n')"
        rows="10"
        class="w-full px-3 py-2 border border-ink-200 rounded-lg text-xs font-mono break-all"
      ></textarea>
      <div class="text-xs text-ink-500">复制或下载后请妥善保管，关闭后从「最近批次」也可重新下载。</div>
    </div>

    <template #footer>
      <button v-if="!generatedResult" class="px-4 py-2 border border-ink-200 rounded-lg text-sm" @click="generateOpen = false">取消</button>
      <button v-if="!generatedResult" class="ml-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="doGenerate">生成</button>
      <template v-else>
        <button class="px-4 py-2 border border-ink-200 rounded-lg text-sm" @click="copyCodes">复制</button>
        <button class="ml-2 px-4 py-2 border border-ink-200 rounded-lg text-sm" @click="downloadCodes(generatedResult.codes, generatedResult.batchTag + '.txt')">下载</button>
        <button class="ml-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="generateOpen = false">完成</button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.btn-primary {
  @apply px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shadow-sm;
}
</style>
