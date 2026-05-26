<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import EmailCodeBox from '@/components/EmailCodeBox.vue';

const route = useRoute();
const router = useRouter();

const order = ref<any>(null);
const loading = ref(true);
const errorMsg = ref('');
const contactPrompt = ref('');
const needContact = ref(false);
let pollTimer: number | undefined;

const orderNo = computed(() => route.params.orderNo as string);

const primaryEmail = computed(() => {
  const first = order.value?.accounts?.[0];
  return first?.account_json?.email || first?.email || '';
});

function isMobile() {
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

function statusBadge(s: string) {
  return {
    PENDING: { text: '待支付', cls: 'bg-amber-100 text-amber-700' },
    PAID: { text: '已付款（发货中）', cls: 'bg-blue-100 text-blue-700' },
    DELIVERED: { text: '已发货', cls: 'bg-emerald-100 text-emerald-700' },
    FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
    CANCELLED: { text: '已取消', cls: 'bg-gray-100 text-gray-600' },
    EXPIRED: { text: '已过期', cls: 'bg-gray-100 text-gray-600' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

async function load(contact?: string) {
  try {
    order.value = await api.forge.orderDetail(orderNo.value, contact);
    needContact.value = false;
    errorMsg.value = '';
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || '订单不存在';
    if (e?.response?.status === 404 && !contact) {
      needContact.value = true;
    }
    errorMsg.value = msg;
  } finally {
    loading.value = false;
  }
}

function checkContact() {
  if (!contactPrompt.value.trim()) {
    ElMessage.warning('请输入联系方式');
    return;
  }
  loading.value = true;
  load(contactPrompt.value.trim());
}

async function copy(text: string, label = '已复制') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(label);
  } catch {
    ElMessage.error('复制失败');
  }
}

function copyAll() {
  const lines: string[] = [];
  for (const a of order.value?.accounts || []) {
    const email = a.account_json?.email || a.email;
    const token = a.account_json?.access_token;
    if (email) lines.push(`邮箱: ${email}`);
    if (token) lines.push(`Token: ${token}`);
    lines.push('---');
  }
  copy(lines.join('\n'), '已复制全部账号');
}

async function goPay() {
  try {
    const channel = isMobile() ? 'WAP' : 'PC';
    const { payUrl } = await api.pay.alipayCreate(orderNo.value, channel);
    window.location.href = payUrl;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '创建支付链接失败');
  }
}

// 待支付 / 发货中 → 每 3 秒轮询一次状态
function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    if (!order.value) return;
    if (['PENDING', 'PAID'].includes(order.value.status)) {
      try {
        const fresh = await api.forge.orderDetail(orderNo.value, order.value.contact || undefined);
        order.value = fresh;
      } catch {
        /* ignore */
      }
    } else {
      stopPolling();
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

watch(
  () => order.value?.status,
  (s) => {
    if (s === 'PENDING' || s === 'PAID') startPolling();
    else stopPolling();
  },
);

onMounted(() => load());
onBeforeUnmount(stopPolling);
</script>

<template>
  <section class="max-w-3xl mx-auto px-4 py-8">
    <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>

    <!-- 需要联系方式校验 -->
    <div v-else-if="needContact" class="card p-6">
      <h2 class="text-lg font-semibold mb-3">订单受保护</h2>
      <p class="text-sm text-ink-500 mb-4">该订单下单时填了联系方式，请输入对应的 QQ / 邮箱 / 手机号查看：</p>
      <div class="flex gap-2">
        <input
          v-model="contactPrompt"
          class="flex-1 px-3 py-2 border border-ink-200 rounded-lg text-sm"
          placeholder="下单时填的联系方式"
          @keydown.enter="checkContact"
        />
        <button class="px-4 py-2 brand-gradient text-white rounded-lg text-sm" @click="checkContact">
          查看
        </button>
      </div>
      <div v-if="errorMsg" class="mt-3 text-sm text-rose-600">{{ errorMsg }}</div>
    </div>

    <div v-else-if="errorMsg && !order" class="card p-10 text-center">
      <div class="text-rose-600 text-sm">{{ errorMsg }}</div>
      <button class="mt-4 px-4 py-2 rounded-lg border border-ink-200 text-sm hover:bg-ink-50" @click="router.push('/')">
        返回首页
      </button>
    </div>

    <template v-else-if="order">
      <!-- 订单信息 -->
      <div class="card p-6 bg-white border border-ink-100 rounded-2xl">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="text-lg font-semibold text-ink-900">订单详情</h2>
          <span :class="['px-2.5 py-1 text-xs rounded-full', statusBadge(order.status).cls]">
            {{ statusBadge(order.status).text }}
          </span>
        </div>

        <dl class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-ink-500">订单号</dt><dd class="font-mono text-xs break-all">{{ order.orderNo }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">支付方式</dt><dd>{{ order.paymentMethod === 'ALIPAY' ? '支付宝' : '兑换码' }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">商品</dt><dd class="truncate">{{ order.typeName }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">数量</dt><dd>× {{ order.quantity }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">单价</dt><dd>¥{{ order.displayPrice.toFixed(2) }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">合计</dt><dd class="font-semibold text-rose-600">¥{{ order.totalAmount.toFixed(2) }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-ink-500">下单时间</dt><dd>{{ new Date(order.createdAt).toLocaleString() }}</dd></div>
          <div v-if="order.paidAt" class="flex justify-between gap-3">
            <dt class="text-ink-500">付款时间</dt>
            <dd>{{ new Date(order.paidAt).toLocaleString() }}</dd>
          </div>
          <div v-if="order.deliveredAt" class="flex justify-between gap-3">
            <dt class="text-ink-500">发货时间</dt>
            <dd>{{ new Date(order.deliveredAt).toLocaleString() }}</dd>
          </div>
          <div v-if="order.thirdTradeNo" class="flex justify-between gap-3">
            <dt class="text-ink-500">支付单号</dt>
            <dd class="font-mono text-xs break-all">{{ order.thirdTradeNo }}</dd>
          </div>
        </dl>

        <!-- 失败提示 -->
        <div v-if="order.status === 'FAILED' && order.failReason" class="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
          ❌ 发货失败：{{ order.failReason }}
          <div class="mt-1 text-xs text-rose-600">如已付款但未发货，请联系客服处理；管理员可在后台手动重试。</div>
        </div>

        <!-- 等待付款 -->
        <div v-if="order.status === 'PENDING'" class="mt-5 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="text-sm text-amber-800">
              请尽快支付完成订单，超时订单将自动取消。
              <span v-if="order.expireAt" class="text-xs ml-1">
                （{{ new Date(order.expireAt).toLocaleString() }} 前）
              </span>
            </div>
            <button class="px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 shrink-0" @click="goPay">
              去支付
            </button>
          </div>
        </div>

        <!-- 已付款分配中 -->
        <div v-if="order.status === 'PAID'" class="mt-5 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div class="text-sm text-blue-800">付款已确认，正在为您发货…（约 3-10 秒）</div>
        </div>
      </div>

      <!-- 账号列表 -->
      <div v-if="order.accounts?.length" class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-medium text-ink-800">账号交付</h3>
          <button class="text-sm text-brand-600 hover:underline" @click="copyAll">一键复制全部</button>
        </div>

        <ul class="space-y-3">
          <li v-for="(a, i) in order.accounts" :key="i" class="p-4 bg-ink-50/60 rounded-lg space-y-2">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="text-xs text-ink-500">账号 #{{ i + 1 }}</div>
              <div v-if="a.id" class="text-xs text-ink-400 font-mono">ID: {{ a.id }}</div>
            </div>

            <div class="flex items-center gap-2">
              <div class="text-xs text-ink-500 w-12 shrink-0">邮箱</div>
              <code class="text-sm text-ink-900 break-all flex-1">{{ a.account_json?.email || a.email }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0" @click="copy((a.account_json?.email || a.email) as string, '邮箱已复制')">复制</button>
            </div>

            <div v-if="a.account_json?.access_token" class="flex items-start gap-2">
              <div class="text-xs text-ink-500 w-12 shrink-0 mt-1">Token</div>
              <code class="text-xs text-ink-700 break-all flex-1 font-mono leading-relaxed">{{ a.account_json.access_token }}</code>
              <button class="text-xs text-brand-600 hover:underline shrink-0 mt-1" @click="copy(a.account_json!.access_token as string, 'Token 已复制')">复制</button>
            </div>
          </li>
        </ul>
      </div>

      <!-- 接验证码 -->
      <div v-if="primaryEmail && order.status === 'DELIVERED'" class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
        <h3 class="font-medium text-ink-800 mb-3">为该账号接验证码</h3>
        <EmailCodeBox :model-value="primaryEmail" :editable="false" compact />
      </div>

      <div class="mt-6 text-center">
        <button class="px-4 py-2 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50" @click="router.push('/')">
          继续逛逛
        </button>
      </div>
    </template>
  </section>
</template>
