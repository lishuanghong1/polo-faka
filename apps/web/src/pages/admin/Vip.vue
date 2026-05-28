<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import BrandButton from '@/components/BrandButton.vue';

interface ConfigRow {
  tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
  name: string;
  threshold: number;
  defaultDiscount: number;
  color: string | null;
  icon: string | null;
  benefits: string[];
}

const loading = ref(false);
const saving = ref<Record<string, boolean>>({});
const items = ref<ConfigRow[]>([]);

const TIER_ORDER = ['GOLD', 'DIAMOND', 'SUPREME'] as const;

async function refresh() {
  loading.value = true;
  try {
    const list = await api.vip.configs();
    items.value = TIER_ORDER.map((t) => {
      const found = list.find((x) => x.tier === t);
      return {
        tier: t,
        name: found?.name ?? '',
        threshold: found?.threshold ?? 0,
        defaultDiscount: found?.defaultDiscount ?? 1,
        color: found?.color ?? '',
        icon: found?.icon ?? '',
        benefits: found?.benefits ?? [],
      };
    });
  } finally {
    loading.value = false;
  }
}

async function save(row: ConfigRow) {
  // 客户端预校验
  if (!row.name.trim()) {
    ElMessage.warning('名称不能为空');
    return;
  }
  if (row.threshold < 0) {
    ElMessage.warning('阈值不能为负');
    return;
  }
  if (row.defaultDiscount < 0.5 || row.defaultDiscount > 1) {
    ElMessage.warning('折扣需在 0.5（五折） ~ 1（不折扣）之间');
    return;
  }
  saving.value[row.tier] = true;
  try {
    await api.vip.adminUpdateConfig(row.tier, {
      name: row.name,
      threshold: Number(row.threshold),
      defaultDiscount: Number(row.defaultDiscount),
      color: row.color || undefined,
      icon: row.icon || undefined,
      benefits: row.benefits,
    });
    ElMessage.success('已保存');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败');
  } finally {
    saving.value[row.tier] = false;
  }
}

function addBenefit(row: ConfigRow) {
  row.benefits.push('');
}
function removeBenefit(row: ConfigRow, idx: number) {
  row.benefits.splice(idx, 1);
}

const discountTip = computed(
  () => '示例：0.95 = 95 折（让 5%），0.90 = 9 折（让 10%）。范围 0.5 ~ 1，低于 0.5 拒绝（防呆）',
);

onMounted(refresh);
</script>

<template>
  <div>
    <AdminPageHeader
      title="VIP 等级管理"
      subtitle="设置每档会员的充值门槛、默认折扣、显示样式与福利"
    >
      <template #actions>
        <router-link
          to="/admin/vip/discounts"
          class="text-sm text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
        >
          商品级折扣覆盖
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </router-link>
      </template>
    </AdminPageHeader>

    <div v-if="loading" class="text-ink-500 text-sm">加载中…</div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div
        v-for="row in items"
        :key="row.tier"
        class="card p-5 flex flex-col"
      >
        <!-- 头部 -->
        <div class="flex items-center gap-3 mb-4">
          <div
            class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl text-white font-bold shrink-0"
            :style="{ background: row.color || '#6b7280' }"
          >
            <span v-if="row.icon">{{ row.icon }}</span>
            <span v-else>{{ row.name?.[0] || '?' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs text-ink-400 font-mono">{{ row.tier }}</div>
            <div class="text-lg font-semibold text-ink-900 truncate">
              {{ row.name || '（未命名）' }}
            </div>
          </div>
        </div>

        <!-- 表单 -->
        <div class="space-y-3 flex-1">
          <div>
            <label class="block text-xs text-ink-500 mb-1">显示名</label>
            <input
              v-model="row.name"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
              placeholder="黄金会员"
            />
          </div>

          <div>
            <label class="block text-xs text-ink-500 mb-1">
              充值门槛 (¥)
              <span class="text-ink-400">— 累计达到此金额自动升此级</span>
            </label>
            <input
              v-model.number="row.threshold"
              type="number"
              min="0"
              step="1"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
            />
          </div>

          <div>
            <label class="block text-xs text-ink-500 mb-1">
              默认折扣
              <span class="text-ink-400">{{ discountTip }}</span>
            </label>
            <input
              v-model.number="row.defaultDiscount"
              type="number"
              min="0.5"
              max="1"
              step="0.01"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
            />
            <div class="mt-1 text-xs text-ink-400">
              当前：{{ (row.defaultDiscount * 10).toFixed(1) }} 折，每 ¥100 让 ¥{{ ((1 - row.defaultDiscount) * 100).toFixed(2) }}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs text-ink-500 mb-1">显示色 (hex)</label>
              <div class="flex items-center gap-2">
                <input
                  v-model="row.color"
                  type="color"
                  class="w-10 h-9 rounded-md border border-ink-200 cursor-pointer"
                />
                <input
                  v-model="row.color"
                  class="flex-1 px-2 py-2 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
                  placeholder="#d4a017"
                />
              </div>
            </div>
            <div>
              <label class="block text-xs text-ink-500 mb-1">显示图标 (emoji)</label>
              <input
                v-model="row.icon"
                class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
                placeholder="🥇"
              />
            </div>
          </div>

          <div>
            <label class="flex items-center justify-between text-xs text-ink-500 mb-1">
              <span>福利文案</span>
              <button
                class="text-brand-700 hover:text-brand-800"
                type="button"
                @click="addBenefit(row)"
              >
                + 添加一条
              </button>
            </label>
            <div v-if="row.benefits.length === 0" class="text-xs text-ink-400 py-2">
              暂无，点击「添加一条」
            </div>
            <div v-else class="space-y-1.5">
              <div
                v-for="(b, idx) in row.benefits"
                :key="idx"
                class="flex items-center gap-2"
              >
                <input
                  v-model="row.benefits[idx]"
                  class="flex-1 px-3 py-1.5 border border-ink-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
                  placeholder="全场 95 折"
                />
                <button
                  class="text-rose-500 hover:text-rose-600 px-1.5"
                  type="button"
                  @click="removeBenefit(row, idx)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-ink-100">
          <BrandButton
            variant="primary"
            size="md"
            block
            :loading="saving[row.tier]"
            @click="save(row)"
          >
            保存
          </BrandButton>
        </div>
      </div>
    </div>

    <!-- 说明 -->
    <div class="card p-4 mt-6 bg-ink-50 text-xs text-ink-600 leading-relaxed">
      <div class="font-medium text-ink-900 mb-1">提示</div>
      <ul class="space-y-0.5 pl-4 list-disc">
        <li>等级升级触发条件：用户充值成功后，累计充值额 ≥ 此处「门槛」即升级，<strong>永久有效</strong>，不会因为不再充值掉回去。</li>
        <li>折扣作用于商品下单（本站 + 三方），余额支付也享受；<strong>充值订单不打折</strong>（防套利）；<strong>兑换码订单不打折</strong>（兑换码本身就是折扣形式）。</li>
        <li>商品可单独配置覆盖等级默认折扣，请到「商品折扣」页配置。</li>
        <li>折扣范围 0.5 ~ 1（防呆下限 50 折），低于 0.5 会被后端拒绝。</li>
      </ul>
    </div>
  </div>
</template>
