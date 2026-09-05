<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { type CursorSellProduct, type CursorSellPurchase, type CursorSellSale } from '@/api';
import BrandButton from '@/components/BrandButton.vue';
import CursorSellSaleCard from './CursorSellSaleCard.vue';

const props = defineProps<{
  products: CursorSellProduct[];
  skuOptions: Array<{ id: number; label: string }>;
}>();
const emit = defineEmits<{ (e: 'purchased'): void }>();

const form = ref({
  code: '',
  qty: 1,
  extractSplit: false,
  destination: 'NONE' as 'NONE' | 'CARD_POOL' | 'WAREHOUSE',
  skuId: null as number | null,
});
const submitting = ref(false);
const result = ref<(CursorSellPurchase & { sales: CursorSellSale[] }) | null>(null);

const activeProducts = computed(() => props.products.filter((p) => p.active));
const selected = computed(() => props.products.find((p) => p.code === form.value.code) || null);
const maxQty = computed(() => (selected.value?.ondemandTeam ? 5 : 50));
const estimatedCost = computed(() => (selected.value ? (selected.value.priceCents * form.value.qty) / 100 : 0));

async function submit() {
  if (!selected.value) return ElMessage.warning('请选择渠道商品');
  const qty = Math.max(1, Math.min(maxQty.value, Math.floor(form.value.qty || 1)));
  if (form.value.destination === 'CARD_POOL' && !form.value.skuId) return ElMessage.warning('入卡密池需要选择本站规格');
  await ElMessageBox.confirm(
    `确认向上游采购「${selected.value.title}」× ${qty}，预计扣渠道余额 ¥${estimatedCost.value.toFixed(2)}？`,
    '采购确认',
    { type: 'warning', confirmButtonText: '确认采购' },
  );
  submitting.value = true;
  result.value = null;
  try {
    const r = await api.admin.cursorSell.manualPurchase({
      code: selected.value.code,
      qty,
      extractSplit: selected.value.extractOnly ? form.value.extractSplit : undefined,
      destination: form.value.destination,
      skuId: form.value.destination === 'CARD_POOL' ? form.value.skuId! : undefined,
    });
    result.value = r;
    if (r.status === 'DONE') ElMessage.success(`采购成功，成交 ${r.sales.length} 条`);
    else if (r.status === 'MAKING') ElMessage.warning('已下单，账号正在开通中，系统会每分钟检查');
    else ElMessage.error(r.failReason || '采购未成功，可到采购单里重试');
    emit('purchased');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '采购失败');
  } finally {
    submitting.value = false;
  }
}

function onSaleChanged(s: CursorSellSale) {
  if (!result.value) return;
  const idx = result.value.sales.findIndex((x) => x.id === s.id);
  if (idx >= 0) result.value.sales[idx] = s;
}
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-xl border border-ink-100 bg-white p-5 space-y-4">
      <div class="text-sm font-medium text-ink-900">手动采购</div>
      <div class="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-3">
        <div>
          <label class="text-xs text-ink-500 block mb-1">渠道商品</label>
          <select v-model="form.code" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white">
            <option value="" disabled>请选择（{{ activeProducts.length }} 个在售）</option>
            <option v-for="p in activeProducts" :key="p.code" :value="p.code">
              {{ p.title }} · {{ p.tier.toUpperCase() }} · ¥{{ p.price.toFixed(2) }} · 库存 {{ p.stock }}{{ p.ondemandTeam ? ' · 现做' : '' }}{{ p.extractOnly ? ' · 次数票' : '' }}
            </option>
          </select>
        </div>
        <div>
          <label class="text-xs text-ink-500 block mb-1">数量（≤ {{ maxQty }}）</label>
          <input v-model.number="form.qty" type="number" min="1" :max="maxQty" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
        </div>
      </div>

      <div v-if="selected" class="rounded-lg bg-ink-50 p-3 text-xs text-ink-600 space-y-1">
        <div>交付字段：<span class="font-mono">{{ selected.deliveryFields.join(', ') || '—' }}</span> · 质保 {{ selected.warrantyHours ? selected.warrantyHours + 'h' : '—' }}</div>
        <div v-if="selected.deliveryMode === 'login'" class="text-sky-700">授权登录发货：上游不返回 Token，账号要靠用户在订单页粘贴登录链接完成授权，不适合入卡密池匿名售卖。</div>
        <div v-if="selected.ondemandTeam" class="text-rose-700">现做 Team：成交后可能处于「开通中」，系统每分钟轮询，就绪后再入库。</div>
        <div v-if="selected.extractOnly" class="flex items-center gap-2">
          <label class="flex items-center gap-1.5 cursor-pointer"><input v-model="form.extractSplit" type="checkbox" /> 拆成 {{ form.qty }} 张各 1 次的提取卡</label>
          <span class="text-ink-400">（不勾则为 1 张 {{ form.qty }} 次）</span>
        </div>
        <div class="text-ink-800">预计成本：<b>¥{{ estimatedCost.toFixed(2) }}</b></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-ink-500 block mb-1">成交后处理</label>
          <select v-model="form.destination" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white">
            <option value="NONE">仅记录在采购单（稍后再入库）</option>
            <option value="CARD_POOL">直接写入本站规格的卡密池（可售）</option>
            <option value="WAREHOUSE">推入仓库（待分配）</option>
          </select>
        </div>
        <div v-if="form.destination === 'CARD_POOL'">
          <label class="text-xs text-ink-500 block mb-1">入库到规格</label>
          <select v-model="form.skuId" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white">
            <option :value="null" disabled>请选择</option>
            <option v-for="s in skuOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3 flex-wrap">
        <p class="text-[11px] text-ink-400">每次采购生成独立幂等键；若网络超时可在「采购单」里同键重试，不会重复扣费。</p>
        <BrandButton variant="primary" size="md" :loading="submitting" :disabled="!selected" @click="submit">立即采购</BrandButton>
      </div>
    </div>

    <div v-if="result" class="space-y-3">
      <div class="text-sm font-medium text-ink-900">
        本次结果 · 采购单 #{{ result.id }} ·
        <span :class="result.status === 'DONE' ? 'text-emerald-700' : result.status === 'MAKING' ? 'text-sky-700' : 'text-rose-700'">{{ result.status }}</span>
      </div>
      <div v-if="result.failReason" class="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">{{ result.failReason }}</div>
      <CursorSellSaleCard
        v-for="s in result.sales"
        :key="s.id"
        :sale="s"
        :sku-options="skuOptions"
        @changed="onSaleChanged"
      />
    </div>
  </div>
</template>
