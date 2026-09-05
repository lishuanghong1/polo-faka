<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import BrandButton from '@/components/BrandButton.vue';

type ExtractCard = { id: number; code: string; masked: string; totalCredits: number; remainingCredits: number; [k: string]: unknown };

const cards = ref<ExtractCard[]>([]);
const upstreamOrders = ref<any[]>([]);
const loading = ref(false);
const loadingOrders = ref(false);
const revealed = ref<Set<number>>(new Set());
const loaded = ref(false);

async function load() {
  loading.value = true;
  try {
    cards.value = await api.admin.cursorSell.extractCards();
    loaded.value = true;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadOrders() {
  loadingOrders.value = true;
  try {
    upstreamOrders.value = await api.admin.cursorSell.upstreamOrders();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '加载失败');
  } finally {
    loadingOrders.value = false;
  }
}

function toggle(id: number) {
  const s = new Set(revealed.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  revealed.value = s;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

function fmt(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

defineExpose({ load });
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-sm font-medium text-ink-900">我的提取卡密（XB-）</div>
          <p class="text-[11px] text-ink-400 mt-0.5">上游「次数票」商品成交后得到的完整卡密，终端用户到上游 /redeem 页面提取账号。仅管理员可见。</p>
        </div>
        <BrandButton variant="secondary" size="sm" :loading="loading" @click="load">{{ loaded ? '刷新' : '加载' }}</BrandButton>
      </div>
      <div class="rounded-xl border border-ink-100 bg-white overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-ink-50 text-ink-600">
            <tr>
              <th class="px-4 py-2 text-left">ID</th>
              <th class="px-4 py-2 text-left">卡密</th>
              <th class="px-4 py-2 text-right">剩余 / 总次数</th>
              <th class="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="c in cards" :key="c.id">
              <td class="px-4 py-2 text-ink-400 font-mono text-xs">#{{ c.id }}</td>
              <td class="px-4 py-2 font-mono text-xs text-ink-900">{{ revealed.has(c.id) ? c.code : c.masked }}</td>
              <td class="px-4 py-2 text-right" :class="c.remainingCredits === 0 ? 'text-ink-400' : 'text-ink-900'">{{ c.remainingCredits }} / {{ c.totalCredits }}</td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <button class="text-xs text-ink-500 hover:text-ink-800 mr-3" @click="toggle(c.id)">{{ revealed.has(c.id) ? '隐藏' : '显示' }}</button>
                <button class="text-xs text-brand-600 hover:underline" @click="copy(c.code)">复制</button>
              </td>
            </tr>
            <tr v-if="!cards.length && !loading">
              <td colspan="4" class="px-4 py-8 text-center text-ink-400">{{ loaded ? '暂无提取卡密' : '点击右上角加载' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-sm font-medium text-ink-900">上游订单摘要（对账）</div>
          <p class="text-[11px] text-ink-400 mt-0.5">上游记录的本账号全部成交（不含凭据明文），用于和本站采购单核对。</p>
        </div>
        <BrandButton variant="secondary" size="sm" :loading="loadingOrders" @click="loadOrders">加载</BrandButton>
      </div>
      <div v-if="upstreamOrders.length" class="rounded-xl border border-ink-100 bg-white overflow-hidden overflow-x-auto">
        <table class="w-full text-sm min-w-[700px]">
          <thead class="bg-ink-50 text-ink-600">
            <tr>
              <th class="px-4 py-2 text-left">渠道单</th>
              <th class="px-4 py-2 text-left">商品</th>
              <th class="px-4 py-2 text-left">档位</th>
              <th class="px-4 py-2 text-left">成交时间</th>
              <th class="px-4 py-2 text-left">质保至</th>
              <th class="px-4 py-2 text-left">其它</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-for="(o, i) in upstreamOrders" :key="o.saleId ?? o.id ?? i">
              <td class="px-4 py-2 font-mono text-xs text-ink-700">#{{ o.saleId ?? o.id ?? '—' }}</td>
              <td class="px-4 py-2 text-xs text-ink-900">{{ o.productCode || o.title || '—' }}</td>
              <td class="px-4 py-2 text-xs text-ink-600 uppercase">{{ o.tier || '—' }}</td>
              <td class="px-4 py-2 text-xs text-ink-600">{{ fmt(o.soldAt) }}</td>
              <td class="px-4 py-2 text-xs text-ink-600">{{ fmt(o.warrantyUntil) }}</td>
              <td class="px-4 py-2 text-[11px] text-ink-400 font-mono max-w-[260px] truncate" :title="JSON.stringify(o)">
                {{ o.email || o.masked || o.kind || '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!loadingOrders" class="text-xs text-ink-400">尚未加载</div>
    </section>
  </div>
</template>
