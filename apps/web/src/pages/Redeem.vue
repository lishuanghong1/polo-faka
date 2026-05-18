<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '@/api';
import { formatCardKeyContent, formatCardKeysForCopy } from '@/utils/card-key';

const router = useRouter();
const route = useRoute();

const code = ref<string>((route.query.code as string) || '');
const contact = ref('');
const loading = ref(false);
const checking = ref(false);
const info = ref<any>(null);
const result = ref<any>(null);

async function checkInfo() {
  if (!code.value.trim()) return;
  checking.value = true;
  info.value = null;
  try {
    info.value = await api.redeem.info(code.value.trim());
  } catch (e: any) {
    info.value = null;
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '兑换码不存在');
  } finally {
    checking.value = false;
  }
}

async function doRedeem() {
  if (!code.value.trim()) {
    ElMessage.warning('请填写兑换码');
    return;
  }
  loading.value = true;
  try {
    const order = await api.redeem.use({
      code: code.value.trim(),
      contact: contact.value?.trim() || undefined,
    });
    result.value = order;
    ElMessage.success('兑换成功');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '兑换失败');
  } finally {
    loading.value = false;
  }
}

function copyAll() {
  if (!result.value) return;
  const text = formatCardKeysForCopy(result.value.cardKeys || []);
  navigator.clipboard.writeText(text);
  ElMessage.success('已复制全部卡密');
}

function goOrder() {
  if (!result.value) return;
  router.push(`/order/${result.value.orderNo}`);
}

const statusLabels: Record<string, string> = {
  ACTIVE: '可用',
  DISABLED: '已禁用',
  EXHAUSTED: '已用完',
  EXPIRED: '已过期',
};
</script>

<template>
  <div class="max-w-2xl mx-auto py-10 px-4">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-semibold text-ink-900">兑换码</h1>
      <p class="text-sm text-ink-500 mt-2">输入您的兑换码，立即获取对应商品</p>
    </div>

    <!-- 已成功 -->
    <div v-if="result" class="card p-6">
      <div class="flex items-center gap-2 text-emerald-600 mb-4">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="text-lg font-semibold">兑换成功</span>
      </div>

      <div class="space-y-2 text-sm mb-4">
        <div class="flex justify-between text-ink-500">
          <span>订单号</span>
          <span class="font-mono text-ink-800">{{ result.orderNo }}</span>
        </div>
        <div class="flex justify-between text-ink-500">
          <span>商品</span>
          <span class="text-ink-800">{{ result.productTitle }}</span>
        </div>
        <div class="flex justify-between text-ink-500">
          <span>规格</span>
          <span class="text-ink-800">{{ result.skuName }} × {{ result.quantity }}</span>
        </div>
      </div>

      <div v-if="result.cardKeys?.length" class="border-t border-ink-100 pt-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-ink-800">卡密内容</div>
          <button class="text-xs text-brand-600 hover:underline" @click="copyAll">复制全部</button>
        </div>
        <div class="space-y-2">
          <div
            v-for="c in result.cardKeys"
            :key="c.id"
            class="font-mono text-sm bg-ink-50 border border-ink-200 rounded-lg p-3 break-all whitespace-pre-wrap"
          >
            {{ formatCardKeyContent(c.content) }}
          </div>
        </div>
      </div>
      <div v-else class="border-t border-ink-100 pt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        ⚠️ 该商品暂时没有可用卡密，已为您创建订单。客服处理后会自动发货，您可凭订单号查询。
      </div>

      <div class="mt-5 flex gap-2">
        <button class="flex-1 py-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="result = null; info = null; code = ''; contact = ''">
          再兑一个
        </button>
        <button class="flex-1 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm" @click="goOrder">
          查看订单
        </button>
      </div>
    </div>

    <!-- 表单 -->
    <div v-else class="card p-6 space-y-4">
      <div>
        <label class="text-sm font-medium text-ink-700 block mb-1">兑换码</label>
        <div class="flex gap-2">
          <input
            v-model="code"
            placeholder="请输入兑换码，如 RD-XXXX-XXXX"
            class="flex-1 px-4 py-2.5 border border-ink-200 rounded-lg text-sm font-mono uppercase focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
            @blur="checkInfo"
            @keydown.enter="doRedeem"
          />
          <button
            class="px-4 py-2.5 border border-ink-200 hover:bg-ink-50 rounded-lg text-sm"
            :disabled="checking || !code.trim()"
            @click="checkInfo"
          >
            {{ checking ? '查询中…' : '查询' }}
          </button>
        </div>
      </div>

      <!-- 码信息 -->
      <div v-if="info" class="bg-ink-50 border border-ink-200 rounded-lg p-4 space-y-2 text-sm">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs px-2 py-0.5 rounded border"
            :class="info.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-ink-100 text-ink-500 border-ink-200'"
          >
            {{ statusLabels[info.status] || info.status }}
          </span>
          <span class="text-ink-700 font-medium">{{ info.productTitle }}</span>
        </div>
        <div class="text-ink-600 text-xs">
          规格：<span class="text-ink-800">{{ info.skuName }}</span>
          · 每次兑换：<span class="text-ink-800">{{ info.qtyPerUse }} 件</span>
          · 剩余次数：<span class="text-ink-800">{{ info.remaining }} / {{ info.maxUses }}</span>
          <span v-if="info.expireAt"> · 过期：{{ new Date(info.expireAt).toLocaleString() }}</span>
        </div>
      </div>

      <div>
        <label class="text-sm font-medium text-ink-700 block mb-1">联系方式（可选）</label>
        <input
          v-model="contact"
          placeholder="QQ / 邮箱 / 手机，便于客服联系"
          class="w-full px-4 py-2.5 border border-ink-200 rounded-lg text-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
        />
      </div>

      <button
        class="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium shadow-sm disabled:opacity-50"
        :disabled="loading || !code.trim() || (info && info.status !== 'ACTIVE')"
        @click="doRedeem"
      >
        {{ loading ? '兑换中…' : '立即兑换' }}
      </button>

      <div class="text-xs text-ink-400 text-center">
        兑换成功后会立即生成订单并自动发货，建议截图保存兑换结果。
      </div>
    </div>
  </div>
</template>
