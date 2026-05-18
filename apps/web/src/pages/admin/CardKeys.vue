<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';

const list = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const filter = ref<{ productId?: number; skuId?: number; status?: string }>({});
const products = ref<any[]>([]);
const overview = ref<any[]>([]);
const importing = ref<{ productId?: number; skuId?: number; content: string; remark?: string } | null>(null);
const selected = ref<Set<number>>(new Set());

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.keysList({ ...filter.value, page: page.value, pageSize: 50 });
    list.value = a.items;
    total.value = a.total;
    selected.value = new Set();
  } finally {
    loading.value = false;
  }
}

async function loadOverview() {
  overview.value = await api.admin.keysOverview();
}

async function loadProducts() {
  const a = await api.products({ pageSize: 200 });
  products.value = a.items;
}

onMounted(async () => {
  await Promise.all([loadProducts(), loadOverview()]);
  load();
});

function openImport(prefill?: { productId: number; skuId: number }) {
  importing.value = {
    productId: prefill?.productId ?? products.value[0]?.id,
    skuId: prefill?.skuId ?? products.value[0]?.skus?.[0]?.id,
    content: '',
    remark: '',
  };
}

async function doImport() {
  if (!importing.value?.productId || !importing.value?.skuId || !importing.value.content.trim()) {
    ElMessage.warning('请选择商品/规格并填写卡密');
    return;
  }
  const r = await api.admin.keysBulk(importing.value);
  if (r.duplicated) {
    ElMessage.success(`导入 ${r.inserted} 条，跳过 ${r.duplicated} 条重复`);
  } else {
    ElMessage.success(`成功导入 ${r.inserted} 条卡密`);
  }
  importing.value = null;
  load();
  loadOverview();
}

async function del(k: any) {
  await ElMessageBox.confirm('确认删除该卡密？', '提示', { type: 'warning' });
  await api.admin.keysRemove(k.id);
  load();
  loadOverview();
}

async function bulkDelete() {
  if (!selected.value.size) {
    ElMessage.warning('请先勾选要删除的卡密');
    return;
  }
  await ElMessageBox.confirm(`确认删除选中的 ${selected.value.size} 条卡密？`, '提示', { type: 'warning' });
  const r = await api.admin.keysBulkRemove(Array.from(selected.value));
  ElMessage.success(`已删除 ${r.deleted} 条`);
  load();
  loadOverview();
}

async function purgeSold(o: any) {
  if (!o.SOLD) return;
  await ElMessageBox.confirm(
    `清理「${o.productTitle} / ${o.skuName}」下 ${o.SOLD} 条已售卡密？\n（不影响订单，仅从库中移除以缩减体积）`,
    '提示',
    { type: 'warning' },
  );
  const r = await api.admin.keysPurge(o.skuId, 'SOLD');
  ElMessage.success(`已清理 ${r.deleted} 条`);
  loadOverview();
  load();
}

function toggle(id: number) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}

function toggleAll() {
  if (selected.value.size === list.value.length && list.value.length > 0) {
    selected.value = new Set();
  } else {
    selected.value = new Set(list.value.map((k) => k.id));
  }
}

const skusOfImport = computed(() => {
  return products.value.find((p) => p.id === importing.value?.productId)?.skus || [];
});

watch(() => importing.value?.productId, () => {
  if (importing.value) importing.value.skuId = skusOfImport.value[0]?.id;
});

const lineCount = computed(() => {
  return (importing.value?.content || '').split(/\r?\n/).filter((s) => s.trim()).length;
});

const overviewSummary = computed(() => {
  return overview.value.reduce(
    (acc, o) => {
      acc.AVAILABLE += o.AVAILABLE;
      acc.SOLD += o.SOLD;
      acc.LOCKED += o.LOCKED;
      acc.total += o.total;
      return acc;
    },
    { AVAILABLE: 0, SOLD: 0, LOCKED: 0, total: 0 },
  );
});

function quickFilter(skuId: number) {
  filter.value = { skuId };
  load();
}
</script>

<template>
  <AdminPageHeader title="卡密池" :subtitle="`共 ${overviewSummary.total} 张，可售 ${overviewSummary.AVAILABLE} 张`">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="openImport()">
        + 批量导入
      </button>
    </template>
  </AdminPageHeader>

  <!-- 库存总览 4 联屏 -->
  <div class="card p-4 mb-4 flex items-center divide-x divide-ink-100">
    <div class="flex-1 px-4 first:pl-2">
      <div class="text-xs text-ink-500">总卡密</div>
      <div class="mt-1 text-lg font-medium text-ink-900">{{ overviewSummary.total }}</div>
    </div>
    <div class="flex-1 px-4">
      <div class="text-xs text-ink-500">可售</div>
      <div class="mt-1 text-lg font-semibold text-brand-700">{{ overviewSummary.AVAILABLE }}</div>
    </div>
    <div class="flex-1 px-4">
      <div class="text-xs text-ink-500">已售</div>
      <div class="mt-1 text-lg font-medium text-ink-700">{{ overviewSummary.SOLD }}</div>
    </div>
    <div class="flex-1 px-4 last:pr-2">
      <div class="text-xs text-ink-500">锁定中</div>
      <div class="mt-1 text-lg font-medium text-amber-700">{{ overviewSummary.LOCKED }}</div>
    </div>
  </div>

  <!-- 按 SKU 维度的库存表 -->
  <div class="card p-5 mb-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-semibold text-ink-900">商品 / 规格 库存</h2>
      <span class="text-xs text-ink-400">点击规格名 → 筛选 / 点击补货 → 直接灌卡</span>
    </div>
    <div v-if="!overview.length" class="py-10 text-center text-sm text-ink-400">
      还没有任何卡密，<button class="text-brand-700 hover:underline" @click="openImport()">立即导入</button>
    </div>
    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-ink-400 text-[11px] uppercase tracking-wider">
          <th class="text-left font-medium py-2">商品 / 规格</th>
          <th class="text-right font-medium py-2 pr-3">单价</th>
          <th class="text-right font-medium py-2 pr-3">可售</th>
          <th class="text-right font-medium py-2 pr-3">已售</th>
          <th class="text-right font-medium py-2 pr-3">锁定</th>
          <th class="text-right font-medium py-2 pr-3">总数</th>
          <th class="text-right font-medium py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="o in overview" :key="o.skuId" class="border-t border-ink-100">
          <td class="py-2.5">
            <button class="text-left hover:text-brand-700" @click="quickFilter(o.skuId)">
              <div class="font-medium text-ink-900">{{ o.productTitle }}</div>
              <div class="text-xs text-ink-500">{{ o.skuName }}</div>
            </button>
          </td>
          <td class="text-right text-ink-600 pr-3">¥{{ o.price }}</td>
          <td class="text-right pr-3">
            <span :class="o.AVAILABLE < 5 ? 'text-amber-700 font-semibold' : o.AVAILABLE > 0 ? 'text-brand-700 font-semibold' : 'text-ink-400'">
              {{ o.AVAILABLE }}
            </span>
          </td>
          <td class="text-right text-ink-500 pr-3">{{ o.SOLD }}</td>
          <td class="text-right text-ink-500 pr-3">{{ o.LOCKED }}</td>
          <td class="text-right text-ink-700 pr-3">{{ o.total }}</td>
          <td class="text-right whitespace-nowrap py-2">
            <button
              class="text-xs px-2 py-1 rounded border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 mr-2"
              @click="openImport({ productId: o.productId, skuId: o.skuId })"
            >
              + 补货
            </button>
            <button
              v-if="o.SOLD > 0"
              class="text-xs px-2 py-1 rounded border border-ink-200 text-ink-500 hover:bg-ink-50"
              @click="purgeSold(o)"
            >
              清理已售
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 明细列表 -->
  <div class="card p-3 mb-3 flex items-center gap-2 text-sm">
    <select v-model="filter.productId" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white w-56" @change="filter.skuId = undefined">
      <option :value="undefined">全部商品</option>
      <option v-for="p in products" :key="p.id" :value="p.id">{{ p.title }}</option>
    </select>
    <select v-model="filter.status" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white">
      <option :value="undefined">全部状态</option>
      <option value="AVAILABLE">可售</option>
      <option value="SOLD">已售</option>
      <option value="LOCKED">锁定</option>
      <option value="EXPIRED">失效</option>
      <option value="REFUNDED">退款</option>
    </select>
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="load">查询</button>
    <span v-if="filter.skuId" class="text-xs text-ink-500">
      已按 SKU #{{ filter.skuId }} 筛选
      <button class="ml-1 text-brand-700 hover:underline" @click="filter.skuId = undefined; load()">×清除</button>
    </span>
    <span class="ml-auto flex items-center gap-3">
      <span v-if="selected.size" class="text-xs text-ink-500">已选 {{ selected.size }} 条</span>
      <button
        :disabled="!selected.size"
        class="text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
        @click="bulkDelete"
      >
        批量删除
      </button>
    </span>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length">
    <thead>
      <tr>
        <th style="width: 36px">
          <input
            type="checkbox"
            :checked="selected.size === list.length && list.length > 0"
            @change="toggleAll"
          />
        </th>
        <th style="width: 60px">ID</th>
        <th>SKU</th>
        <th>内容</th>
        <th>状态</th>
        <th>订单</th>
        <th class="!text-right" style="width: 80px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="k in list" :key="k.id">
        <td>
          <input type="checkbox" :checked="selected.has(k.id)" @change="toggle(k.id)" />
        </td>
        <td class="text-ink-400 font-mono text-xs">#{{ k.id }}</td>
        <td class="text-ink-600 text-xs">SKU#{{ k.skuId }}</td>
        <td>
          <code class="text-xs text-ink-700 font-mono break-all">
            {{ k.content.length > 80 ? k.content.slice(0, 80) + '…' : k.content }}
          </code>
        </td>
        <td><StatusTag :status="k.status" /></td>
        <td class="text-xs font-mono text-ink-500">{{ k.orderNo || '—' }}</td>
        <td class="text-right">
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(k)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!importing"
    :show-close="true"
    width="640px"
    title="批量导入卡密"
    @update:model-value="(v: boolean) => !v && (importing = null)"
    @close="importing = null"
  >
    <div v-if="importing" class="space-y-3 text-sm">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-ink-500 mb-1">商品</label>
          <select v-model="importing.productId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option v-for="p in products" :key="p.id" :value="p.id">{{ p.title }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">规格</label>
          <select v-model="importing.skuId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option v-for="s in skusOfImport" :key="s.id" :value="s.id">{{ s.name }} (¥{{ s.price }})</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注（可选）</label>
        <input v-model="importing.remark" placeholder="如：批次号 / 来源" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-ink-500">卡密内容（一行一条，自动去重）</label>
          <span class="text-xs text-ink-400">{{ lineCount }} 行</span>
        </div>
        <textarea
          v-model="importing.content"
          rows="12"
          placeholder="一行一条卡密&#10;例如：&#10;user1@example.com----PWD1000&#10;user2@example.com----PWD1001"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
        />
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="importing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="doImport">
        导入 {{ lineCount }} 条
      </button>
    </template>
  </el-dialog>
</template>
