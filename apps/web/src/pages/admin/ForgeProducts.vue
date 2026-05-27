<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElDrawer, ElMessage } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

interface ForgeProductRow {
  typeKey: string;
  categoryKey: string;
  categoryName: string;
  typeName: string;
  price: number;
  agentPrice: number;
  displayPrice: number;
  stock: number;
  warrantyHours: number | null;
  emailCodeEnabled: boolean;
  enabled: boolean;
  sort: number;
  customName?: string | null;
  customCategoryName?: string | null;
  subtitle?: string | null;
  coverImage?: string | null;
  description?: string | null;
  highlights?: string | null;
  notice?: string | null;
  lastSyncAt?: string | null;
}

const loading = ref(false);
const syncing = ref(false);
const items = ref<ForgeProductRow[]>([]);
const editing = ref<Record<string, { displayPrice: string; sort: number }>>({});

async function load() {
  loading.value = true;
  try {
    items.value = (await api.forge.admin.listProducts()) as any;
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
    ElMessage.success(`已同步 ${(r as any).upserted} 款商品`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

async function toggleEnabled(item: ForgeProductRow) {
  try {
    await api.forge.admin.updateProduct(item.typeKey, { enabled: !item.enabled });
    item.enabled = !item.enabled;
    ElMessage.success(item.enabled ? '已上架' : '已下架');
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

async function savePrice(item: ForgeProductRow) {
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

async function saveSort(item: ForgeProductRow) {
  const v = Number(editing.value[item.typeKey].sort);
  if (!Number.isInteger(v)) return;
  try {
    await api.forge.admin.updateProduct(item.typeKey, { sort: v });
    item.sort = v;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || '更新失败');
  }
}

// ── 详情编辑抽屉 ────────────────────────────────────
const drawerVisible = ref(false);
const drawerSaving = ref(false);
const drawerTarget = ref<ForgeProductRow | null>(null);
const drawerForm = reactive({
  customName: '',
  customCategoryName: '',
  subtitle: '',
  coverImage: '',
  highlights: '', // 一行一条，保存时拼成 JSON 数组
  description: '',
  notice: '',
});

const drawerPreview = computed(() => {
  if (!drawerTarget.value) return null;
  return {
    typeName: drawerForm.customName || drawerTarget.value.typeName,
    categoryName: drawerForm.customCategoryName || drawerTarget.value.categoryName,
    subtitle: drawerForm.subtitle,
    coverImage: drawerForm.coverImage,
    highlights: drawerForm.highlights
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
});

function openDrawer(item: ForgeProductRow) {
  drawerTarget.value = item;
  drawerForm.customName = item.customName || '';
  drawerForm.customCategoryName = item.customCategoryName || '';
  drawerForm.subtitle = item.subtitle || '';
  drawerForm.coverImage = item.coverImage || '';
  drawerForm.description = item.description || '';
  drawerForm.notice = item.notice || '';
  // highlights 在数据库里是 JSON 字符串，编辑时一行一条更友好
  let arr: string[] = [];
  if (item.highlights) {
    try {
      const j = JSON.parse(item.highlights);
      if (Array.isArray(j)) arr = j.map((x) => String(x));
    } catch {
      // 老数据是普通文本，按行拆
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
    await api.forge.admin.updateProduct(drawerTarget.value.typeKey, {
      customName: drawerForm.customName.trim() || null,
      customCategoryName: drawerForm.customCategoryName.trim() || null,
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

function resetDrawerAll() {
  drawerForm.customName = '';
  drawerForm.customCategoryName = '';
  drawerForm.subtitle = '';
  drawerForm.coverImage = '';
  drawerForm.description = '';
  drawerForm.highlights = '';
  drawerForm.notice = '';
}

function displayedName(it: ForgeProductRow) {
  return it.customName || it.typeName;
}

function hasCustom(it: ForgeProductRow) {
  return !!(
    it.customName ||
    it.customCategoryName ||
    it.subtitle ||
    it.coverImage ||
    it.description ||
    it.highlights ||
    it.notice
  );
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="Cursorforge 商品" subtitle="从三方同步商品 → 设售价 / 自定义详情 → 上架到下单页">
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
    <p>· <b>售价 displayPrice</b>：用户用兑换码下单时按此扣余额（CNY）；agent_price 是我方调三方的成本。</p>
    <p>· <b>编辑详情</b>：点行末「详情」按钮可自定义商品名、封面图、副标题、亮点、详细描述、购买须知，全部留空则回退到三方原始信息。</p>
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
          <th class="px-4 py-2.5 text-right font-medium">代理价 (¥)</th>
          <th class="px-4 py-2.5 text-right font-medium">售价 (¥)</th>
          <th class="px-4 py-2.5 text-center font-medium">库存</th>
          <th class="px-4 py-2.5 text-center font-medium">接码</th>
          <th class="px-4 py-2.5 text-center font-medium">排序</th>
          <th class="px-4 py-2.5 text-center font-medium">上架</th>
          <th class="px-4 py-2.5 text-center font-medium">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in items"
          :key="it.typeKey"
          class="border-t border-ink-100"
        >
          <td class="px-4 py-3">
            <div class="flex items-start gap-3">
              <img
                v-if="it.coverImage"
                :src="it.coverImage"
                alt=""
                class="w-10 h-10 rounded object-cover bg-ink-100 shrink-0"
                @error="(($event.target as any).style.display = 'none')"
              />
              <div class="min-w-0">
                <div class="font-medium text-ink-900 flex items-center gap-1.5">
                  {{ displayedName(it) }}
                  <span
                    v-if="it.customName"
                    class="text-[10px] px-1 py-0.5 rounded bg-violet-50 text-violet-700"
                    title="已自定义名称"
                  >自定义</span>
                </div>
                <div class="text-xs text-ink-500 mt-0.5">
                  <span class="font-mono">{{ it.typeKey }}</span>
                  · {{ it.customCategoryName || it.categoryName }}
                  <span v-if="it.warrantyHours"> · 质保 {{ it.warrantyHours }}h</span>
                </div>
                <div v-if="it.subtitle" class="text-xs text-ink-600 mt-1 line-clamp-1">{{ it.subtitle }}</div>
              </div>
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
          <td class="px-4 py-3 text-center">
            <button
              class="text-xs px-2.5 py-1 rounded-md border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 transition"
              @click="openDrawer(it)"
            >
              {{ hasCustom(it) ? '已自定义 · 编辑' : '编辑详情' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 详情编辑抽屉 -->
  <ElDrawer
    v-model="drawerVisible"
    title="编辑商品详情"
    direction="rtl"
    size="640px"
    :destroy-on-close="true"
  >
    <div v-if="drawerTarget" class="space-y-5">
      <div class="text-xs text-ink-500 bg-ink-50/60 border border-ink-100 rounded p-3">
        <div>三方原始：<span class="font-medium text-ink-800">{{ drawerTarget.typeName }}</span> · <span class="font-mono">{{ drawerTarget.typeKey }}</span></div>
        <div class="mt-0.5">分类：{{ drawerTarget.categoryName }} · 三方代理价 ¥{{ Number(drawerTarget.agentPrice).toFixed(2) }} · 库存 {{ drawerTarget.stock }}</div>
        <p class="mt-1 text-ink-400">所有字段留空则前台回退到三方原始信息。</p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1">自定义商品名</label>
          <input
            v-model="drawerForm.customName"
            maxlength="128"
            :placeholder="drawerTarget.typeName"
            class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-ink-700 block mb-1">自定义分类名</label>
          <input
            v-model="drawerForm.customCategoryName"
            maxlength="128"
            :placeholder="drawerTarget.categoryName"
            class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
          />
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">副标题（一句卖点）</label>
        <input
          v-model="drawerForm.subtitle"
          maxlength="255"
          placeholder="例：开通即用 · 无需账号绑定 · 30 天质保"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
        <p class="text-[11px] text-ink-400 mt-1">列表卡片 + 详情页都会显示</p>
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
            class="max-h-32 rounded border border-ink-100 bg-ink-50/50"
            @error="(($event.target as any).style.display = 'none')"
          />
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">亮点 / 卖点（一行一条）</label>
        <textarea
          v-model="drawerForm.highlights"
          rows="4"
          placeholder="秒到账&#10;30 天售后质保&#10;支持验证码代收&#10;7×24 客服"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded font-mono"
        />
        <p class="text-[11px] text-ink-400 mt-1">详情页顶部以圆点列表展示。可空。</p>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">详细描述</label>
        <textarea
          v-model="drawerForm.description"
          rows="6"
          placeholder="支持普通文本 / 简单 HTML。可介绍商品特性、使用步骤、限制等。"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
        <p class="text-[11px] text-ink-400 mt-1">详情页中段渲染。换行自动保留。</p>
      </div>

      <div>
        <label class="text-xs font-medium text-ink-700 block mb-1">购买须知</label>
        <textarea
          v-model="drawerForm.notice"
          rows="3"
          placeholder="例：本商品为虚拟数字商品，下单成功后即视为接受不退不换。"
          class="w-full px-2.5 py-2 text-sm border border-ink-200 rounded"
        />
        <p class="text-[11px] text-ink-400 mt-1">详情页底部以黄色提示框展示</p>
      </div>

      <!-- 预览 -->
      <div v-if="drawerPreview" class="border-t border-ink-100 pt-4">
        <div class="text-[11px] uppercase tracking-widest text-ink-500 mb-2">用户端预览</div>
        <div class="card p-4 bg-white border border-ink-100">
          <div class="flex items-start gap-3">
            <img
              v-if="drawerPreview.coverImage"
              :src="drawerPreview.coverImage"
              class="w-16 h-16 rounded object-cover bg-ink-50 shrink-0"
              @error="(($event.target as any).style.display = 'none')"
            />
            <div class="min-w-0">
              <div class="text-xs text-ink-500">{{ drawerPreview.categoryName }}</div>
              <div class="text-base font-semibold text-ink-900 mt-0.5">{{ drawerPreview.typeName }}</div>
              <div v-if="drawerPreview.subtitle" class="text-sm text-ink-600 mt-1">{{ drawerPreview.subtitle }}</div>
            </div>
          </div>
          <ul v-if="drawerPreview.highlights.length" class="mt-3 space-y-1 text-xs text-ink-600">
            <li v-for="(h, i) in drawerPreview.highlights" :key="i" class="flex gap-1.5">
              <span class="text-emerald-500">✓</span><span>{{ h }}</span>
            </li>
          </ul>
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
        <button
          class="ml-auto text-xs text-rose-500 hover:underline"
          @click="resetDrawerAll"
        >清空所有自定义</button>
      </div>
    </div>
  </ElDrawer>
</template>
