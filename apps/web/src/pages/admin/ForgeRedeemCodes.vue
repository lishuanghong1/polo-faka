<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const status = ref('');
const batchTag = ref('');
const keyword = ref('');
const loading = ref(false);

const showGenerate = ref(false);
const gen = ref({
  totalAmount: 50,
  count: 10,
  expireAt: '',
  prefix: 'FK',
  note: '',
});
const generated = ref<{ batchTag: string; codes: string[] } | null>(null);

function statusBadge(s: string) {
  return {
    ACTIVE: { text: '可用', cls: 'bg-emerald-100 text-emerald-700' },
    DISABLED: { text: '禁用', cls: 'bg-rose-100 text-rose-700' },
    EXHAUSTED: { text: '已用完', cls: 'bg-gray-100 text-gray-600' },
    EXPIRED: { text: '已过期', cls: 'bg-gray-100 text-gray-600' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

async function load() {
  loading.value = true;
  try {
    const r = await api.forge.admin.listCodes({
      page: page.value,
      pageSize: pageSize.value,
      status: status.value || undefined,
      batchTag: batchTag.value || undefined,
      keyword: keyword.value || undefined,
    });
    items.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

async function generate() {
  if (!gen.value.totalAmount || gen.value.totalAmount <= 0) {
    ElMessage.warning('请填写面额');
    return;
  }
  if (!gen.value.count || gen.value.count < 1) {
    ElMessage.warning('数量至少 1');
    return;
  }
  try {
    const r = await api.forge.admin.generateCodes({
      totalAmount: Number(gen.value.totalAmount),
      count: Number(gen.value.count),
      expireAt: gen.value.expireAt || undefined,
      prefix: gen.value.prefix || 'FK',
      note: gen.value.note || undefined,
    });
    generated.value = { batchTag: r.batchTag, codes: r.codes };
    ElMessage.success(`已生成 ${r.codes.length} 个兑换码`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '生成失败');
  }
}

function copyCodes() {
  if (!generated.value) return;
  navigator.clipboard
    .writeText(generated.value.codes.join('\n'))
    .then(() => ElMessage.success('已复制全部兑换码'));
}

async function toggle(it: any) {
  const next = it.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  try {
    await api.forge.admin.toggleStatus(it.id, next);
    it.status = next;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '操作失败');
  }
}

async function remove(it: any) {
  try {
    await ElMessageBox.confirm(`确定删除兑换码 ${it.code}？`, '确认', {
      type: 'warning',
    });
    await api.forge.admin.removeCode(it.id);
    ElMessage.success('已删除');
    await load();
  } catch (e: any) {
    if (e === 'cancel') return;
    ElMessage.error(e?.response?.data?.error?.message || '删除失败');
  }
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="Cursorforge 兑换码" subtitle="生成余额型兑换码（一码 N 元，可多次下单直至耗尽）">
    <template #actions>
      <button
        class="px-3.5 py-1.5 rounded-md bg-brand-600 text-white text-sm hover:bg-brand-700"
        @click="showGenerate = true; generated = null"
      >
        + 批量生成
      </button>
    </template>
  </AdminPageHeader>

  <!-- 过滤 -->
  <div class="card p-3 mb-4 flex flex-wrap gap-2 items-center">
    <input
      v-model="keyword"
      placeholder="搜索兑换码"
      class="px-3 py-1.5 border border-ink-200 rounded-md text-sm flex-1 min-w-40 sm:flex-none sm:w-56"
      @keydown.enter="page = 1; load()"
    />
    <input
      v-model="batchTag"
      placeholder="批次号"
      class="px-3 py-1.5 border border-ink-200 rounded-md text-sm flex-1 min-w-40 sm:flex-none sm:w-48 font-mono text-xs"
      @keydown.enter="page = 1; load()"
    />
    <select v-model="status" class="px-3 py-1.5 border border-ink-200 rounded-md text-sm bg-white flex-1 sm:flex-none">
      <option value="">全部状态</option>
      <option value="ACTIVE">可用</option>
      <option value="DISABLED">禁用</option>
      <option value="EXHAUSTED">已用完</option>
      <option value="EXPIRED">已过期</option>
    </select>
    <button
      class="px-3.5 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm shrink-0"
      @click="page = 1; load()"
    >筛选</button>
  </div>

  <!-- 列表 -->
  <div class="card p-0 overflow-hidden">
   <div class="overflow-auto max-h-[calc(100vh-300px)]">
    <table class="w-full text-sm min-w-[1040px]">
      <thead class="bg-ink-50 text-ink-600 sticky top-0 z-10">
        <tr>
          <th class="px-4 py-2.5 text-left font-medium">兑换码</th>
          <th class="px-4 py-2.5 text-right font-medium">面额</th>
          <th class="px-4 py-2.5 text-right font-medium">已用</th>
          <th class="px-4 py-2.5 text-right font-medium">剩余</th>
          <th class="px-4 py-2.5 text-center font-medium">状态</th>
          <th class="px-4 py-2.5 text-left font-medium">批次 / 创建时间</th>
          <th class="px-4 py-2.5 text-center font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" class="border-t border-ink-100">
          <td class="px-4 py-2">
            <code class="font-mono text-xs text-ink-900 whitespace-nowrap">{{ it.code }}</code>
            <div v-if="it.note" class="text-[11px] text-ink-400 mt-0.5">{{ it.note }}</div>
          </td>
          <td class="px-4 py-2 text-right whitespace-nowrap">¥{{ Number(it.totalAmount).toFixed(2) }}</td>
          <td class="px-4 py-2 text-right whitespace-nowrap">¥{{ Number(it.usedAmount).toFixed(2) }}</td>
          <td class="px-4 py-2 text-right text-emerald-700 font-medium whitespace-nowrap">
            ¥{{ (Number(it.totalAmount) - Number(it.usedAmount)).toFixed(2) }}
          </td>
          <td class="px-4 py-2 text-center">
            <span :class="['px-2 py-0.5 text-xs rounded-full', statusBadge(it.status).cls]">
              {{ statusBadge(it.status).text }}
            </span>
          </td>
          <td class="px-4 py-2 text-xs text-ink-500 whitespace-nowrap">
            <div class="font-mono">{{ it.batchTag || '—' }}</div>
            <div>{{ new Date(it.createdAt).toLocaleString() }}</div>
          </td>
          <td class="px-4 py-2 text-center whitespace-nowrap">
            <button
              v-if="it.status === 'ACTIVE'"
              class="text-xs text-ink-500 hover:text-rose-600 mx-1"
              @click="toggle(it)"
            >禁用</button>
            <button
              v-else-if="it.status === 'DISABLED'"
              class="text-xs text-ink-500 hover:text-emerald-600 mx-1"
              @click="toggle(it)"
            >启用</button>
            <button
              v-if="Number(it.usedAmount) === 0"
              class="text-xs text-ink-500 hover:text-rose-600 mx-1"
              @click="remove(it)"
            >删除</button>
          </td>
        </tr>
      </tbody>
    </table>
   </div>
    <div v-if="!items.length && !loading" class="py-12 text-center text-ink-400 text-sm">暂无数据</div>
  </div>

  <!-- 分页 -->
  <div class="mt-4 flex items-center justify-between text-sm text-ink-500">
    <div>共 {{ total }} 条</div>
    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1 rounded border border-ink-200 disabled:opacity-50"
        :disabled="page <= 1"
        @click="page--; load()"
      >上一页</button>
      <span>第 {{ page }} 页</span>
      <button
        class="px-3 py-1 rounded border border-ink-200 disabled:opacity-50"
        :disabled="page * pageSize >= total"
        @click="page++; load()"
      >下一页</button>
    </div>
  </div>

  <!-- 生成对话框 -->
  <div v-if="showGenerate" class="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" @click.self="showGenerate = false">
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
        <h3 class="font-semibold text-ink-900">批量生成兑换码</h3>
        <button class="text-ink-400 hover:text-ink-700" @click="showGenerate = false">✕</button>
      </div>

      <div v-if="!generated" class="p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink-700 mb-1">面额（CNY）</label>
          <input
            v-model.number="gen.totalAmount"
            type="number"
            min="0.01"
            step="0.01"
            class="w-full px-3 py-2 border border-ink-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 mb-1">生成数量</label>
          <input
            v-model.number="gen.count"
            type="number"
            min="1"
            max="5000"
            class="w-full px-3 py-2 border border-ink-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 mb-1">前缀</label>
          <input
            v-model="gen.prefix"
            placeholder="FK"
            maxlength="6"
            class="w-full px-3 py-2 border border-ink-200 rounded-md text-sm font-mono"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 mb-1">过期时间（可选）</label>
          <input
            v-model="gen.expireAt"
            type="datetime-local"
            class="w-full px-3 py-2 border border-ink-200 rounded-md text-sm"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 mb-1">备注</label>
          <input
            v-model="gen.note"
            placeholder="发给某代理 / 推广活动…"
            class="w-full px-3 py-2 border border-ink-200 rounded-md text-sm"
          />
        </div>

        <div class="pt-2 flex justify-end gap-2">
          <button class="px-4 py-2 rounded-md border border-ink-200 text-sm hover:bg-ink-50" @click="showGenerate = false">取消</button>
          <button class="px-4 py-2 rounded-md brand-gradient text-white text-sm" @click="generate">生成</button>
        </div>
      </div>

      <div v-else class="p-6 space-y-3">
        <div class="text-sm text-ink-700">
          已生成 <b class="text-emerald-600">{{ generated.codes.length }}</b> 个兑换码，批次号
          <code class="font-mono text-xs">{{ generated.batchTag }}</code>
        </div>
        <textarea
          readonly
          class="w-full h-60 p-3 border border-ink-200 rounded-md text-xs font-mono"
          :value="generated.codes.join('\n')"
        />
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-md border border-ink-200 text-sm hover:bg-ink-50" @click="copyCodes">复制全部</button>
          <button class="px-4 py-2 rounded-md brand-gradient text-white text-sm" @click="showGenerate = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
