<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api, { type TxtCategory, type TxtDocListItem } from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import AdminSearchInput from '@/components/admin/AdminSearchInput.vue';
import DataTable from '@/components/admin/DataTable.vue';

const pageSize = 20;

// ── 分类 ──
const cats = ref<TxtCategory[]>([]);
const activeCatId = ref<number | null>(null);
const catsLoading = ref(false);

// ── 列表 ──
const list = ref<TxtDocListItem[]>([]);
const total = ref(0);
const page = ref(1);
const keyword = ref('');
const searchContent = ref(false);
const loading = ref(false);
const selected = ref<number[]>([]);

// ── 弹窗 ──
type CatForm = { id?: number; name: string; remark: string; sort: number };
type DocForm = {
  id?: number;
  categoryId: number;
  title: string;
  content: string;
  remark: string;
  sort: number;
};
const catForm = ref<CatForm | null>(null);
const catSaving = ref(false);
const docForm = ref<DocForm | null>(null);
const docLoading = ref(false);
const docSaving = ref(false);
const moveOpen = ref(false);
const moveTarget = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

const totalDocs = computed(() => cats.value.reduce((s, c) => s + c.docCount, 0));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const activeCat = computed(() => cats.value.find((c) => c.id === activeCatId.value) || null);
const allChecked = computed(
  () => list.value.length > 0 && selected.value.length === list.value.length,
);
/** 正文长度用 string.length 即可，逐字节统计在几 MB 的文本上会卡输入 */
const contentChars = computed(() => docForm.value?.content.length ?? 0);

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(s: string) {
  return new Date(s).toLocaleString();
}

// ───────────────────── 加载 ─────────────────────

async function loadCats() {
  catsLoading.value = true;
  try {
    cats.value = await api.admin.txtCategories();
    // 当前分类被删掉时回落到「全部」
    if (activeCatId.value && !cats.value.some((c) => c.id === activeCatId.value)) {
      activeCatId.value = null;
    }
  } finally {
    catsLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  selected.value = [];
  try {
    const res = await api.admin.txtDocs({
      categoryId: activeCatId.value ?? undefined,
      keyword: keyword.value.trim() || undefined,
      searchContent: searchContent.value || undefined,
      page: page.value,
      pageSize,
    });
    list.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function reload() {
  await Promise.all([loadCats(), load()]);
}

onMounted(reload);

function search() {
  page.value = 1;
  load();
}

function go(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  load();
}

function selectCat(id: number | null) {
  activeCatId.value = id;
  page.value = 1;
  load();
}

// ───────────────────── 选择 ─────────────────────

function toggleAll() {
  selected.value = allChecked.value ? [] : list.value.map((d) => d.id);
}

function toggleOne(id: number) {
  const i = selected.value.indexOf(id);
  if (i >= 0) selected.value.splice(i, 1);
  else selected.value.push(id);
}

// ───────────────────── 分类增删改 ─────────────────────

function newCat() {
  catForm.value = { name: '', remark: '', sort: 0 };
}

function editCat(c: TxtCategory) {
  catForm.value = { id: c.id, name: c.name, remark: c.remark || '', sort: c.sort };
}

async function saveCat() {
  const f = catForm.value;
  if (!f) return;
  if (!f.name.trim()) {
    ElMessage.warning('请填写分类名');
    return;
  }
  // 生产环境 ValidationPipe 开了 forbidNonWhitelisted，只能传 DTO 声明过的字段
  const payload = { name: f.name.trim(), remark: f.remark.trim(), sort: f.sort };
  catSaving.value = true;
  try {
    if (f.id) await api.admin.txtCategoryUpdate(f.id, payload);
    else await api.admin.txtCategoryCreate(payload);
    ElMessage.success('保存成功');
    catForm.value = null;
    await reload();
  } finally {
    catSaving.value = false;
  }
}

async function removeCat(c: TxtCategory) {
  await ElMessageBox.confirm(`确认删除分类「${c.name}」？`, '提示', { type: 'warning' });
  await api.admin.txtCategoryRemove(c.id);
  ElMessage.success('已删除');
  await reload();
}

// ───────────────────── 文本增删改 ─────────────────────

function newDoc() {
  const categoryId = activeCatId.value ?? cats.value[0]?.id;
  if (!categoryId) {
    ElMessage.warning('请先建一个分类');
    return;
  }
  docForm.value = { categoryId, title: '', content: '', remark: '', sort: 0 };
}

async function openDoc(d: TxtDocListItem) {
  docLoading.value = true;
  // 先用列表里已有的字段把弹窗撑开，正文异步补
  docForm.value = {
    id: d.id,
    categoryId: d.categoryId,
    title: d.title,
    content: '',
    remark: d.remark || '',
    sort: d.sort,
  };
  try {
    const full = await api.admin.txtDocDetail(d.id);
    if (docForm.value?.id === d.id) docForm.value.content = full.content;
  } catch {
    docForm.value = null;
  } finally {
    docLoading.value = false;
  }
}

async function saveDoc() {
  const f = docForm.value;
  if (!f) return;
  if (!f.title.trim()) {
    ElMessage.warning('请填写标题');
    return;
  }
  docSaving.value = true;
  try {
    const payload = {
      categoryId: f.categoryId,
      title: f.title.trim(),
      content: f.content,
      remark: f.remark.trim(),
      sort: f.sort,
    };
    if (f.id) await api.admin.txtDocUpdate(f.id, payload);
    else await api.admin.txtDocCreate(payload);
    ElMessage.success('保存成功');
    docForm.value = null;
    await reload();
  } finally {
    docSaving.value = false;
  }
}

async function removeDoc(d: TxtDocListItem) {
  await ElMessageBox.confirm(`确认删除「${d.title}」？`, '提示', { type: 'warning' });
  await api.admin.txtDocRemove(d.id);
  ElMessage.success('已删除');
  await reload();
}

async function bulkRemove() {
  const ids = [...selected.value];
  await ElMessageBox.confirm(`确认删除选中的 ${ids.length} 条文本？`, '批量删除', { type: 'warning' });
  const res = await api.admin.txtDocsBulkRemove(ids);
  ElMessage.success(`已删除 ${res.removed} 条`);
  await reload();
}

function openMove() {
  moveTarget.value = cats.value.find((c) => c.id !== activeCatId.value)?.id ?? cats.value[0]?.id ?? null;
  moveOpen.value = true;
}

async function doMove() {
  if (!moveTarget.value) return;
  const res = await api.admin.txtDocsMove([...selected.value], moveTarget.value);
  ElMessage.success(`已移动 ${res.moved} 条`);
  moveOpen.value = false;
  await reload();
}

// ───────────────────── 上传 / 下载 ─────────────────────

function pickFiles() {
  if (!activeCatId.value) {
    ElMessage.warning('请先在左侧选中一个具体分类，再上传');
    return;
  }
  fileInput.value?.click();
}

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length || !activeCatId.value) return;

  uploading.value = true;
  try {
    const res = await api.admin.txtDocsUpload(activeCatId.value, files);
    if (res.failed) {
      const first = res.results.find((r) => !r.ok);
      ElMessage.warning(`成功 ${res.succeeded} 个，失败 ${res.failed} 个：${first?.error || ''}`);
    } else {
      // 顺带回报识别到的编码，GBK 文件能一眼看出来是转过码的
      const encodings = [...new Set(res.results.map((r) => r.encoding).filter(Boolean))];
      ElMessage.success(`导入成功 ${res.succeeded} 个（编码 ${encodings.join(' / ')}）`);
    }
    await reload();
  } finally {
    uploading.value = false;
  }
}

async function download(d: TxtDocListItem) {
  const blob = await api.admin.txtDocDownload(d.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = d.filename || `${d.title}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <AdminPageHeader title="TXT 文本库" :subtitle="`${cats.length} 个分类 · ${totalDocs} 条文本`">
    <template #actions>
      <button
        class="px-3 py-1.5 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 text-sm disabled:opacity-50"
        :disabled="uploading"
        @click="pickFiles"
      >
        {{ uploading ? '上传中…' : '上传 .txt' }}
      </button>
      <button
        class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        @click="newDoc"
      >
        + 新建文本
      </button>
    </template>
  </AdminPageHeader>

  <input
    ref="fileInput"
    type="file"
    accept=".txt"
    multiple
    class="hidden"
    @change="onFilesPicked"
  />

  <div class="flex flex-col lg:flex-row gap-4 items-start">
    <!-- 左：分类 -->
    <aside class="card p-2 w-full lg:w-56 shrink-0">
      <div class="flex items-center justify-between px-2 py-1.5">
        <span class="text-[11px] font-semibold tracking-widest uppercase text-ink-400">分类</span>
        <button class="text-ink-400 hover:text-brand-700 text-lg leading-none" title="新建分类" @click="newCat">
          +
        </button>
      </div>

      <div v-if="catsLoading" class="p-2 space-y-2">
        <div v-for="i in 4" :key="i" class="skeleton h-8 rounded-lg" />
      </div>
      <div v-else class="space-y-0.5">
        <button
          class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors"
          :class="activeCatId === null ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink-600 hover:bg-ink-50'"
          @click="selectCat(null)"
        >
          <span class="flex-1 truncate">全部</span>
          <span class="text-xs text-ink-400">{{ totalDocs }}</span>
        </button>

        <div v-for="c in cats" :key="c.id" class="group relative">
          <button
            class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors"
            :class="activeCatId === c.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink-600 hover:bg-ink-50'"
            :title="c.remark || c.name"
            @click="selectCat(c.id)"
          >
            <span class="flex-1 truncate">{{ c.name }}</span>
            <span class="text-xs text-ink-400 group-hover:opacity-0 transition-opacity">{{ c.docCount }}</span>
          </button>
          <div class="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
            <button class="px-1 text-xs text-ink-400 hover:text-brand-700" title="重命名" @click.stop="editCat(c)">改</button>
            <button class="px-1 text-xs text-ink-400 hover:text-rose-600" title="删除" @click.stop="removeCat(c)">删</button>
          </div>
        </div>

        <div v-if="!cats.length" class="px-2.5 py-6 text-center text-xs text-ink-400">
          还没有分类，点右上角 + 新建
        </div>
      </div>
    </aside>

    <!-- 右：文本列表 -->
    <section class="flex-1 min-w-0 w-full">
      <div class="card p-3 mb-4 admin-filter-bar">
        <AdminSearchInput
          v-model="keyword"
          placeholder="搜索标题 / 备注 / 文件名"
          @enter="search"
          @clear="search"
        />
        <label class="flex items-center gap-1.5 text-sm text-ink-600 shrink-0" title="正文搜索是全表扫描，数据量大时会慢">
          <input v-model="searchContent" type="checkbox" class="rounded" @change="search" />
          搜正文
        </label>
        <button class="px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="search">查询</button>
        <button class="px-3 h-9 border border-ink-200 text-ink-700 hover:bg-ink-50 rounded-lg text-sm shrink-0" @click="reload">刷新</button>
      </div>

      <div
        v-if="selected.length"
        class="card px-3 py-2 mb-3 flex items-center gap-3 text-sm bg-brand-50/50"
      >
        <span class="text-ink-700">已选 {{ selected.length }} 条</span>
        <button class="text-brand-700 hover:underline" @click="openMove">移动到分类</button>
        <button class="text-rose-600 hover:underline" @click="bulkRemove">批量删除</button>
        <button class="ml-auto text-ink-400 hover:text-ink-700" @click="selected = []">取消选择</button>
      </div>

      <DataTable
        :loading="loading"
        :is-empty="!list.length"
        :empty="activeCat ? `「${activeCat.name}」下还没有文本` : '暂无文本'"
        min-width="1000px"
      >
        <thead>
          <tr>
            <th style="width: 40px">
              <input type="checkbox" class="rounded" :checked="allChecked" @change="toggleAll" />
            </th>
            <th style="width: 60px">ID</th>
            <th style="width: 200px">标题</th>
            <th>摘要</th>
            <th style="width: 110px">分类</th>
            <th class="!text-right" style="width: 90px">大小</th>
            <th style="width: 150px">更新时间</th>
            <th class="!text-right" style="width: 150px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in list" :key="d.id" class="cursor-pointer" @click="openDoc(d)">
            <td @click.stop>
              <input
                type="checkbox"
                class="rounded"
                :checked="selected.includes(d.id)"
                @change="toggleOne(d.id)"
              />
            </td>
            <td class="text-ink-400 font-mono text-xs">#{{ d.id }}</td>
            <td class="font-medium text-ink-900">
              <div class="truncate max-w-[200px]" :title="d.title">{{ d.title }}</div>
              <div v-if="d.filename" class="text-[11px] text-ink-400 font-mono truncate max-w-[200px]">
                {{ d.filename }}
              </div>
            </td>
            <td class="text-ink-500 text-xs !whitespace-normal">
              <div class="line-clamp-2">{{ d.preview || '（空文本）' }}</div>
            </td>
            <td class="text-ink-600 text-xs">{{ d.category.name }}</td>
            <td class="text-right text-ink-600 font-mono text-xs">{{ fmtSize(d.size) }}</td>
            <td class="text-ink-500 text-xs">{{ fmtTime(d.updatedAt) }}</td>
            <td class="text-right whitespace-nowrap" @click.stop>
              <button class="text-brand-700 hover:underline text-sm mr-3" @click="openDoc(d)">查看</button>
              <button class="text-ink-500 hover:text-brand-700 text-sm mr-3" @click="download(d)">下载</button>
              <button class="text-ink-500 hover:text-rose-600 text-sm" @click="removeDoc(d)">删除</button>
            </td>
          </tr>
        </tbody>
      </DataTable>

      <div v-if="total > pageSize" class="mt-3 flex items-center justify-between text-xs text-ink-500">
        <span>共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-1">
          <button
            class="px-2.5 py-1 rounded border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="page <= 1"
            @click="go(page - 1)"
          >上一页</button>
          <button
            class="px-2.5 py-1 rounded border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="page >= totalPages"
            @click="go(page + 1)"
          >下一页</button>
        </div>
      </div>
    </section>
  </div>

  <!-- 分类弹窗 -->
  <el-dialog
    :model-value="!!catForm"
    width="420px"
    :title="catForm?.id ? '编辑分类' : '新建分类'"
    @update:model-value="(v: boolean) => !v && (catForm = null)"
    @close="catForm = null"
  >
    <div v-if="catForm" class="space-y-3 text-sm">
      <div>
        <label class="block text-xs text-ink-500 mb-1">分类名</label>
        <input v-model="catForm.name" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="例如：使用教程" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">备注（可选）</label>
        <input v-model="catForm.remark" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
      <div>
        <label class="block text-xs text-ink-500 mb-1">排序（大的在前）</label>
        <input v-model.number="catForm.sort" type="number" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="catForm = null">取消</button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm disabled:opacity-50"
        :disabled="catSaving"
        @click="saveCat"
      >{{ catSaving ? '保存中…' : '保存' }}</button>
    </template>
  </el-dialog>

  <!-- 文本编辑弹窗 -->
  <el-dialog
    :model-value="!!docForm"
    width="820px"
    top="6vh"
    :title="docForm?.id ? `编辑文本 #${docForm.id}` : '新建文本'"
    @update:model-value="(v: boolean) => !v && (docForm = null)"
    @close="docForm = null"
  >
    <div v-if="docForm" class="space-y-3 text-sm">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs text-ink-500 mb-1">标题</label>
          <input v-model="docForm.title" class="w-full px-3 py-2 border border-ink-200 rounded-lg" placeholder="例如：Cursor 换绑教程" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">分类</label>
          <select v-model.number="docForm.categoryId" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
            <option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs text-ink-500 mb-1">备注（可选）</label>
          <input v-model="docForm.remark" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
        <div>
          <label class="block text-xs text-ink-500 mb-1">排序（大的在前）</label>
          <input v-model.number="docForm.sort" type="number" class="w-full px-3 py-2 border border-ink-200 rounded-lg" />
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-ink-500">正文</label>
          <span class="text-[11px] text-ink-400">
            {{ docLoading ? '正在载入正文…' : `${contentChars.toLocaleString()} 字` }}
          </span>
        </div>
        <textarea
          v-model="docForm.content"
          rows="18"
          spellcheck="false"
          :disabled="docLoading"
          class="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs leading-relaxed resize-y disabled:bg-ink-50"
          placeholder="粘贴或输入纯文本内容…"
        />
      </div>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="docForm = null">取消</button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm disabled:opacity-50"
        :disabled="docSaving || docLoading"
        @click="saveDoc"
      >{{ docSaving ? '保存中…' : '保存' }}</button>
    </template>
  </el-dialog>

  <!-- 移动分类弹窗 -->
  <el-dialog
    v-model="moveOpen"
    width="380px"
    title="移动到分类"
    @close="moveOpen = false"
  >
    <div class="space-y-3 text-sm">
      <p class="text-ink-500 text-xs">将选中的 {{ selected.length }} 条文本移动到：</p>
      <select v-model.number="moveTarget" class="w-full px-3 py-2 border border-ink-200 rounded-lg bg-white">
        <option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}（{{ c.docCount }}）</option>
      </select>
    </div>
    <template #footer>
      <button class="px-4 py-1.5 mr-2 border border-ink-200 rounded-lg text-sm hover:bg-ink-50" @click="moveOpen = false">取消</button>
      <button
        class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-white text-sm disabled:opacity-50"
        :disabled="!moveTarget"
        @click="doMove"
      >移动</button>
    </template>
  </el-dialog>
</template>
