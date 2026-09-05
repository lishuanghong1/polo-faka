<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api, { type CursorSellProduct } from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import BrandButton from '@/components/BrandButton.vue';
import CursorSellProducts from '@/components/admin/cursor-sell/CursorSellProducts.vue';
import CursorSellPurchases from '@/components/admin/cursor-sell/CursorSellPurchases.vue';
import CursorSellManualBuy from '@/components/admin/cursor-sell/CursorSellManualBuy.vue';
import CursorSellExtractCards from '@/components/admin/cursor-sell/CursorSellExtractCards.vue';

type Tab = 'overview' | 'products' | 'purchases' | 'manual' | 'extract';
type Overview = Awaited<ReturnType<typeof api.admin.cursorSell.overview>>;

const router = useRouter();
const tab = ref<Tab>('overview');
const overview = ref<Overview | null>(null);
const overviewLoading = ref(false);
const products = ref<CursorSellProduct[]>([]);
const skuOptions = ref<Array<{ id: number; label: string }>>([]);

const redeemCode = ref('');
const redeeming = ref(false);

const purchasesRef = ref<InstanceType<typeof CursorSellPurchases> | null>(null);

const tabs: Array<{ k: Tab; l: string }> = [
  { k: 'overview', l: '概览 & 充值' },
  { k: 'products', l: '渠道商品' },
  { k: 'purchases', l: '采购单' },
  { k: 'manual', l: '手动采购' },
  { k: 'extract', l: '提取卡密 / 对账' },
];

const balanceTone = computed(() => {
  if (!overview.value || overview.value.balanceCents == null) return 'text-ink-400';
  if (overview.value.lowBalanceCents && overview.value.balanceCents < overview.value.lowBalanceCents) return 'text-rose-600';
  return 'text-ink-900';
});

async function loadOverview() {
  overviewLoading.value = true;
  try {
    overview.value = await api.admin.cursorSell.overview();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '加载概览失败');
  } finally {
    overviewLoading.value = false;
  }
}

async function loadProducts() {
  try {
    products.value = await api.admin.cursorSell.products(false);
  } catch {
    products.value = [];
  }
}

/** 本站规格（用于把采购结果入卡密池）：只列 CARD_KEY 交付类型的商品 */
async function loadSkuOptions() {
  try {
    const r = await api.admin.productsListAll({});
    const opts: Array<{ id: number; label: string }> = [];
    for (const p of r.items || []) {
      if (p.deliveryType !== 'CARD_KEY') continue;
      for (const s of p.skus || []) opts.push({ id: s.id, label: `${p.title} / ${s.name}` });
    }
    skuOptions.value = opts;
  } catch {
    skuOptions.value = [];
  }
}

async function redeem() {
  const code = redeemCode.value.trim();
  if (!code) return ElMessage.warning('请填写充值卡码');
  redeeming.value = true;
  try {
    const r = await api.admin.cursorSell.walletRedeem(code);
    ElMessage.success(`充值成功：到账 ¥${r.amount.toFixed(2)}，当前余额 ¥${r.balance.toFixed(2)}`);
    redeemCode.value = '';
    await loadOverview();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '兑换失败');
  } finally {
    redeeming.value = false;
  }
}

function yuan(cents: number | null | undefined) {
  return cents == null ? '—' : `¥${(cents / 100).toFixed(2)}`;
}

function fmt(t: string | null | undefined) {
  return t ? new Date(t).toLocaleString() : '从未';
}

function switchTab(k: Tab) {
  tab.value = k;
  if (k === 'overview') loadOverview();
  if (k === 'manual') loadProducts();
  if (k === 'purchases') purchasesRef.value?.load();
}

onMounted(async () => {
  await Promise.all([loadOverview(), loadProducts(), loadSkuOptions()]);
});
</script>

<template>
  <AdminPageHeader title="Team 渠道" subtitle="上游成品号 API：钱包 · 商品 · 采购 · 授权登录">
    <template #actions>
      <BrandButton variant="secondary" size="sm" @click="router.push('/admin/settings')">渠道配置</BrandButton>
    </template>
  </AdminPageHeader>

  <div class="flex gap-1 mb-5 p-1 bg-ink-50 rounded-lg w-fit flex-wrap">
    <button
      v-for="t in tabs"
      :key="t.k"
      class="px-4 py-1.5 text-sm rounded-md transition"
      :class="tab === t.k ? 'bg-white text-ink-900 font-medium shadow-sm' : 'text-ink-500 hover:text-ink-700'"
      @click="switchTab(t.k)"
    >{{ t.l }}</button>
  </div>

  <!-- 未启用提示 -->
  <div v-if="overview && !overview.enabled" class="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
    渠道尚未启用。请到「站点设置 → Team 兑换」打开开关并填写 API Key 后再使用。
    <button class="ml-2 text-brand-700 hover:underline" @click="router.push('/admin/settings')">去设置</button>
  </div>
  <div v-else-if="overview && !overview.hasApiKey" class="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
    渠道已启用但未配置 API Key：除「兑换充值卡」外的接口（查余额 / 同步商品 / 买号）都需要 Key。
    <button class="ml-2 text-brand-700 hover:underline" @click="router.push('/admin/settings')">去配置</button>
  </div>

  <!-- 概览 -->
  <div v-show="tab === 'overview'" class="space-y-4">
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="rounded-xl border border-ink-100 bg-white p-4">
        <div class="text-xs text-ink-500">售号钱包余额</div>
        <div class="mt-1 text-2xl font-bold" :class="balanceTone">{{ yuan(overview?.balanceCents) }}</div>
        <div class="text-[11px] text-ink-400 mt-1">
          <span v-if="overview?.walletError" class="text-rose-600">{{ overview.walletError }}</span>
          <span v-else-if="overview?.lowBalanceCents">低于 {{ yuan(overview.lowBalanceCents) }} 企微提醒</span>
          <span v-else>未设置低余额提醒</span>
        </div>
      </div>
      <div class="rounded-xl border border-ink-100 bg-white p-4">
        <div class="text-xs text-ink-500">今日采购</div>
        <div class="mt-1 text-2xl font-bold text-ink-900">{{ overview?.todayPurchases ?? '—' }}<span class="text-sm font-normal text-ink-400 ml-1">单</span></div>
        <div class="text-[11px] text-ink-400 mt-1">成本 {{ yuan(overview?.todayCostCents) }}</div>
      </div>
      <div class="rounded-xl border border-ink-100 bg-white p-4">
        <div class="text-xs text-ink-500">待处理</div>
        <div class="mt-1 text-2xl font-bold" :class="(overview?.failed || 0) > 0 ? 'text-rose-600' : 'text-ink-900'">
          {{ (overview?.pending ?? 0) + (overview?.failed ?? 0) }}
        </div>
        <div class="text-[11px] text-ink-400 mt-1">待重试 {{ overview?.pending ?? 0 }} · 失败 {{ overview?.failed ?? 0 }} · 开通中 {{ overview?.making ?? 0 }}</div>
      </div>
      <div class="rounded-xl border border-ink-100 bg-white p-4">
        <div class="text-xs text-ink-500">渠道商品</div>
        <div class="mt-1 text-2xl font-bold text-ink-900">{{ overview?.activeProductCount ?? '—' }}<span class="text-sm font-normal text-ink-400 ml-1">在售</span></div>
        <div class="text-[11px] text-ink-400 mt-1">上次同步 {{ fmt(overview?.lastSyncAt) }}</div>
      </div>
    </div>

    <div class="rounded-xl border border-ink-100 bg-white p-5">
      <div class="text-sm font-medium text-ink-900 mb-1">兑换充值卡到售号钱包</div>
      <p class="text-[11px] text-ink-400 mb-3">上游发的 SC- 充值卡；兑换后余额用于自动采购发货。该操作会写审计日志。</p>
      <div class="flex gap-2 flex-wrap">
        <input
          v-model="redeemCode"
          placeholder="SC-XXXX-XXXX-XXXX"
          class="flex-1 min-w-[240px] px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono uppercase"
          @keydown.enter="redeem"
        />
        <BrandButton variant="primary" size="md" :loading="redeeming" :disabled="!redeemCode.trim()" @click="redeem">兑换充值</BrandButton>
        <BrandButton variant="secondary" size="md" :loading="overviewLoading" @click="loadOverview">刷新余额</BrandButton>
      </div>
    </div>

    <div class="rounded-xl border border-ink-100 bg-white p-5 text-xs text-ink-600 space-y-2 leading-relaxed">
      <div class="text-sm font-medium text-ink-900">使用流程</div>
      <ol class="list-decimal pl-5 space-y-1">
        <li>「渠道商品」页同步上游商品（每 10 分钟也会自动同步）。</li>
        <li>后台「商品」里新建/编辑商品，交付类型选 <b>Team 售号渠道</b>，每个规格绑定一个渠道商品并定本站售价。</li>
        <li>用户下单付款（支付宝 / 余额 / 积分 / 兑换码）后，系统自动向上游采购并把账号发到订单页；现做 Team 会先显示「开通中」，就绪后自动补全；授权登录类账号由用户在订单页粘贴登录链接完成授权。</li>
        <li>失败（余额不足 / 无货）时订单停在「已支付」，企微会提醒；充值或等库存后到「采购单」重试，或在订单里点「补发」。</li>
        <li>也可在「手动采购」批量买号，直接写入本站卡密池或仓库。</li>
      </ol>
    </div>
  </div>

  <div v-show="tab === 'products'">
    <CursorSellProducts @synced="loadOverview(); loadProducts()" />
  </div>

  <div v-show="tab === 'purchases'">
    <CursorSellPurchases ref="purchasesRef" :sku-options="skuOptions" />
  </div>

  <div v-show="tab === 'manual'">
    <CursorSellManualBuy :products="products" :sku-options="skuOptions" @purchased="loadOverview(); purchasesRef?.load()" />
  </div>

  <div v-show="tab === 'extract'">
    <CursorSellExtractCards />
  </div>
</template>
