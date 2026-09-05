<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api, { type CursorSellProduct } from '@/api';
import BrandButton from '@/components/BrandButton.vue';

const emit = defineEmits<{ (e: 'synced'): void }>();

const list = ref<CursorSellProduct[]>([]);
const loading = ref(false);
const syncing = ref(false);
const showInactive = ref(false);
const keyword = ref('');

const modeLabel: Record<string, { text: string; cls: string; hint: string }> = {
  account: { text: '凭据直发', cls: 'bg-emerald-50 text-emerald-700', hint: '成交即返回邮箱 / 密码 / Token' },
  login: { text: '授权登录', cls: 'bg-sky-50 text-sky-700', hint: '不返回 Token，买家在订单页粘贴登录链接完成授权' },
  card: { text: '池卡密', cls: 'bg-violet-50 text-violet-700', hint: '成交返回卡密 + 说明' },
  extract: { text: '次数票', cls: 'bg-amber-50 text-amber-700', hint: '只卖 XB- 提取卡，买家到上游 /redeem 提取' },
};

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return list.value.filter((p) => {
    if (!showInactive.value && !p.active) return false;
    if (!k) return true;
    return p.code.toLowerCase().includes(k) || p.title.toLowerCase().includes(k) || p.tier.toLowerCase().includes(k);
  });
});

async function load() {
  loading.value = true;
  try {
    list.value = await api.admin.cursorSell.products(false);
  } finally {
    loading.value = false;
  }
}

async function sync() {
  syncing.value = true;
  try {
    const r = await api.admin.cursorSell.syncProducts();
    ElMessage.success(`同步完成：更新 ${r.upserted} 个，下架 ${r.deactivated} 个`);
    await load();
    emit('synced');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

onMounted(load);
defineExpose({ load });
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-3 flex-wrap">
      <input
        v-model="keyword"
        placeholder="搜 code / 名称 / 档位"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-56"
      />
      <label class="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
        <input v-model="showInactive" type="checkbox" />
        显示已下架
      </label>
      <span class="text-xs text-ink-400">共 {{ filtered.length }} 个</span>
      <div class="ml-auto flex items-center gap-2">
        <BrandButton variant="secondary" size="sm" :disabled="loading" @click="load">刷新</BrandButton>
        <BrandButton variant="primary" size="sm" :loading="syncing" @click="sync">从上游同步</BrandButton>
      </div>
    </div>

    <div class="rounded-xl border border-ink-100 bg-white overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[900px]">
        <thead class="bg-ink-50 text-ink-600">
          <tr>
            <th class="px-4 py-2 text-left">商品 code</th>
            <th class="px-4 py-2 text-left">名称</th>
            <th class="px-4 py-2 text-left">档位</th>
            <th class="px-4 py-2 text-right">成本价</th>
            <th class="px-4 py-2 text-right">预估库存</th>
            <th class="px-4 py-2 text-left">交付方式</th>
            <th class="px-4 py-2 text-left">质保</th>
            <th class="px-4 py-2 text-left">状态</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="p in filtered" :key="p.code" :class="!p.active ? 'opacity-50' : ''">
            <td class="px-4 py-2">
              <button class="font-mono text-xs text-brand-700 hover:underline" @click="copy(p.code)">{{ p.code }}</button>
            </td>
            <td class="px-4 py-2 text-ink-900">{{ p.title }}</td>
            <td class="px-4 py-2 text-ink-600 uppercase text-xs">{{ p.tier }}</td>
            <td class="px-4 py-2 text-right text-ink-900">¥{{ p.price.toFixed(2) }}</td>
            <td class="px-4 py-2 text-right" :class="p.stock <= 3 ? 'text-rose-600 font-medium' : 'text-ink-800'">{{ p.stock }}</td>
            <td class="px-4 py-2">
              <span
                class="inline-block px-2 py-0.5 text-[11px] rounded-md"
                :class="(modeLabel[p.deliveryMode] || modeLabel.account).cls"
                :title="(modeLabel[p.deliveryMode] || modeLabel.account).hint"
              >{{ (modeLabel[p.deliveryMode] || modeLabel.account).text }}</span>
              <span v-if="p.ondemandTeam" class="ml-1 inline-block px-2 py-0.5 text-[11px] rounded-md bg-rose-50 text-rose-700" title="成交后可能处于开通中，系统每分钟轮询直至就绪">现做</span>
              <div class="text-[11px] text-ink-400 mt-0.5 font-mono">{{ p.deliveryFields.join(', ') || '—' }}</div>
            </td>
            <td class="px-4 py-2 text-xs text-ink-600">{{ p.warrantyHours ? `${p.warrantyHours}h` : '—' }}</td>
            <td class="px-4 py-2">
              <span
                class="inline-block px-2 py-0.5 text-[11px] rounded-md"
                :class="p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'"
              >{{ p.active ? '在售' : '已下架' }}</span>
            </td>
          </tr>
          <tr v-if="!filtered.length && !loading">
            <td colspan="8" class="px-4 py-10 text-center text-ink-400">
              暂无商品缓存，点右上角「从上游同步」拉取（需已配置 API Key）
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-ink-400 leading-relaxed">
      库存为上游静态估算，成交时会实时验档，偶发无货属正常；后台每 10 分钟自动同步一次。本站商品编辑里选「Team 售号渠道」交付类型后，规格从这里的商品中选择绑定。
    </p>
  </div>
</template>
