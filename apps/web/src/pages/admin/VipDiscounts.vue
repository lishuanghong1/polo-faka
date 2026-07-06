<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import BrandButton from '@/components/BrandButton.vue';
import EmptyState from '@/components/EmptyState.vue';

type ProductSource = 'LOCAL' | 'FORGE' | 'FORGE_QUOTA';

interface DiscountRow {
  id: number;
  productSource: ProductSource;
  productKey: string;
  tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
  discount: number;
  updatedAt: string;
}

interface LocalProductOpt {
  id: number;
  title: string;
}

interface ForgeProductOpt {
  typeKey: string;
  typeName: string;
  categoryName: string;
}

interface QuotaPackageOpt {
  packageKey: string;
  name: string;
  quotaUsd: number;
}

interface VipCfg {
  tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
  name: string;
  defaultDiscount: number;
  icon: string | null;
  color: string | null;
}

const loading = ref(false);
const items = ref<DiscountRow[]>([]);
const localProducts = ref<LocalProductOpt[]>([]);
const forgeProducts = ref<ForgeProductOpt[]>([]);
const quotaPackages = ref<QuotaPackageOpt[]>([]);
const vipConfigs = ref<VipCfg[]>([]);
const filterSource = ref<'' | ProductSource>('');

// 编辑/新增 表单
const formOpen = ref(false);
const form = ref<{
  productSource: ProductSource;
  productKey: string;
  tier: 'GOLD' | 'DIAMOND' | 'SUPREME';
  discount: number;
}>({
  productSource: 'LOCAL',
  productKey: '',
  tier: 'GOLD',
  discount: 0.9,
});
const submitting = ref(false);

async function refresh() {
  loading.value = true;
  try {
    const [list, cfgs] = await Promise.all([
      api.vip.adminDiscounts(filterSource.value || undefined),
      api.vip.configs(),
    ]);
    items.value = list;
    vipConfigs.value = cfgs;
  } finally {
    loading.value = false;
  }
}

async function loadProducts() {
  try {
    const [local, forge, quota] = await Promise.all([
      api.products({ pageSize: 999 }) as Promise<any>,
      api.forge.admin.listProducts(),
      api.forge.quota.admin.listPackages().catch(() => []),
    ]);
    localProducts.value = (local?.items || []).map((p: any) => ({
      id: p.id,
      title: p.title,
    }));
    forgeProducts.value = (forge || []).map((p: any) => ({
      typeKey: p.typeKey,
      typeName: p.customName || p.typeName,
      categoryName: p.customCategoryName || p.categoryName,
    }));
    quotaPackages.value = (quota || []).map((p: any) => ({
      packageKey: p.packageKey,
      name: p.customName || p.name,
      quotaUsd: Number(p.quotaUsd),
    }));
  } catch (e) {
    // 列表失败不影响整体
  }
}

function openAdd() {
  form.value = {
    productSource: 'LOCAL',
    productKey: '',
    tier: 'GOLD',
    discount: 0.9,
  };
  formOpen.value = true;
}

function openEdit(row: DiscountRow) {
  form.value = {
    productSource: row.productSource,
    productKey: row.productKey,
    tier: row.tier,
    discount: row.discount,
  };
  formOpen.value = true;
}

async function submit() {
  if (!form.value.productKey) {
    ElMessage.warning('请选择商品');
    return;
  }
  if (form.value.discount < 0.5 || form.value.discount > 1) {
    ElMessage.warning('折扣需在 0.5 ~ 1 之间');
    return;
  }
  submitting.value = true;
  try {
    await api.vip.adminUpsertDiscount(form.value);
    ElMessage.success('已保存');
    formOpen.value = false;
    await refresh();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function remove(row: DiscountRow) {
  try {
    await ElMessageBox.confirm(
      `确定删除该商品 ${row.tier} 折扣配置？删除后会回退到等级默认折扣。`,
      '提示',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await api.vip.adminRemoveDiscount(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败');
  }
}

// 工具：商品名展示
function productLabel(source: ProductSource, key: string): string {
  if (source === 'LOCAL') {
    const p = localProducts.value.find((x) => String(x.id) === key);
    return p ? p.title : `本站#${key}`;
  }
  if (source === 'FORGE_QUOTA') {
    const p = quotaPackages.value.find((x) => x.packageKey === key);
    return p ? p.name : key;
  }
  const p = forgeProducts.value.find((x) => x.typeKey === key);
  return p ? p.typeName : key;
}

function tierMeta(tier: string) {
  return vipConfigs.value.find((c) => c.tier === tier);
}

// 简单分组：按 productSource + productKey 聚合，展示更清爽
const grouped = computed(() => {
  const map = new Map<string, DiscountRow[]>();
  for (const it of items.value) {
    const key = `${it.productSource}::${it.productKey}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return Array.from(map.entries()).map(([k, rows]) => {
    const [source, key] = k.split('::');
    return {
      source: source as ProductSource,
      key,
      label: productLabel(source as ProductSource, key),
      rows: rows.sort((a, b) =>
        ['GOLD', 'DIAMOND', 'SUPREME'].indexOf(a.tier) -
        ['GOLD', 'DIAMOND', 'SUPREME'].indexOf(b.tier),
      ),
    };
  });
});

onMounted(async () => {
  await Promise.all([refresh(), loadProducts()]);
});
</script>

<template>
  <div>
    <AdminPageHeader
      title="商品折扣覆盖"
      subtitle="可针对某个商品 + 某个等级单独设置折扣，未配置时使用等级默认折扣"
    >
      <template #actions>
        <select
          v-model="filterSource"
          class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm"
          @change="refresh()"
        >
          <option value="">全部来源</option>
          <option value="LOCAL">本站商品</option>
          <option value="FORGE">三方商品</option>
          <option value="FORGE_QUOTA">额度包</option>
        </select>
        <BrandButton variant="primary" size="sm" @click="openAdd">
          + 新增配置
        </BrandButton>
      </template>
    </AdminPageHeader>

    <div v-if="loading" class="text-ink-500 text-sm">加载中…</div>

    <EmptyState
      v-else-if="grouped.length === 0"
      icon="inbox"
      title="尚未配置任何商品级折扣"
      hint="商品默认使用其等级的默认折扣。点击右上角新增可针对特定商品调整。"
    />

    <div v-else class="space-y-3">
      <div
        v-for="g in grouped"
        :key="`${g.source}-${g.key}`"
        class="card p-4"
      >
        <div class="flex items-center justify-between mb-3 gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <span
              :class="g.source === 'LOCAL'
                ? 'bg-brand-50 text-brand-700 border-brand-200'
                : g.source === 'FORGE_QUOTA'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'"
              class="text-[10px] font-semibold px-1.5 py-0.5 border rounded-md shrink-0"
            >
              {{ g.source === 'LOCAL' ? '本站' : g.source === 'FORGE_QUOTA' ? '额度包' : '三方' }}
            </span>
            <span class="text-sm font-medium text-ink-900 truncate">{{ g.label }}</span>
            <span class="text-[11px] text-ink-400 font-mono shrink-0">{{ g.key }}</span>
          </div>
          <div class="text-[11px] text-ink-400">
            共 {{ g.rows.length }} 档配置
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div
            v-for="row in g.rows"
            :key="row.id"
            class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-ink-100 bg-ink-50/50"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
                :style="{ background: tierMeta(row.tier)?.color || '#6b7280' }"
              >
                <span class="text-sm">{{ tierMeta(row.tier)?.icon || '?' }}</span>
              </span>
              <div class="min-w-0">
                <div class="text-xs text-ink-900 truncate">
                  {{ tierMeta(row.tier)?.name || row.tier }}
                </div>
                <div class="text-[11px]">
                  <span class="text-brand-700 font-semibold">{{ (row.discount * 10).toFixed(1) }} 折</span>
                  <span class="text-ink-400 ml-1">
                    (默认 {{ ((tierMeta(row.tier)?.defaultDiscount ?? 1) * 10).toFixed(1) }})
                  </span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                class="text-xs text-brand-700 hover:text-brand-800 px-1.5"
                @click="openEdit(row)"
              >
                编辑
              </button>
              <button
                class="text-xs text-rose-500 hover:text-rose-600 px-1.5"
                @click="remove(row)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑弹层 -->
    <el-dialog
      v-model="formOpen"
      title="商品折扣配置"
      width="480px"
      destroy-on-close
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs text-ink-500 mb-1">商品来源</label>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 py-2 rounded-lg text-sm border transition"
              :class="form.productSource === 'LOCAL'
                ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                : 'border-ink-200 text-ink-600 hover:border-ink-300'"
              @click="form.productSource = 'LOCAL'; form.productKey = ''"
            >
              本站商品
            </button>
            <button
              type="button"
              class="flex-1 py-2 rounded-lg text-sm border transition"
              :class="form.productSource === 'FORGE'
                ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                : 'border-ink-200 text-ink-600 hover:border-ink-300'"
              @click="form.productSource = 'FORGE'; form.productKey = ''"
            >
              三方商品
            </button>
            <button
              type="button"
              class="flex-1 py-2 rounded-lg text-sm border transition"
              :class="form.productSource === 'FORGE_QUOTA'
                ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                : 'border-ink-200 text-ink-600 hover:border-ink-300'"
              @click="form.productSource = 'FORGE_QUOTA'; form.productKey = ''"
            >
              额度包
            </button>
          </div>
        </div>

        <div>
          <label class="block text-xs text-ink-500 mb-1">选择商品</label>
          <select
            v-model="form.productKey"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
          >
            <option value="">请选择…</option>
            <template v-if="form.productSource === 'LOCAL'">
              <option v-for="p in localProducts" :key="p.id" :value="String(p.id)">
                {{ p.title }} (#{{ p.id }})
              </option>
            </template>
            <template v-else-if="form.productSource === 'FORGE_QUOTA'">
              <option v-for="p in quotaPackages" :key="p.packageKey" :value="p.packageKey">
                {{ p.name }} · ${{ p.quotaUsd }}
              </option>
            </template>
            <template v-else>
              <option v-for="p in forgeProducts" :key="p.typeKey" :value="p.typeKey">
                {{ p.typeName }} · {{ p.categoryName }}
              </option>
            </template>
          </select>
        </div>

        <div>
          <label class="block text-xs text-ink-500 mb-1">VIP 等级</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="t in (['GOLD', 'DIAMOND', 'SUPREME'] as const)"
              :key="t"
              type="button"
              class="py-2 rounded-lg text-sm border transition"
              :class="form.tier === t
                ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium'
                : 'border-ink-200 text-ink-600 hover:border-ink-300'"
              @click="form.tier = t"
            >
              {{ tierMeta(t)?.icon }} {{ tierMeta(t)?.name || t }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-xs text-ink-500 mb-1">
            折扣（0.5 ~ 1，0.85 = 85 折）
          </label>
          <input
            v-model.number="form.discount"
            type="number"
            min="0.5"
            max="1"
            step="0.01"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/30 focus:border-brand-400"
          />
          <div class="mt-1 text-[11px] text-ink-400">
            当前：{{ (form.discount * 10).toFixed(1) }} 折，每 ¥100 让 ¥{{ ((1 - form.discount) * 100).toFixed(2) }}
            <span v-if="tierMeta(form.tier)" class="ml-2">
              · 等级默认 {{ ((tierMeta(form.tier)!.defaultDiscount) * 10).toFixed(1) }} 折
            </span>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <BrandButton variant="ghost" size="sm" @click="formOpen = false">
            取消
          </BrandButton>
          <BrandButton
            variant="primary"
            size="sm"
            :loading="submitting"
            @click="submit"
          >
            保存
          </BrandButton>
        </div>
      </template>
    </el-dialog>
  </div>
</template>
