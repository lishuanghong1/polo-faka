<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import EmailCodeBox from '@/components/EmailCodeBox.vue';

const route = useRoute();
const router = useRouter();

const order = ref<Awaited<ReturnType<typeof api.forge.orderDetail>> | null>(null);
const loading = ref(true);
const errorMsg = ref('');

const primaryEmail = computed(() => {
  const first = order.value?.accounts?.[0];
  return first?.account_json?.email || first?.email || '';
});

function statusBadge(s: string) {
  return {
    PENDING: { text: '处理中', cls: 'bg-amber-100 text-amber-700' },
    DELIVERED: { text: '已发货', cls: 'bg-emerald-100 text-emerald-700' },
    FAILED: { text: '失败', cls: 'bg-rose-100 text-rose-700' },
  }[s] || { text: s, cls: 'bg-gray-100 text-gray-600' };
}

async function load() {
  try {
    order.value = await api.forge.orderDetail(route.params.orderNo as string);
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error?.message || e?.message || '订单不存在';
  } finally {
    loading.value = false;
  }
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

onMounted(load);
</script>

<template>
  <section class="max-w-3xl mx-auto px-4 py-8">
    <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>

    <div v-else-if="errorMsg" class="card p-10 text-center">
      <div class="text-rose-600 text-sm">{{ errorMsg }}</div>
      <button
        class="mt-4 px-4 py-2 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50"
        @click="router.push('/forge-redeem')"
      >
        返回兑换页
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
          <div class="flex justify-between"><dt class="text-ink-500">订单号</dt><dd class="font-mono text-xs break-all ml-3">{{ order.orderNo }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-500">商品</dt><dd class="truncate ml-3">{{ order.typeName }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-500">数量</dt><dd>× {{ order.quantity }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-500">单价</dt><dd>¥{{ order.displayPrice.toFixed(2) }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-500">合计</dt><dd class="font-semibold text-rose-600">¥{{ order.totalAmount.toFixed(2) }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-500">下单时间</dt><dd>{{ new Date(order.createdAt).toLocaleString() }}</dd></div>
          <div v-if="order.deliveredAt" class="flex justify-between">
            <dt class="text-ink-500">发货时间</dt>
            <dd>{{ new Date(order.deliveredAt).toLocaleString() }}</dd>
          </div>
          <div v-if="order.upstreamOrderNo" class="flex justify-between">
            <dt class="text-ink-500">上游单号</dt>
            <dd class="font-mono text-xs ml-3">{{ order.upstreamOrderNo }}</dd>
          </div>
        </dl>

        <div v-if="order.status === 'FAILED' && order.failReason" class="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
          {{ order.failReason }}
        </div>
      </div>

      <!-- 账号列表 -->
      <div v-if="order.accounts?.length" class="card p-6 mt-5 bg-white border border-ink-100 rounded-2xl">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-medium text-ink-800">账号交付</h3>
          <button class="text-sm text-brand-600 hover:underline" @click="copyAll">一键复制全部</button>
        </div>

        <ul class="space-y-3">
          <li
            v-for="(a, i) in order.accounts"
            :key="i"
            class="p-4 bg-ink-50/60 rounded-lg space-y-2"
          >
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
        <button
          class="px-4 py-2 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50"
          @click="router.push('/forge-redeem')"
        >
          继续用兑换码下单
        </button>
      </div>
    </template>
  </section>
</template>
