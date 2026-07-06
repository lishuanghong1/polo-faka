<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElDrawer, ElMessage } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import RichTextEditor from '@/components/RichTextEditor.vue';
import RichContent from '@/components/RichContent.vue';

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const onResize = () => { viewportWidth.value = window.innerWidth; };
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
const drawerSize = computed(() => (viewportWidth.value < 768 ? '100%' : '640px'));

interface QuotaPackageRow {
  packageKey: string;
  name: string;
  quotaUsd: number;
  lineKey: string;
  agentPrice: number;
  retailPrice: number;
  displayPrice: number;
  enabled: boolean;
  sort: number;
  pointsAwardEnabled: boolean;
  pointsPayEnabled: boolean;
  pointsAwardRate: number | null;
  customName?: string | null;
  subtitle?: string | null;
  coverImage?: string | null;
  description?: string | null;
  highlights?: string | null;
  notice?: string | null;
  lastSyncAt?: string | null;
}

const loading = ref(false);
const syncing = ref(false);
const items = ref<QuotaPackageRow[]>([]);
const editing = ref<
  Record<string, { displayPrice: string; sort: number; pointsAwardRatePct: string }>
>({});

async function load() {
  loading.value = true;
  try {
    items.value = (await api.forge.quota.admin.listPackages()) as any;
    for (const it of items.value) {
      editing.value[it.packageKey] = {
        displayPrice: String(it.displayPrice),
        sort: it.sort,
        pointsAwardRatePct:
          it.pointsAwardRate === null || it.pointsAwardRate === undefined
            ? ''
            : String(+(Number(it.pointsAwardRate) * 100).toFixed(2)),
      };
    }
  } finally {
    loading.value = false;
  }
}

async function syncFromUpstream() {
  syncing.value = true;
  try {
    const r = await api.forge.quota.admin.syncPackages();
    ElMessage.success(`已同步 ${(r as any).upserted} 款额度包`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function toggleEnabled(item: QuotaPackageRow) {
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { enabled: !item.enabled });
    item.enabled = !item.enabled;
    ElMessage.success(item.enabled ? '已上架' : '已下架');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function togglePointsAward(item: QuotaPackageRow) {
  const next = !item.pointsAwardEnabled;
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { pointsAwardEnabled: next });
    item.pointsAwardEnabled = next;
    ElMessage.success(next ? '已开启返积分' : '已关闭返积分');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function togglePointsPay(item: QuotaPackageRow) {
  const next = !item.pointsPayEnabled;
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { pointsPayEnabled: next });
    item.pointsPayEnabled = next;
    ElMessage.success(next ? '已允许积分支付' : '已关闭积分支付');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function savePointsAwardRate(item: QuotaPackageRow) {
  const raw = String(editing.value[item.packageKey].pointsAwardRatePct ?? '').trim();
  let rate: number | null;
  if (raw === '') {
    rate = null;
  } else {
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      ElMessage.warning('返积分倍率必须为 0-100');
      editing.value[item.packageKey].pointsAwardRatePct =
        item.pointsAwardRate === null || item.pointsAwardRate === undefined
          ? ''
          : String(+(Number(item.pointsAwardRate) * 100).toFixed(2));
      return;
    }
    rate = +(pct / 100).toFixed(4);
  }
  const prevPct =
    item.pointsAwardRate === null || item.pointsAwardRate === undefined
      ? ''
      : String(+(Number(item.pointsAwardRate) * 100).toFixed(2));
  if (raw === prevPct) return;
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { pointsAwardRate: rate });
    item.pointsAwardRate = rate;
    ElMessage.success('已保存返积分倍率');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function savePrice(item: QuotaPackageRow) {
  const v = Number(editing.value[item.packageKey].displayPrice);
  if (!Number.isFinite(v) || v < 0) {
    ElMessage.warning('售价必须为非负数字');
    return;
  }
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { displayPrice: v });
    item.displayPrice = v;
    ElMessage.success('已保存');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function saveSort(item: QuotaPackageRow) {
  const v = Number(editing.value[item.packageKey].sort);
  if (!Number.isInteger(v)) return;
  try {
    await api.forge.quota.admin.updatePackage(item.packageKey, { sort: v });
    item.sort = v;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

// ── 详情编辑抽屉 ────────────────────────────────────
const drawerVisible = ref(false);
const drawerSaving = ref(false);
const drawerTarget = ref<QuotaPackageRow | null>(null);
const coverLoadError = ref(false);
const drawerForm = reactive({
  customName: '',
  subtitle: '',
  coverImage: '',
  highlights: '',
  description: '',
  notice: '',
});

function openDrawer(item: QuotaPackageRow) {
  drawerTarget.value = item;
  drawerForm.customName = item.customName || '';
  drawerForm.subtitle = item.subtitle || '';
  drawerForm.coverImage = item.coverImage || '';
  drawerForm.description = item.description || '';
  drawerForm.notice = item.notice || '';
  let arr: string[] = [];
  if (item.highlights) {
    try {
      const j = JSON.parse(item.highlights);
      if (Array.isArray(j)) arr = j.map((x) => String(x));
    } catch {
      arr = item.highlights.split(/\r?\n/);
    }
  }
  drawerForm.highlights = arr.join('\n');
  drawerVisible.value = true;
}

async function saveDrawer() {
  if (!drawerTarget.value) return;
  const highlightsArr = drawerForm.highlights
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  drawerSaving.value = true;
  try {
    await api.forge.quota.admin.updatePackage(drawerTarget.value.packageKey, {
      customName: drawerForm.customName.trim() || null,
      subtitle: drawerForm.subtitle.trim() || null,
      coverImage: drawerForm.coverImage.trim() || null,
      description: drawerForm.description.trim() || null,
      highlights: highlightsArr.length ? JSON.stringify(highlightsArr) : null,
      notice: drawerForm.notice.trim() || null,
    });
    ElMessage.success('已保存详情');
    drawerVisible.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '保存失败');
  } finally {
    drawerSaving.value = false;
  }
}

function displayedName(it: QuotaPackageRow) {
  return it.customName || it.name;
}

function marginOf(it: QuotaPackageRow): { profit: string; margin: string; positive: boolean } {
  const profit = it.displayPrice - it.agentPrice;
  const margin = it.displayPrice > 0 ? (profit / it.displayPrice) * 100 : 0;
  return { profit: profit.toFixed(2), margin: margin.toFixed(1), positive: profit >= 0 };
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="额度包" subtitle="从三方同步中转 Key 额度包 → 设售价 → 上架；用户购买后即时发兑换码">
    <template #actions>
      <button
        class="px-3.5 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm disabled:opacity-50"
        :disabled="syncing"
        @click="syncFromUpstream"
      >
        {{ syncing ? '同步中…' : '从三方同步额度包' }}
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 bg-sky-50/40 border border-sky-200 text-xs text-sky-900 mb-4 leading-relaxed">
    <p>· 额度包 = 三方「中转 Key」的美元额度商品，交付物是<b>兑换码</b>；买家拿码到 forge 官网核销，面值自动充入其中转 Key。</p>
    <p>· <b>代理价 agent_price</b> 是我方进货成本；<b>零售价 retail_price</b> 是官方参考价；<b>售价</b>是本站卖给用户的价格。</p>
    <p>· 需要三方运营给额度包开启「OpenAPI 出库」白名单，否则下单会报 PACKAGE_NOT_OPENAPI_ENABLED。</p>
  </div>

  <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中…</div>
  <div v-else-if="!items.length" class="card p-10 text-center text-ink-400 text-sm">
    暂无额度包。请先点击右上角「从三方同步额度包」。
  </div>

  <div v-else class="card p-0 overflow-hidden">
   <div class="overflow-auto max-h-[calc(100vh-300px)]">
    <table class="w-full text-sm min-w-[1360px]">
      <thead class="bg-ink-50 text-ink-600 sticky top-0 z-10">
        <tr>
          <th class="px-4 py-2.5 text-left font-medium">额度包</th>
          <th class="px-4 py-2.5 text-right font-medium">面值 ($)</th>
          <th class="px-4 py-2.5 text-right font-medium">代理价 (¥)</th>
          <th class="px-4 py-2.5 text-right font-medium">零售价 (¥)</th>
          <th class="px-4 py-2.5 text-right font-medium">售价 (¥)</th>
          <th class="px-4 py-2.5 text-right font-medium">毛利</th>
          <th class="px-4 py-2.5 text-center font-medium">返积分</th>
          <th class="px-4 py-2.5 text-center font-medium" title="留空 = 默认 10%">返倍率(%)</th>
          <th class="px-4 py-2.5 text-center font-medium">积分支付</th>
          <th class="px-4 py-2.5 text-center font-medium">排序</th>
          <th class="px-4 py-2.5 text-center font-medium">上架</th>
          <th class="px-4 py-2.5 text-center font-medium">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in items"
          :key="it.packageKey"
          class="border-t border-ink-100"
        >
          <td class="px-4 py-2">
            <div class="flex items-start gap-3">
              <div
                v-if="it.coverImage"
                class="w-10 h-10 rounded overflow-hidden bg-ink-100 shrink-0 relative"
              >
                <img
                  :src="it.coverImage"
                  alt=""
                  referrerpolicy="no-referrer"
                  class="w-full h-full object-cover"
                  @error="(($event.target as HTMLImageElement).style.display = 'none')"
                />
              </div>
              <div class="min-w-0">
                <div class="font-medium text-ink-900 flex items-center gap-1.5 max-w-[320px] truncate">
                  {{ displayedName(it) }}
                  <span
                    v-if="it.customName"
                    class="text-[10px] px-1 py-0.5 rounded bg-violet-50 text-violet-700"
                    title="已自定义名称"
                  >自定义</span>
                </div>
                <div class="text-xs text-ink-500 mt-0.5 whitespace-nowrap">
                  <span class="font-mono">{{ it.packageKey }}</span>
                  · 线路 <span class="font-mono">{{ it.lineKey }}</span>
                </div>
                <div v-if="it.subtitle" class="text-xs text-ink-600 mt-1 line-clamp-1">{{ it.subtitle }}</div>
              </div>
            </div>
          </td>
          <td class="px-4 py-2 text-right font-mono text-emerald-700 whitespace-nowrap">${{ Number(it.quotaUsd).toFixed(2) }}</td>
          <td class="px-4 py-2 text-right font-mono text-ink-700 whitespace-nowrap">{{ Number(it.agentPrice).toFixed(2) }}</td>
          <td class="px-4 py-2 text-right font-mono text-ink-500 whitespace-nowrap">{{ Number(it.retailPrice).toFixed(2) }}</td>
          <td class="px-4 py-2">
            <div class="flex items-center gap-1 justify-end">
              <input
                v-model="editing[it.packageKey].displayPrice"
                type="number"
                step="0.01"
                min="0"
                class="w-20 px-2 py-1 border border-ink-200 rounded text-right text-sm"
                @blur="savePrice(it)"
              />
            </div>
          </td>
          <td class="px-4 py-2 text-right whitespace-nowrap text-xs">
            <span :class="marginOf(it).positive ? 'text-emerald-700' : 'text-rose-600'">
              {{ marginOf(it).positive ? '+' : '' }}¥{{ marginOf(it).profit }}
              <span class="text-ink-400">({{ marginOf(it).margin }}%)</span>
            </span>
          </td>
          <td class="px-4 py-2 text-center">
            <label class="inline-flex items-center cursor-pointer" :title="it.pointsAwardEnabled ? '购买后可返积分' : '购买不返积分'">
              <input
                type="checkbox"
                :checked="it.pointsAwardEnabled"
                @change="togglePointsAward(it)"
              />
            </label>
          </td>
          <td class="px-4 py-2 text-center">
            <input
              v-model="editing[it.packageKey].pointsAwardRatePct"
              type="number"
              min="0"
              max="100"
              step="0.5"
              placeholder="默认10"
              class="w-16 px-2 py-1 border border-ink-200 rounded text-center text-sm disabled:bg-ink-50 disabled:text-ink-400"
              :disabled="!it.pointsAwardEnabled"
              @blur="savePointsAwardRate(it)"
            />
          </td>
          <td class="px-4 py-2 text-center">
            <label class="inline-flex items-center cursor-pointer" :title="it.pointsPayEnabled ? '允许积分支付' : '不允许积分支付'">
              <input
                type="checkbox"
                :checked="it.pointsPayEnabled"
                @change="togglePointsPay(it)"
              />
            </label>
          </td>
          <td class="px-4 py-2 text-center">
            <input
              v-model="editing[it.packageKey].sort"
              type="number"
              class="w-14 px-2 py-1 border border-ink-200 rounded text-center text-sm"
              @blur="saveSort(it)"
            />
          </td>
          <td class="px-4 py-2 text-center">
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                :checked="it.enabled"
                @change="toggleEnabled(it)"
              />
            </label>
          </td>
          <td class="px-4 py-2 text-center whitespace-nowrap">
            <button
              class="text-xs px-2.5 py-1 rounded-md border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 transition"
              @click="openDrawer(it)"
            >
              编辑详情
            </button>
          </td>
        </tr>
      </tbody>
    </table>
   </div>
  </div>

  <!-- 详情编辑抽屉 -->
  <ElDrawer
    v-model="drawerVisible"
    title="编辑额度包详情"
    direction="rtl"
    :size="drawerSize"
    :destroy-on-close="true"
  >
    <div v-if="drawerTarget" class="space-y-5">
      <div class="text-xs text-ink-500 bg-ink-50/60 border border-ink-100 rounded p-3">
        <div>三方原始：<span class="font-medium text-ink-800">{{ drawerTarget.name }}</span> · <span class="font-mono">{{ drawerTarget.packageKey }}</span></div>
        <div class="mt-0.5">
          面值 ${{ Number(drawerTarget.quotaUsd).toFixed(2) }} · 线路 {{ drawerTarget.lineKey }} ·
          代理价 ¥{{ Number(drawerTarget.agentPrice).toFixed(2) }} · 官方零售 ¥{{ Number(drawerTarget.retailPrice).toFixed(2) }}
        </div>
        <p class="mt-1 text-ink-400">所有字段留空则前台回退到三方原始信息。</p>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">自定义名称</label>
        <input
          v-model="drawerForm.customName"
          maxlength="128"
          :placeholder="drawerTarget.name"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">副标题（一句卖点）</label>
        <input
          v-model="drawerForm.subtitle"
          maxlength="255"
          placeholder="例：秒发码 · 官网核销即到账 · 未核销可售后"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">封面图 URL</label>
        <input
          v-model="drawerForm.coverImage"
          maxlength="512"
          placeholder="https://..."
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded font-mono text-xs"
        />
        <div v-if="drawerForm.coverImage" class="mt-2">
          <img
            :src="drawerForm.coverImage"
            alt="封面预览"
            referrerpolicy="no-referrer"
            class="max-h-32 rounded border border-ink-100 bg-ink-50/50"
            @load="coverLoadError = false"
            @error="coverLoadError = true"
          />
          <p v-if="coverLoadError" class="mt-1 text-[11px] text-rose-600">
            图片加载失败，请换一个稳定的图床再试。
          </p>
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">亮点 / 卖点（一行一条）</label>
        <textarea
          v-model="drawerForm.highlights"
          rows="4"
          placeholder="秒发兑换码&#10;官网核销自动到账&#10;没有 Key 自动创建&#10;7×24 客服"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded font-mono"
        />
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">详细描述（支持富文本）</label>
        <RichTextEditor v-model="drawerForm.description" height="280px" />
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">购买须知</label>
        <textarea
          v-model="drawerForm.notice"
          rows="3"
          placeholder="例：兑换码一经核销不退不换；请勿泄露兑换码。"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
      </div>

      <!-- 预览 -->
      <div class="border-t border-ink-100 pt-4">
        <div class="text-[11px] uppercase tracking-widest text-ink-500 mb-2">用户端预览</div>
        <div class="card p-4 bg-white border border-ink-100">
          <div class="flex items-start gap-3">
            <img
              v-if="drawerForm.coverImage"
              :src="drawerForm.coverImage"
              class="w-16 h-16 rounded object-cover bg-ink-50 shrink-0"
              @error="(($event.target as any).style.display = 'none')"
            />
            <div class="min-w-0">
              <div class="text-xs text-ink-500">中转额度包</div>
              <div class="text-base font-semibold text-ink-900 mt-0.5">{{ drawerForm.customName || drawerTarget.name }}</div>
              <div class="text-sm text-ink-600 mt-1">
                {{ drawerForm.subtitle || `面值 $${drawerTarget.quotaUsd} · 兑换码发货，官网核销即到账` }}
              </div>
            </div>
          </div>
          <RichContent v-if="drawerForm.description" :html="drawerForm.description" class="mt-3 pt-3 border-t border-ink-100" />
        </div>
      </div>

      <div class="flex items-center gap-2 pt-2 border-t border-ink-100">
        <button
          class="px-4 py-2 rounded-md brand-gradient text-white text-sm disabled:opacity-50"
          :disabled="drawerSaving"
          @click="saveDrawer"
        >{{ drawerSaving ? '保存中…' : '保存' }}</button>
        <button
          class="px-4 py-2 rounded-md border border-ink-200 text-ink-700 text-sm hover:bg-ink-50"
          @click="drawerVisible = false"
        >取消</button>
      </div>
    </div>
  </ElDrawer>
</template>
