<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { type CursorSellProduct } from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import AdminSearchInput from '@/components/admin/AdminSearchInput.vue';
import RichTextEditor from '@/components/RichTextEditor.vue';

const list = ref<any[]>([]);
const cats = ref<any[]>([]);
const editing = ref<any | null>(null);
const loading = ref(false);
const filter = ref<{ status: string; keyword: string }>({ status: '', keyword: '' });

/** Team 售号渠道商品缓存（CURSOR_SELL 交付类型下给规格绑定用） */
const cursorSellProducts = ref<CursorSellProduct[]>([]);
const cursorSellLoaded = ref(false);
async function loadCursorSellProducts() {
  if (cursorSellLoaded.value) return;
  try {
    cursorSellProducts.value = await api.admin.cursorSell.products(false);
    cursorSellLoaded.value = true;
  } catch {
    cursorSellProducts.value = [];
  }
}
function cursorSellProductOf(code: string) {
  return cursorSellProducts.value.find((p) => p.code === code) || null;
}
/** 跟价售价 = max(成本 + 固定加价, 成本 × (1 + 比例))，与后端一致 */
function cursorSellFollowPrice(s: any): number | null {
  const cp = cursorSellProductOf(s._cursorSellCode);
  if (!cp) return null;
  const cost = cp.price;
  const fixed = cost + Math.max(0, Number(s._cursorSellMarkupYuan) || 0);
  const pct = cost * (1 + Math.max(0, Number(s._cursorSellMarkupPercent) || 0) / 100);
  return Math.round(Math.max(fixed, pct) * 100) / 100;
}
watch(
  () => editing.value?.deliveryType,
  (t) => {
    if (t === 'CURSOR_SELL') loadCursorSellProducts();
  },
);

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'ON_SALE', label: '在售' },
  { value: 'OFF_SHELF', label: '已下架' },
  { value: 'DRAFT', label: '草稿' },
];

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.productsListAll({
      status: filter.value.status || undefined,
      keyword: filter.value.keyword || undefined,
    });
    list.value = a.items;
    if (!cats.value.length) cats.value = await api.categories();
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function startEdit(p: any) {
  editing.value = JSON.parse(JSON.stringify(p));
  if (Array.isArray(editing.value.tags)) {
    editing.value._tagsStr = editing.value.tags.join(',');
  } else {
    editing.value._tagsStr = editing.value.tags || '';
  }
  if (Array.isArray(editing.value.bulkPricing)) {
    editing.value._bulkStr = JSON.stringify(editing.value.bulkPricing);
  }
  // 返积分倍率：数据库是 0~1 的小数，编辑时按「百分比」展示更直观
  const rawRate = editing.value.pointsAwardRate;
  editing.value._pointsAwardRatePct =
    rawRate === null || rawRate === undefined || rawRate === ''
      ? ''
      : String(+(Number(rawRate) * 100).toFixed(2));
  for (const s of editing.value.skus || []) {
    const attrs = s.attrs && typeof s.attrs === 'object' ? s.attrs : {};
    s._poolValidityDays = attrs.poolValidityDays ?? attrs.validityDays ?? '';
    s._cursorSellCode = attrs.cursorSellCode ?? '';
    s._cursorSellExtractSplit = !!attrs.cursorSellExtractSplit;
    const pricing = attrs.cursorSellPricing && typeof attrs.cursorSellPricing === 'object' ? attrs.cursorSellPricing : null;
    s._cursorSellFollow = !!pricing;
    s._cursorSellMarkupYuan = pricing ? Number(pricing.markupYuan) || 0 : 20;
    s._cursorSellMarkupPercent = pricing ? Number(pricing.markupPercent) || 0 : 0;
  }
  // AIZHP 档位：从第一个 SKU 的 attrs.aizhpPlan 读取
  const firstSkuAttrs = editing.value.skus?.[0]?.attrs;
  editing.value._aizhpPlan = (firstSkuAttrs && typeof firstSkuAttrs === 'object' ? firstSkuAttrs.aizhpPlan : '') || 'pro';
}

function newProduct() {
  editing.value = {
    categoryId: cats.value.find((c) => c.slug !== 'all')?.id ?? cats.value[0]?.id,
    title: '',
    subtitle: '',
    description: '',
    cover: '',
    basePrice: 0,
    sort: 0,
    _tagsStr: '',
    _bulkStr: '',
    warranty: '',
    skus: [{
      name: '默认规格', price: 0, sort: 0, visible: true, _poolValidityDays: '',
      _cursorSellCode: '', _cursorSellExtractSplit: false,
      _cursorSellFollow: true, _cursorSellMarkupYuan: 20, _cursorSellMarkupPercent: 0,
    }],
    status: 'ON_SALE',
    deliveryType: 'CARD_KEY',
    pointsAwardEnabled: true,
    pointsPayEnabled: true,
    pointsAwardRate: null,
    _pointsAwardRatePct: '',
    _aizhpPlan: 'pro',
  };
}

async function save() {
  if (!editing.value.title) {
    ElMessage.warning('请填写商品标题');
    return;
  }
  const payload: any = { ...editing.value };
  payload.tags = (payload._tagsStr || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  if (payload._bulkStr?.trim()) {
    try {
      payload.bulkPricing = JSON.parse(payload._bulkStr);
    } catch {
      ElMessage.error('批量优惠 JSON 格式有误');
      return;
    }
  } else {
    payload.bulkPricing = null;
  }
  delete payload._tagsStr;
  delete payload._bulkStr;
  if (payload.deliveryType === 'CURSOR_SELL') {
    const missing = (payload.skus || []).find((s: any) => !String(s._cursorSellCode || '').trim());
    if (missing) {
      ElMessage.warning(`规格「${missing.name || '未命名'}」还没绑定渠道商品`);
      return;
    }
  }
  payload.skus = (payload.skus || []).map((raw: any) => {
    const s = { ...raw };
    const attrs = s.attrs && typeof s.attrs === 'object' && !Array.isArray(s.attrs) ? { ...s.attrs } : {};
    // 渠道绑定字段只在 CURSOR_SELL 下保留，切换交付类型时清掉，避免残留误导
    if (payload.deliveryType === 'CURSOR_SELL') {
      attrs.cursorSellCode = String(s._cursorSellCode || '').trim();
      const cp = cursorSellProductOf(attrs.cursorSellCode);
      if (cp?.extractOnly && s._cursorSellExtractSplit) attrs.cursorSellExtractSplit = true;
      else delete attrs.cursorSellExtractSplit;
      if (s._cursorSellFollow) {
        attrs.cursorSellPricing = {
          mode: 'COST_PLUS',
          markupYuan: Math.max(0, Number(s._cursorSellMarkupYuan) || 0),
          markupPercent: Math.max(0, Number(s._cursorSellMarkupPercent) || 0),
        };
        // 跟价规格的价格由服务端按最新成本重算，这里先填当前预览值
        const preview = cursorSellFollowPrice(s);
        if (preview != null) s.price = preview;
      } else {
        delete attrs.cursorSellPricing;
      }
    } else {
      delete attrs.cursorSellCode;
      delete attrs.cursorSellExtractSplit;
      delete attrs.cursorSellPricing;
      delete attrs.cursorSellAutoListed;
      delete attrs.cursorSellAutoOffShelf;
    }
    delete s._cursorSellCode;
    delete s._cursorSellExtractSplit;
    delete s._cursorSellFollow;
    delete s._cursorSellMarkupYuan;
    delete s._cursorSellMarkupPercent;
    if (payload.deliveryType === 'POOL_QUOTA') {
      const validityDays = Number(s._poolValidityDays);
      delete attrs.poolQuota;
      delete attrs.quotaTotal;
      delete attrs.quota;
      delete attrs.poolQuotaPerUnit;
      delete attrs.quotaPerUnit;
      delete attrs.aizhpPlan;
      if (Number.isFinite(validityDays) && validityDays > 0) attrs.poolValidityDays = Math.floor(validityDays);
      else delete attrs.poolValidityDays;
    } else if (payload.deliveryType === 'AIZHP') {
      // 将档位存入每个 SKU 的 attrs
      attrs.aizhpPlan = payload._aizhpPlan || 'pro';
      delete attrs.poolQuota;
      delete attrs.quotaTotal;
      delete attrs.quota;
      delete attrs.poolQuotaPerUnit;
      delete attrs.quotaPerUnit;
      delete attrs.poolValidityDays;
      delete attrs.validityDays;
    } else {
      delete attrs.poolQuota;
      delete attrs.quotaTotal;
      delete attrs.quota;
      delete attrs.poolQuotaPerUnit;
      delete attrs.quotaPerUnit;
      delete attrs.poolValidityDays;
      delete attrs.validityDays;
      delete attrs.aizhpPlan;
    }
    s.attrs = Object.keys(attrs).length ? attrs : null;
    delete s._poolValidityDays;
    return s;
  });
  delete payload._aizhpPlan;

  payload.pointsAwardEnabled = !!payload.pointsAwardEnabled;
  payload.pointsPayEnabled = !!payload.pointsPayEnabled;
  // 把百分比输入转回 0~1 小数（空串 / 非法 = null = 走全局默认 10%）
  const rateStr = String(payload._pointsAwardRatePct ?? '').trim();
  if (rateStr === '') {
    payload.pointsAwardRate = null;
  } else {
    const pct = Number(rateStr);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      ElMessage.error('返积分倍率必须为 0-100 之间的数字');
      return;
    }
    payload.pointsAwardRate = +(pct / 100).toFixed(4);
  }
  delete payload._pointsAwardRatePct;

  if (payload.id) {
    await api.admin.productsUpdate(payload.id, payload);
  } else {
    await api.admin.productsCreate(payload);
  }
  ElMessage.success('已保存');
  editing.value = null;
  load();
}

async function del(p: any) {
  await ElMessageBox.confirm(
    `确认删除商品「${p.title}」？\n该商品下所有规格和卡密会一并删除（已售卡密保留）。`,
    '危险操作',
    { type: 'warning' },
  );
  await api.admin.productsRemove(p.id);
  ElMessage.success('已删除');
  load();
}

async function toggleStatus(p: any) {
  const next = p.status === 'ON_SALE' ? 'OFF_SHELF' : 'ON_SALE';
  await api.admin.productsSetStatus(p.id, next);
  ElMessage.success(next === 'ON_SALE' ? '已上架' : '已下架');
  load();
}

// 列表内联调整排序权重（数字越大越靠前）。出错时回滚到服务端真实顺序。
async function updateSort(p: any) {
  const sort = Number(p.sort);
  if (!Number.isFinite(sort)) {
    load();
    return;
  }
  try {
    await api.admin.productsUpdate(p.id, { sort: Math.trunc(sort) });
    ElMessage.success('排序已更新');
    load();
  } catch {
    load();
  }
}

function addSku() {
  editing.value.skus.push({ name: '', price: 0, sort: editing.value.skus.length, visible: true, _poolValidityDays: '' });
}
function removeSku(i: number) {
  editing.value.skus.splice(i, 1);
}
</script>

<template>
  <AdminPageHeader title="商品" subtitle="管理商城在售商品与规格">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" @click="newProduct">
        + 新建商品
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-3 mb-4 admin-filter-bar">
    <AdminSearchInput
      v-model="filter.keyword"
      placeholder="搜索商品标题"
      @enter="load"
    />
    <select v-model="filter.status" class="admin-select flex-1 sm:flex-none" @change="load">
      <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <button class="px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="load">查询</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1240px">
    <thead>
      <tr>
        <th style="width: 60px">ID</th>
        <th>商品</th>
        <th>分类</th>
        <th class="!text-right">起价</th>
        <th class="!text-right">库存</th>
        <th class="!text-right">销量</th>
        <th class="!text-right" style="width: 90px">排序</th>
        <th>积分</th>
        <th>状态</th>
        <th class="!text-right" style="width: 180px"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="p in list" :key="p.id">
        <td class="text-ink-400 font-mono text-xs">#{{ p.id }}</td>
        <td>
          <div class="flex items-center gap-3">
            <img
              v-if="p.cover"
              :src="p.cover"
              class="w-10 h-10 rounded-lg object-cover border border-ink-100 shrink-0"
            />
            <div
              v-else
              class="w-10 h-10 rounded-lg bg-ink-100 text-ink-400 flex items-center justify-center text-xs shrink-0"
            >
              {{ p.title[0]?.toUpperCase() }}
            </div>
            <div class="min-w-0">
              <div class="font-medium text-ink-900 truncate">{{ p.title }}</div>
              <div v-if="p.subtitle" class="text-xs text-ink-500 truncate">{{ p.subtitle }}</div>
            </div>
          </div>
        </td>
        <td class="text-ink-600">{{ p.category?.name }}</td>
        <td class="text-right font-medium text-price">¥{{ p.basePrice }}</td>
        <td class="text-right">
          <span :class="(p.totalStock ?? 0) < 5 ? 'text-amber-700 font-semibold' : 'text-ink-700'">
            {{ p.totalStock ?? 0 }}
          </span>
        </td>
        <td class="text-right text-ink-600">{{ p.sales }}</td>
        <td class="text-right">
          <input
            v-model.number="p.sort"
            type="number"
            class="w-16 px-2 py-1 border border-ink-200 rounded-md text-right text-sm focus:border-brand-400 focus:outline-none"
            title="数字越大越靠前，修改后失焦自动保存"
            @change="updateSort(p)"
          />
        </td>
        <td class="whitespace-nowrap">
          <div class="flex flex-col gap-0.5 text-[11px] leading-tight">
            <span
              :class="p.pointsAwardEnabled
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-ink-400 bg-ink-50 border-ink-200'"
              class="inline-block px-1.5 py-0.5 rounded border w-fit"
              :title="p.pointsAwardEnabled ? '购买可返积分' : '购买不返积分'"
            >
              返积分
              <template v-if="p.pointsAwardEnabled">
                · {{ p.pointsAwardRate != null
                  ? (Number(p.pointsAwardRate) * 100).toFixed(p.pointsAwardRate * 100 % 1 ? 1 : 0) + '%'
                  : '默认10%' }}
              </template>
              <template v-else>·关</template>
            </span>
            <span
              :class="p.pointsPayEnabled
                ? 'text-amber-700 bg-amber-50 border-amber-200'
                : 'text-ink-400 bg-ink-50 border-ink-200'"
              class="inline-block px-1.5 py-0.5 rounded border w-fit"
              :title="p.pointsPayEnabled ? '允许积分支付' : '不允许积分支付'"
            >
              积分付 {{ p.pointsPayEnabled ? '·开' : '·关' }}
            </span>
          </div>
        </td>
        <td>
          <button
            class="text-xs px-2 py-0.5 rounded-md border whitespace-nowrap"
            :class="p.status === 'ON_SALE'
              ? 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
              : 'bg-ink-100 text-ink-500 border-ink-200 hover:bg-ink-200'"
            @click="toggleStatus(p)"
          >
            {{ p.status === 'ON_SALE' ? '在售' : p.status === 'OFF_SHELF' ? '下架' : '草稿' }}
          </button>
        </td>
        <td class="text-right whitespace-nowrap">
          <button class="text-ink-500 hover:text-brand-700 mr-3 text-sm" @click="startEdit(p)">编辑</button>
          <button class="text-ink-500 hover:text-rose-600 text-sm" @click="del(p)">删除</button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <el-dialog
    :model-value="!!editing"
    :show-close="true"
    width="720px"
    :title="editing?.id ? '编辑商品' : '新建商品'"
    @update:model-value="(v: boolean) => !v && (editing = null)"
    @close="editing = null"
  >
    <div v-if="editing" class="space-y-4 text-sm">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-ink-500 mb-1">分类</label>
          <select v-model="editing.categoryId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">状态</label>
          <select v-model="editing.status" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option value="ON_SALE">在售</option>
            <option value="OFF_SHELF">下架</option>
            <option value="DRAFT">草稿</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">交付类型</label>
          <select v-model="editing.deliveryType" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option value="CARD_KEY">卡密自动发货</option>
            <option value="POOL_QUOTA">号池额度包</option>
            <option value="MANUAL">人工发货</option>
            <option value="AIZHP">Aizhp 渠道</option>
            <option value="CURSOR_SELL">Team 售号渠道（付款后实时向上游采购）</option>
          </select>
        </div>
        <div v-if="editing.deliveryType === 'AIZHP'">
          <label class="block text-xs text-ink-500 mb-1">退款档位（账号类型）</label>
          <select v-model="editing._aizhpPlan" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option value="pro">Pro</option>
            <option value="pro+">Pro+</option>
            <option value="ultra">Ultra</option>
          </select>
          <p class="text-[11px] text-ink-400 mt-1">用户退款时自动按此档位提交，无需手动选择</p>
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">标题</label>
        <input v-model="editing.title" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="商品标题" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">副标题</label>
        <input v-model="editing.subtitle" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="如：新品稳定成品号" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">封面图 URL（可选）</label>
        <div class="flex items-center gap-3">
          <input
            v-model="editing.cover"
            class="flex-1 px-3 py-2 border border-ink-200 rounded-lg"
            placeholder="https://..."
          />
          <img
            v-if="editing.cover"
            :src="editing.cover"
            class="w-10 h-10 rounded-lg object-cover border border-ink-100"
            alt=""
          />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">详细描述（前台商品详情显示，支持富文本）</label>
        <RichTextEditor v-model="editing.description" height="280px" />
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs text-ink-500 mb-1">起价（列表展示用）</label>
          <input v-model.number="editing.basePrice" type="number" step="0.01" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">排序（数字越大越靠前）</label>
          <input v-model.number="editing.sort" type="number" step="1" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="0" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">标签（逗号分隔）</label>
          <input
            v-model="editing._tagsStr"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg"
            placeholder="新品,热销,质保"
          />
        </div>
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">质保说明（可选）</label>
        <input v-model="editing.warranty" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="如：默认无质保 / 七天内掉了我直接补新的" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">批量优惠 JSON（可选）</label>
        <input
          v-model="editing._bulkStr"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"
          placeholder='例如：[{"min":1,"max":9,"price":0.5},{"min":10,"max":30,"price":0.45}]'
        />
      </div>

      <div class="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
        <div class="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.3 6.7 19l1-5.8-4.2-4.1 5.9-.9L12 3z" stroke-linejoin="round"/>
          </svg>
          积分设置
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex items-start gap-2 cursor-pointer bg-white border border-amber-100 rounded-md px-3 py-2 hover:border-amber-300">
            <input
              type="checkbox"
              v-model="editing.pointsAwardEnabled"
              class="mt-1"
            />
            <div class="min-w-0">
              <div class="text-sm text-ink-800 font-medium">购买后返积分</div>
              <div class="text-[11px] text-ink-500 mt-0.5">
                关闭后，本商品消费不再产生积分奖励，邀请首单奖励也不会触发
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 cursor-pointer bg-white border border-amber-100 rounded-md px-3 py-2 hover:border-amber-300">
            <input
              type="checkbox"
              v-model="editing.pointsPayEnabled"
              class="mt-1"
            />
            <div class="min-w-0">
              <div class="text-sm text-ink-800 font-medium">允许积分下单</div>
              <div class="text-[11px] text-ink-500 mt-0.5">
                开启后用户可使用积分支付本商品（1 积分 = 1 元）。号池 / 人工发货类商品建议谨慎开启
              </div>
            </div>
          </label>
        </div>
        <div class="mt-3 bg-white border border-amber-100 rounded-md px-3 py-2">
          <label class="block text-sm text-ink-800 font-medium">返积分倍率（按实付金额）</label>
          <div class="mt-1 flex items-center gap-2">
            <input
              v-model="editing._pointsAwardRatePct"
              type="number"
              min="0"
              max="100"
              step="0.5"
              placeholder="留空 = 默认 10"
              class="w-28 px-2 py-1 text-sm border border-ink-200 rounded text-right"
              :disabled="!editing.pointsAwardEnabled"
            />
            <span class="text-sm text-ink-600">%</span>
            <span class="text-[11px] text-ink-400 ml-2">
              示例：填 20 = 实付 100 元返 20 积分；留空走全站默认 10%
            </span>
          </div>
        </div>
      </div>

      <div class="border-t border-ink-100 pt-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-ink-900">规格 SKU</span>
          <button class="text-brand-700 hover:text-brand-800 text-xs" @click="addSku">+ 添加规格</button>
        </div>
        <div class="grid grid-cols-[1fr_100px_70px_30px] gap-2 text-[11px] text-ink-400 px-1 mb-1">
          <span>规格名</span>
          <span class="text-right pr-2">价格</span>
          <span class="text-right pr-2">排序</span>
          <span></span>
        </div>
        <div v-for="(s, i) in editing.skus" :key="i" class="grid grid-cols-[1fr_100px_70px_30px] gap-2 mb-2">
          <input v-model="s.name" placeholder="规格名" class="px-3 py-2 border border-ink-200 rounded-lg text-sm" />
          <input v-model.number="s.price" type="number" step="0.01" placeholder="价格" class="px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          <input v-model.number="s.sort" type="number" placeholder="排序" class="px-3 py-2 border border-ink-200 rounded-lg text-sm text-right" />
          <button class="text-ink-400 hover:text-rose-600 text-lg" @click="removeSku(i)">×</button>
        </div>
        <div v-if="editing.deliveryType === 'POOL_QUOTA'" class="space-y-2">
          <div
            v-for="(s, i) in editing.skus"
            :key="`pool-${i}`"
            class="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2 items-end rounded-lg bg-brand-50/50 border border-brand-100 p-3"
          >
            <div class="min-w-0">
              <div class="text-xs text-ink-500 mb-1">规格</div>
              <div class="text-sm text-ink-800 truncate">{{ s.name || `规格 ${i + 1}` }}</div>
            </div>
            <div>
              <label class="block text-xs text-ink-500 mb-1">有效天数</label>
              <input
                v-model.number="s._poolValidityDays"
                type="number"
                min="1"
                step="1"
                class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm text-right"
                placeholder="30"
              />
            </div>
          </div>
          <p class="text-[11px] text-brand-800 leading-relaxed">
            额度按订单实付金额和环境变量 POOL_QUOTA_PER_CNY 自动计算，无需单独设置总额度。
          </p>
        </div>
        <div v-if="editing.deliveryType === 'CURSOR_SELL'" class="space-y-2">
          <div
            v-for="(s, i) in editing.skus"
            :key="`cs-${i}`"
            class="rounded-lg bg-sky-50/50 border border-sky-100 p-3 space-y-2"
          >
            <div class="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] gap-2 items-end">
              <div class="min-w-0">
                <div class="text-xs text-ink-500 mb-1">规格</div>
                <div class="text-sm text-ink-800 truncate">{{ s.name || `规格 ${i + 1}` }}</div>
              </div>
              <div>
                <label class="block text-xs text-ink-500 mb-1">绑定渠道商品</label>
                <select v-model="s._cursorSellCode" class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white">
                  <option value="" disabled>请选择</option>
                  <option v-for="cp in cursorSellProducts" :key="cp.code" :value="cp.code" :disabled="!cp.active">
                    {{ cp.title }} · {{ cp.tier.toUpperCase() }} · 成本 ¥{{ cp.price.toFixed(2) }} · 库存 {{ cp.stock }}{{ cp.active ? '' : '（已下架）' }}
                  </option>
                </select>
              </div>
            </div>
            <template v-if="cursorSellProductOf(s._cursorSellCode)">
              <div class="text-[11px] text-ink-600 flex flex-wrap gap-x-3 gap-y-1">
                <span>交付：<b>{{ { account: '凭据直发', login: '授权登录', card: '池卡密', extract: '次数票' }[cursorSellProductOf(s._cursorSellCode)!.deliveryMode] }}</b></span>
                <span>字段：<span class="font-mono">{{ cursorSellProductOf(s._cursorSellCode)!.deliveryFields.join(', ') || '—' }}</span></span>
                <span v-if="cursorSellProductOf(s._cursorSellCode)!.warrantyHours">质保 {{ cursorSellProductOf(s._cursorSellCode)!.warrantyHours }}h</span>
                <span v-if="cursorSellProductOf(s._cursorSellCode)!.ondemandTeam" class="text-rose-700">现做（单次 ≤5，付款后先显示开通中）</span>
                <span v-if="!s._cursorSellFollow && Number(s.price) > 0 && Number(s.price) < cursorSellProductOf(s._cursorSellCode)!.price" class="text-rose-700 font-medium">
                  ⚠ 售价低于成本 ¥{{ cursorSellProductOf(s._cursorSellCode)!.price.toFixed(2) }}
                </span>
              </div>
              <div class="flex items-center gap-3 flex-wrap text-xs bg-white border border-sky-100 rounded-md px-3 py-2">
                <label class="flex items-center gap-1.5 cursor-pointer text-ink-800 font-medium">
                  <input v-model="s._cursorSellFollow" type="checkbox" />
                  跟随渠道价
                </label>
                <template v-if="s._cursorSellFollow">
                  <span class="text-ink-500">成本 ¥{{ cursorSellProductOf(s._cursorSellCode)!.price.toFixed(2) }} +</span>
                  <input v-model.number="s._cursorSellMarkupYuan" type="number" min="0" step="0.5" class="w-20 px-2 py-1 border border-ink-200 rounded text-right" />
                  <span class="text-ink-500">元，或 ×(1 +</span>
                  <input v-model.number="s._cursorSellMarkupPercent" type="number" min="0" step="1" class="w-16 px-2 py-1 border border-ink-200 rounded text-right" />
                  <span class="text-ink-500">%) 取高 ⇒ 售价</span>
                  <b class="text-rose-600">¥{{ (cursorSellFollowPrice(s) ?? 0).toFixed(2) }}</b>
                  <span class="text-ink-400">（渠道成本变动时每 5 分钟自动重算，上方价格框无效）</span>
                </template>
                <span v-else class="text-ink-400">手工定价：使用上方价格框，同步不会改动</span>
              </div>
              <label v-if="cursorSellProductOf(s._cursorSellCode)!.extractOnly" class="flex items-center gap-1.5 text-xs text-ink-700 cursor-pointer">
                <input v-model="s._cursorSellExtractSplit" type="checkbox" />
                多件购买时拆成多张各 1 次的提取卡（不勾则 1 张 N 次）
              </label>
            </template>
          </div>
          <p v-if="!cursorSellProducts.length" class="text-[11px] text-amber-700">
            还没有渠道商品缓存，请先到「Team 渠道 → 渠道商品」同步。
          </p>
          <p class="text-[11px] text-sky-800 leading-relaxed">
            前台库存显示为渠道预估库存；付款后自动向上游采购，失败会停在「已支付」并企微提醒。授权登录类商品的买家需在订单页粘贴登录链接完成授权。
          </p>
        </div>
        <p v-if="editing.id" class="text-[11px] text-ink-400 mt-1">
          提示：删除规格时如果该规格还有售出/锁定的卡密，保存会失败。
        </p>
      </div>
    </div>

    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="editing = null">取消</button>
      <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm" @click="save">保存</button>
    </template>
  </el-dialog>
</template>
