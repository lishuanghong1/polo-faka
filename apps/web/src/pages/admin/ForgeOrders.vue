<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const status = ref('');
const paymentMethod = ref('');
const typeKey = ref('');
const keyword = ref('');
const loading = ref(false);

const detailVisible = ref(false);
const detail = ref<any>(null);
const retrying = ref<string | null>(null);

function statusBadge(s: string) {
  return {
    PENDING: { text: '待支付', cls: 'bg-amber-100 text-amber-700' },
    PAID: { text: '已付款', cls: 'bg-blue-100 text-blue-700' },
    DELIVERED: { text: '已发货', cls: 'bg-emerald-100 text-emerald-700' },
    FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
    CANCELLED: { text: '已取消', cls: 'bg-gray-100 text-gray-600' },
    EXPIRED: { text: '已过期', cls: 'bg-gray-100 text-gray-600' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

function payMethodBadge(m: string) {
  return {
    ALIPAY: { text: '支付宝', cls: 'bg-blue-50 text-blue-700' },
    REDEEM: { text: '兑换码', cls: 'bg-purple-50 text-purple-700' },
  }[m] || { text: m, cls: 'bg-gray-50 text-gray-600' };
}

async function load() {
  loading.value = true;
  try {
    const r = await api.forge.admin.listOrders({
      page: page.value,
      pageSize: pageSize.value,
      status: status.value || undefined,
      paymentMethod: paymentMethod.value || undefined,
      typeKey: typeKey.value || undefined,
      keyword: keyword.value || undefined,
    });
    items.value = r.items;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

async function view(orderNo: string) {
  try {
    detail.value = await api.forge.admin.orderDetail(orderNo);
    detailVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '加载失败');
  }
}

async function retry(orderNo: string) {
  retrying.value = orderNo;
  try {
    await api.forge.admin.retryFulfill(orderNo);
    ElMessage.success('重发成功');
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '重发失败');
  } finally {
    retrying.value = null;
  }
}

function copy(text: string, label = '已复制') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => ElMessage.success(label));
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="Cursorforge 订单" subtitle="所有通过兑换码下单的三方订单流水" />

  <div class="card p-3 mb-4 flex flex-wrap gap-2 items-center">
    <input
      v-model="keyword"
      placeholder="本站订单号 / 上游订单号"
      class="px-3 py-1.5 border border-ink-200 rounded-md text-sm w-64"
      @keydown.enter="page = 1; load()"
    />
    <input
      v-model="typeKey"
      placeholder="商品 type_key"
      class="px-3 py-1.5 border border-ink-200 rounded-md text-sm w-48 font-mono text-xs"
      @keydown.enter="page = 1; load()"
    />
    <select v-model="status" class="px-3 py-1.5 border border-ink-200 rounded-md text-sm bg-white">
      <option value="">全部状态</option>
      <option value="PENDING">待支付</option>
      <option value="PAID">已付款</option>
      <option value="DELIVERED">已发货</option>
      <option value="FAILED">失败</option>
      <option value="EXPIRED">已过期</option>
      <option value="CANCELLED">已取消</option>
    </select>
    <select v-model="paymentMethod" class="px-3 py-1.5 border border-ink-200 rounded-md text-sm bg-white">
      <option value="">全部支付方式</option>
      <option value="ALIPAY">支付宝</option>
      <option value="REDEEM">兑换码</option>
    </select>
    <button
      class="px-3.5 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm"
      @click="page = 1; load()"
    >筛选</button>
  </div>

  <div class="card p-0 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-ink-50 text-ink-600">
        <tr>
          <th class="px-4 py-2.5 text-left font-medium">订单号</th>
          <th class="px-4 py-2.5 text-left font-medium">商品</th>
          <th class="px-4 py-2.5 text-center font-medium">支付方式</th>
          <th class="px-4 py-2.5 text-left font-medium">联系方式</th>
          <th class="px-4 py-2.5 text-center font-medium">数量</th>
          <th class="px-4 py-2.5 text-right font-medium">售价</th>
          <th class="px-4 py-2.5 text-right font-medium">三方成本</th>
          <th class="px-4 py-2.5 text-center font-medium">状态</th>
          <th class="px-4 py-2.5 text-left font-medium">时间</th>
          <th class="px-4 py-2.5 text-center font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.orderNo" class="border-t border-ink-100">
          <td class="px-4 py-3">
            <code class="font-mono text-xs text-ink-900 break-all">{{ it.orderNo }}</code>
            <div v-if="it.upstreamOrderNo" class="text-[11px] text-ink-400 mt-0.5">
              上游 <code class="font-mono">{{ it.upstreamOrderNo }}</code>
            </div>
            <div v-if="it.redeemCode" class="text-[11px] text-ink-400 mt-0.5">
              code <code class="font-mono">{{ it.redeemCode }}</code>
            </div>
            <div v-if="it.thirdTradeNo" class="text-[11px] text-ink-400 mt-0.5">
              支付 <code class="font-mono">{{ it.thirdTradeNo }}</code>
            </div>
          </td>
          <td class="px-4 py-3">
            <div class="text-ink-900">{{ it.typeName }}</div>
            <div class="text-[11px] text-ink-400 font-mono">{{ it.typeKey }}</div>
          </td>
          <td class="px-4 py-3 text-center">
            <span :class="['px-2 py-0.5 text-xs rounded', payMethodBadge(it.paymentMethod).cls]">
              {{ payMethodBadge(it.paymentMethod).text }}
            </span>
          </td>
          <td class="px-4 py-3 text-xs text-ink-700 max-w-[160px] truncate" :title="it.contact || ''">
            {{ it.contact || '—' }}
          </td>
          <td class="px-4 py-3 text-center">× {{ it.quantity }}</td>
          <td class="px-4 py-3 text-right">¥{{ Number(it.totalAmount).toFixed(2) }}</td>
          <td class="px-4 py-3 text-right text-ink-500">
            {{ it.upstreamAmount !== null ? '¥' + Number(it.upstreamAmount).toFixed(2) : '—' }}
          </td>
          <td class="px-4 py-3 text-center">
            <span :class="['px-2 py-0.5 text-xs rounded-full', statusBadge(it.status).cls]">
              {{ statusBadge(it.status).text }}
            </span>
            <div v-if="it.failReason" class="text-[10px] text-rose-600 mt-1 max-w-[160px] mx-auto truncate" :title="it.failReason">
              {{ it.failReason }}
            </div>
          </td>
          <td class="px-4 py-3 text-xs text-ink-500">
            {{ new Date(it.createdAt).toLocaleString() }}
          </td>
          <td class="px-4 py-3 text-center whitespace-nowrap">
            <button class="text-xs text-brand-600 hover:underline mx-1" @click="view(it.orderNo)">查看</button>
            <button
              v-if="['FAILED', 'PAID'].includes(it.status)"
              class="text-xs text-emerald-600 hover:underline mx-1 disabled:opacity-50"
              :disabled="retrying === it.orderNo"
              @click="retry(it.orderNo)"
            >{{ retrying === it.orderNo ? '重发中…' : '重发' }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!items.length && !loading" class="py-12 text-center text-ink-400 text-sm">暂无数据</div>
  </div>

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

  <!-- 详情对话框 -->
  <div v-if="detailVisible" class="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" @click.self="detailVisible = false">
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
      <div class="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
        <h3 class="font-semibold text-ink-900">订单详情</h3>
        <button class="text-ink-400 hover:text-ink-700" @click="detailVisible = false">✕</button>
      </div>
      <div v-if="detail" class="p-6 space-y-4 text-sm">
        <dl class="grid grid-cols-2 gap-y-2">
          <dt class="text-ink-500">订单号</dt><dd class="font-mono text-xs break-all">{{ detail.orderNo }}</dd>
          <dt class="text-ink-500">商品</dt><dd>{{ detail.typeName }}</dd>
          <dt class="text-ink-500">数量</dt><dd>× {{ detail.quantity }}</dd>
          <dt class="text-ink-500">单价</dt><dd>¥{{ Number(detail.displayPrice).toFixed(2) }}</dd>
          <dt class="text-ink-500">合计</dt><dd>¥{{ Number(detail.totalAmount).toFixed(2) }}</dd>
          <dt class="text-ink-500">状态</dt><dd>{{ statusBadge(detail.status).text }}</dd>
          <dt v-if="detail.upstreamOrderNo" class="text-ink-500">上游单号</dt>
          <dd v-if="detail.upstreamOrderNo" class="font-mono text-xs">{{ detail.upstreamOrderNo }}</dd>
        </dl>

        <div v-if="detail.failReason" class="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-sm">
          {{ detail.failReason }}
        </div>

        <div v-if="detail.accounts?.length">
          <div class="text-sm font-medium text-ink-800 mb-2">账号列表</div>
          <ul class="space-y-2">
            <li v-for="(a, i) in detail.accounts" :key="i" class="p-3 bg-ink-50 rounded-lg space-y-1.5">
              <div class="flex items-center gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0">邮箱</span>
                <code class="text-xs flex-1 break-all">{{ a.account_json?.email || a.email }}</code>
                <button class="text-xs text-brand-600 hover:underline" @click="copy(a.account_json?.email || a.email, '邮箱已复制')">复制</button>
              </div>
              <div v-if="a.account_json?.access_token" class="flex items-start gap-2">
                <span class="text-xs text-ink-500 w-12 shrink-0 mt-1">Token</span>
                <code class="text-[10px] flex-1 break-all font-mono leading-relaxed">{{ a.account_json.access_token }}</code>
                <button class="text-xs text-brand-600 hover:underline mt-1" @click="copy(a.account_json!.access_token, 'Token 已复制')">复制</button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
