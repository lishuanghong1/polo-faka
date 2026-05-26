<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

const loading = ref(false);
const syncing = ref(false);
const items = ref<any[]>([]);
const editing = ref<Record<string, { displayPrice: string; sort: number }>>({});

async function load() {
  loading.value = true;
  try {
    items.value = await api.forge.admin.listProducts();
    for (const it of items.value) {
      editing.value[it.typeKey] = {
        displayPrice: String(it.displayPrice),
        sort: it.sort,
      };
    }
  } finally {
    loading.value = false;
  }
}

async function syncFromUpstream() {
  syncing.value = true;
  try {
    const r = await api.forge.admin.syncProducts();
    ElMessage.success(`已同步 ${r.upserted} 款商品`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function toggleEnabled(item: any) {
  try {
    await api.forge.admin.updateProduct(item.typeKey, { enabled: !item.enabled });
    item.enabled = !item.enabled;
    ElMessage.success(item.enabled ? '已上架' : '已下架');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function savePrice(item: any) {
  const v = Number(editing.value[item.typeKey].displayPrice);
  if (!Number.isFinite(v) || v < 0) {
    ElMessage.warning('售价必须为非负数字');
    return;
  }
  try {
    await api.forge.admin.updateProduct(item.typeKey, { displayPrice: v });
    item.displayPrice = v;
    ElMessage.success('已保存');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function saveSort(item: any) {
  const v = Number(editing.value[item.typeKey].sort);
  if (!Number.isInteger(v)) return;
  try {
    await api.forge.admin.updateProduct(item.typeKey, { sort: v });
    item.sort = v;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="Cursorforge 商品" subtitle="从三方同步商品 → 设售价 → 上架到兑换码下单页">
    <template #actions>
      <button
        class="px-3.5 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm disabled:opacity-50"
        :disabled="syncing"
        @click="syncFromUpstream"
      >
        {{ syncing ? '同步中…' : '从三方同步商品' }}
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 bg-sky-50/40 border border-sky-200 text-xs text-sky-900 mb-4 leading-relaxed">
    <p>· 首次使用：先确认「站点设置 → 接码接口」已填好 agent_key / agent_secret，再点右上角「从三方同步商品」。</p>
    <p>· 同步会拉取所有对代理 OpenAPI 开放出货的商品，本地默认<b>不上架</b>，需要在此页勾上「上架」才会出现在用户兑换页。</p>
    <p>· <b>售价 displayPrice</b>：用户用兑换码下单时按此扣余额（CNY）；agent_price 是我方调三方的成本。建议 displayPrice ≥ agent_price 才有利润。</p>
  </div>

  <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>
  <div v-else-if="!items.length" class="card p-10 text-center text-ink-400 text-sm">
    暂无商品。请先点击右上角「从三方同步商品」。
  </div>

  <div v-else class="card p-0 overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-ink-50 text-ink-600">
        <tr>
          <th class="px-4 py-2.5 text-left font-medium">商品</th>
          <th class="px-4 py-2.5 text-right font-medium">三方代理价 (¥)</th>
          <th class="px-4 py-2.5 text-right font-medium">售价 (¥)</th>
          <th class="px-4 py-2.5 text-center font-medium">库存</th>
          <th class="px-4 py-2.5 text-center font-medium">接码</th>
          <th class="px-4 py-2.5 text-center font-medium">排序</th>
          <th class="px-4 py-2.5 text-center font-medium">上架</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in items"
          :key="it.typeKey"
          class="border-t border-ink-100"
        >
          <td class="px-4 py-3">
            <div class="font-medium text-ink-900">{{ it.typeName }}</div>
            <div class="text-xs text-ink-500 mt-0.5">
              <span class="font-mono">{{ it.typeKey }}</span> · {{ it.categoryName }}
              <span v-if="it.warrantyHours"> · 质保 {{ it.warrantyHours }}h</span>
            </div>
          </td>
          <td class="px-4 py-3 text-right font-mono text-ink-700">{{ Number(it.agentPrice).toFixed(2) }}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-1 justify-end">
              <input
                v-model="editing[it.typeKey].displayPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-20 px-2 py-1 border border-ink-200 rounded text-right text-sm"
                @blur="savePrice(it)"
              />
            </div>
          </td>
          <td class="px-4 py-3 text-center">
            <span :class="it.stock <= 5 ? 'text-rose-600 font-medium' : 'text-ink-600'">
              {{ it.stock }}
            </span>
          </td>
          <td class="px-4 py-3 text-center">
            <span v-if="it.emailCodeEnabled" class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">支持</span>
            <span v-else class="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">不支持</span>
          </td>
          <td class="px-4 py-3 text-center">
            <input
              v-model="editing[it.typeKey].sort"
              type="number"
              class="w-14 px-2 py-1 border border-ink-200 rounded text-center text-sm"
              @blur="saveSort(it)"
            />
          </td>
          <td class="px-4 py-3 text-center">
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                :checked="it.enabled"
                @change="toggleEnabled(it)"
              />
            </label>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
