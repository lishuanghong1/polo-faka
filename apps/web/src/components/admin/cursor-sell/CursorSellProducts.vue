<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { type CursorSellListingRules, type CursorSellProduct } from '@/api';
import BrandButton from '@/components/BrandButton.vue';

const emit = defineEmits<{ (e: 'synced'): void }>();

const router = useRouter();
const list = ref<CursorSellProduct[]>([]);
const loading = ref(false);
const syncing = ref(false);
const showInactive = ref(false);
const keyword = ref('');
const selected = ref<Set<string>>(new Set());
const listing = ref<string | null>(null);
const batchListing = ref(false);

const rules = ref<CursorSellListingRules | null>(null);
const rulesSaving = ref(false);
const categories = ref<Array<{ id: number; name: string; slug: string }>>([]);

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

/** 在售且尚未上架的商品（批量上架候选） */
const unlisted = computed(() => filtered.value.filter((p) => p.active && !(p.local && p.local.length)));
const selectedUnlisted = computed(() => unlisted.value.filter((p) => selected.value.has(p.code)));

function previewPrice(p: CursorSellProduct) {
  const r = rules.value;
  if (!r) return null;
  const cost = p.priceCents / 100;
  return Math.round(Math.max(cost + r.markupYuan, cost * (1 + r.markupPercent / 100)) * 100) / 100;
}

async function load() {
  loading.value = true;
  try {
    list.value = await api.admin.cursorSell.products(false);
    // 清理已上架的选中项
    const s = new Set<string>();
    for (const p of list.value) if (selected.value.has(p.code) && !(p.local && p.local.length)) s.add(p.code);
    selected.value = s;
  } finally {
    loading.value = false;
  }
}

async function loadRules() {
  try {
    const [r, cats] = await Promise.all([api.admin.cursorSell.listingRules(), api.categories()]);
    rules.value = r;
    categories.value = (cats || []).filter((c: any) => c.slug !== 'all');
  } catch {
    /* 页面上会显示加载失败 */
  }
}

async function saveRules() {
  if (!rules.value) return;
  rulesSaving.value = true;
  try {
    rules.value = await api.admin.cursorSell.saveListingRules(rules.value);
    ElMessage.success('规则已保存，下次同步即按新规则执行');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '保存失败');
  } finally {
    rulesSaving.value = false;
  }
}

async function sync() {
  syncing.value = true;
  try {
    const r = await api.admin.cursorSell.syncProducts();
    const l = r.listing || { listed: 0, repriced: 0, offShelf: 0, restored: 0 };
    ElMessage.success(
      `同步完成：更新 ${r.upserted}，下架 ${r.deactivated}；自动上架 ${l.listed}，调价 ${l.repriced}，本站下架 ${l.offShelf}，恢复 ${l.restored}`,
    );
    await load();
    emit('synced');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function listOne(p: CursorSellProduct) {
  const price = previewPrice(p);
  await ElMessageBox.confirm(
    `将「${p.title}」上架为本站商品，售价 ¥${price?.toFixed(2) ?? '—'}（成本 ¥${p.price.toFixed(2)} + 加价），价格随渠道自动变动。确认？`,
    '上架确认',
    { type: 'info', confirmButtonText: '上架' },
  );
  listing.value = p.code;
  try {
    const r = await api.admin.cursorSell.listProduct(p.code);
    ElMessage.success(r.created ? `已上架，售价 ¥${r.price.toFixed(2)}` : '该商品已有本站规格绑定，未重复创建');
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '上架失败');
  } finally {
    listing.value = null;
  }
}

async function listSelected(all = false) {
  const targets = all ? unlisted.value : selectedUnlisted.value;
  if (!targets.length) return ElMessage.warning('没有可上架的商品');
  await ElMessageBox.confirm(
    `将 ${targets.length} 个渠道商品上架为本站商品（成本 + 加价，价格自动跟随）。确认？`,
    '批量上架',
    { type: 'info', confirmButtonText: `上架 ${targets.length} 个` },
  );
  batchListing.value = true;
  try {
    const r = await api.admin.cursorSell.listBatch({ codes: targets.map((p) => p.code) });
    ElMessage[r.failed ? 'warning' : 'success'](`新上架 ${r.created}，已存在 ${r.existed}，失败 ${r.failed}`);
    if (r.failed) {
      const first = r.results.find((x) => !x.ok);
      if (first) ElMessage.error(`${first.code}: ${first.error}`);
    }
    selected.value = new Set();
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '批量上架失败');
  } finally {
    batchListing.value = false;
  }
}

function toggleSelect(code: string) {
  const s = new Set(selected.value);
  if (s.has(code)) s.delete(code);
  else s.add(code);
  selected.value = s;
}

function toggleSelectAll() {
  if (selectedUnlisted.value.length === unlisted.value.length) selected.value = new Set();
  else selected.value = new Set(unlisted.value.map((p) => p.code));
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessage.error('复制失败');
  }
}

const statusText: Record<string, string> = { ON_SALE: '在售', OFF_SHELF: '已下架', DRAFT: '草稿' };

onMounted(() => {
  load();
  loadRules();
});
defineExpose({ load });
</script>

<template>
  <div class="space-y-4">
    <!-- 自动上架 / 跟价规则 -->
    <div class="rounded-xl border border-ink-100 bg-white p-5">
      <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div class="text-sm font-medium text-ink-900">自动上架 & 跟价规则</div>
          <p class="text-[11px] text-ink-400 mt-0.5">每次同步（每 5 分钟 / 手动）按此规则：新商品自动上架、跟价规格按最新成本重算、上游下架则本站下架。</p>
        </div>
        <BrandButton variant="primary" size="sm" :loading="rulesSaving" :disabled="!rules" @click="saveRules">保存规则</BrandButton>
      </div>
      <div v-if="rules" class="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="rules.autoList" type="checkbox" class="mt-1" />
          <span>
            <span class="text-ink-800 font-medium">自动上架新同步到的渠道商品</span>
            <span class="block text-[11px] text-ink-400">关闭后仍可在下方列表手动上架</span>
          </span>
        </label>
        <div>
          <label class="text-xs text-ink-500 block mb-1">上架到分类</label>
          <select v-model="rules.categoryId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white text-sm">
            <option :value="null">默认（第一个分类）</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-ink-500 block mb-1">固定加价（元）</label>
            <input v-model.number="rules.markupYuan" type="number" min="0" step="0.5" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          </div>
          <div>
            <label class="text-xs text-ink-500 block mb-1">比例加价（%）</label>
            <input v-model.number="rules.markupPercent" type="number" min="0" step="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          </div>
        </div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="rules.followOffShelf" type="checkbox" class="mt-1" />
          <span>
            <span class="text-ink-800 font-medium">上游下架时本站自动下架</span>
            <span class="block text-[11px] text-ink-400">上游恢复后，只恢复被系统自动下架的商品</span>
          </span>
        </label>
        <div>
          <label class="text-xs text-ink-500 block mb-1">下单保底利润（元）</label>
          <input v-model.number="rules.minMarginYuan" type="number" min="0" step="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          <p class="text-[11px] text-ink-400 mt-1">售价低于「成本 + 保底」时拒绝下单并提示刷新，防止渠道涨价瞬间卖亏</p>
        </div>
        <div class="text-[11px] text-ink-500 leading-relaxed self-end">
          售价 = max(成本 + 固定加价, 成本 × (1 + 比例))。
          示例：成本 ¥9.90 → ¥{{ (Math.max(9.9 + rules.markupYuan, 9.9 * (1 + rules.markupPercent / 100))).toFixed(2) }}
        </div>
      </div>
      <div v-else class="text-xs text-ink-400">规则加载中…</div>
    </div>

    <!-- 工具条 -->
    <div class="flex items-center gap-3 flex-wrap">
      <input v-model="keyword" placeholder="搜 code / 名称 / 档位" class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-56" />
      <label class="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
        <input v-model="showInactive" type="checkbox" />
        显示已下架
      </label>
      <span class="text-xs text-ink-400">共 {{ filtered.length }} 个 · 未上架 {{ unlisted.length }} 个</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <BrandButton v-if="selectedUnlisted.length" variant="subtle" size="sm" :loading="batchListing" @click="listSelected(false)">
          上架选中（{{ selectedUnlisted.length }}）
        </BrandButton>
        <BrandButton v-else-if="unlisted.length" variant="subtle" size="sm" :loading="batchListing" @click="listSelected(true)">
          全部上架（{{ unlisted.length }}）
        </BrandButton>
        <BrandButton variant="secondary" size="sm" :disabled="loading" @click="load">刷新</BrandButton>
        <BrandButton variant="primary" size="sm" :loading="syncing" @click="sync">从上游同步</BrandButton>
      </div>
    </div>

    <div class="rounded-xl border border-ink-100 bg-white overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[1080px]">
        <thead class="bg-ink-50 text-ink-600">
          <tr>
            <th class="px-3 py-2 w-8">
              <input type="checkbox" :checked="unlisted.length > 0 && selectedUnlisted.length === unlisted.length" :disabled="!unlisted.length" @change="toggleSelectAll" />
            </th>
            <th class="px-4 py-2 text-left">渠道商品</th>
            <th class="px-4 py-2 text-left">档位</th>
            <th class="px-4 py-2 text-right">成本价</th>
            <th class="px-4 py-2 text-right">预估库存</th>
            <th class="px-4 py-2 text-left">交付方式</th>
            <th class="px-4 py-2 text-left">本站商品</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="p in filtered" :key="p.code" :class="!p.active ? 'opacity-50' : ''">
            <td class="px-3 py-2">
              <input
                v-if="p.active && !(p.local && p.local.length)"
                type="checkbox"
                :checked="selected.has(p.code)"
                @change="toggleSelect(p.code)"
              />
            </td>
            <td class="px-4 py-2">
              <div class="text-ink-900">{{ p.title }}</div>
              <button class="font-mono text-[11px] text-brand-700 hover:underline" @click="copy(p.code)">{{ p.code }}</button>
              <span v-if="!p.active" class="ml-2 inline-block px-1.5 py-0.5 text-[10px] rounded bg-ink-100 text-ink-500">上游已下架</span>
            </td>
            <td class="px-4 py-2 text-ink-600 uppercase text-xs">{{ p.tier }}</td>
            <td class="px-4 py-2 text-right text-ink-900">¥{{ p.price.toFixed(2) }}</td>
            <td class="px-4 py-2 text-right" :class="p.stock <= 3 ? 'text-rose-600 font-medium' : 'text-ink-800'">{{ p.stock }}</td>
            <td class="px-4 py-2">
              <span
                class="inline-block px-2 py-0.5 text-[11px] rounded-md"
                :class="(modeLabel[p.deliveryMode] || modeLabel.account).cls"
                :title="(modeLabel[p.deliveryMode] || modeLabel.account).hint"
              >{{ (modeLabel[p.deliveryMode] || modeLabel.account).text }}</span>
              <span v-if="p.ondemandTeam" class="ml-1 inline-block px-2 py-0.5 text-[11px] rounded-md bg-rose-50 text-rose-700">现做</span>
              <div class="text-[11px] text-ink-400 mt-0.5">{{ p.warrantyHours ? `质保 ${p.warrantyHours}h` : '无质保' }}</div>
            </td>
            <td class="px-4 py-2">
              <template v-if="p.local && p.local.length">
                <div v-for="b in p.local" :key="b.skuId" class="text-xs leading-relaxed">
                  <button class="text-brand-700 hover:underline" @click="router.push('/admin/products')">{{ b.productTitle }}</button>
                  <span class="text-ink-400"> / {{ b.skuName }}</span>
                  <span class="ml-1 text-ink-900 font-medium">¥{{ b.price.toFixed(2) }}</span>
                  <span v-if="b.follow" class="ml-1 inline-block px-1.5 py-0.5 text-[10px] rounded bg-emerald-50 text-emerald-700" title="价格随渠道成本自动变动">跟价</span>
                  <span v-else class="ml-1 inline-block px-1.5 py-0.5 text-[10px] rounded bg-ink-100 text-ink-500" title="手工定价，同步不改">手工价</span>
                  <span
                    class="ml-1 inline-block px-1.5 py-0.5 text-[10px] rounded"
                    :class="b.productStatus === 'ON_SALE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
                  >{{ statusText[b.productStatus] || b.productStatus }}</span>
                </div>
              </template>
              <span v-else-if="p.active" class="text-xs text-ink-400">
                未上架<span v-if="previewPrice(p) != null" class="ml-1">· 上架后 ¥{{ previewPrice(p)!.toFixed(2) }}</span>
              </span>
              <span v-else class="text-xs text-ink-300">—</span>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button
                v-if="p.active && !(p.local && p.local.length)"
                class="text-xs text-brand-600 hover:underline disabled:opacity-50"
                :disabled="listing === p.code"
                @click="listOne(p)"
              >{{ listing === p.code ? '上架中…' : '上架' }}</button>
              <span v-else-if="p.local && p.local.length" class="text-xs text-ink-300">已上架</span>
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
      库存为上游静态估算，成交时会实时验档，偶发无货属正常。自动上架生成的商品是普通商品：标题、描述、封面、分类随便改，同步只会更新价格和上下架状态；在商品编辑里关掉规格的「跟随渠道价」即可手工定价。
    </p>
  </div>
</template>
