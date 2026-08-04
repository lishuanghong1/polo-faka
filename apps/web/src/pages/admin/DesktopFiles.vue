<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

type Kind = 'exe' | 'dmg';

interface FileInfo {
  kind: Kind;
  name: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
  url: string;
}

const version = ref('');
const loading = ref(false);
const uploading = ref<Kind | null>(null);
const files = ref<FileInfo[]>([]);

const slots: Array<{ kind: Kind; title: string; hint: string; accept: string }> = [
  {
    kind: 'exe',
    title: 'Windows · polo.exe',
    hint: '上传后前台显示为 Windows 下载',
    accept: '.exe,application/x-msdownload,application/octet-stream',
  },
  {
    kind: 'dmg',
    title: 'macOS · polo.dmg',
    hint: '上传后前台显示为 macOS 下载',
    accept: '.dmg,application/x-apple-diskimage,application/octet-stream',
  },
];

function fmtSize(n: number) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('zh-CN', { hour12: false });
}

function fileOf(kind: Kind) {
  return files.value.find((f) => f.kind === kind);
}

async function load() {
  loading.value = true;
  try {
    const r = await api.admin.desktopFilesStatus();
    files.value = r.files || [];
    if (r.version) version.value = r.version;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onPick(kind: Kind, ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const lower = file.name.toLowerCase();
  if (kind === 'exe' && !lower.endsWith('.exe')) {
    ElMessage.error('请上传 .exe 文件');
    return;
  }
  if (kind === 'dmg' && !lower.endsWith('.dmg')) {
    ElMessage.error('请上传 .dmg 文件');
    return;
  }

  uploading.value = kind;
  try {
    const r = await api.admin.desktopFilesUpload(kind, file, version.value);
    files.value = r.files || [];
    if (r.version) version.value = r.version;
    ElMessage.success(`已上传 ${file.name}`);
  } catch (e: any) {
    ElMessage.error(e?.message || '上传失败');
  } finally {
    uploading.value = null;
  }
}

async function remove(kind: Kind) {
  const f = fileOf(kind);
  if (!f?.exists) return;
  await ElMessageBox.confirm(`删除 ${f.name}？前台将无法下载该平台。`, '删除安装包', {
    type: 'warning',
  });
  await api.admin.desktopFilesRemove(kind);
  ElMessage.success('已删除');
  await load();
}
</script>

<template>
  <AdminPageHeader
    title="桌面安装包"
    subtitle="上传 polo.exe / polo.dmg，前台「下载工具」页即可下载"
  >
    <template #actions>
      <a
        href="/tools/desktop"
        target="_blank"
        class="px-3 py-1.5 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50"
      >预览下载页</a>
      <button
        class="px-3 py-1.5 rounded-lg border border-ink-200 text-sm text-ink-700 hover:bg-ink-50"
        :disabled="loading"
        @click="load"
      >刷新</button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 md:p-5 mb-4">
    <label class="block text-xs text-ink-500 mb-1">版本号（可选，写入 latest.json）</label>
    <input
      v-model="version"
      class="w-full max-w-sm h-9 px-3 rounded-lg border border-ink-200 text-sm"
      placeholder="例如 1.0.0"
    />
    <p class="text-[11px] text-ink-400 mt-1.5">下次上传任一文件时会带上这个版本号。</p>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div
      v-for="slot in slots"
      :key="slot.kind"
      class="card p-5 border border-ink-100"
    >
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <div class="text-sm font-semibold text-ink-900">{{ slot.title }}</div>
          <div class="text-xs text-ink-500 mt-0.5">{{ slot.hint }}</div>
        </div>
        <span
          class="text-[11px] px-2 py-0.5 rounded-full border shrink-0"
          :class="fileOf(slot.kind)?.exists
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-ink-50 text-ink-500 border-ink-200'"
        >
          {{ fileOf(slot.kind)?.exists ? '已上传' : '未上传' }}
        </span>
      </div>

      <dl class="text-xs text-ink-600 space-y-1.5 mb-4">
        <div class="flex justify-between gap-3">
          <dt class="text-ink-400">文件名</dt>
          <dd class="font-mono">{{ fileOf(slot.kind)?.name || `polo.${slot.kind}` }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-ink-400">大小</dt>
          <dd>{{ fmtSize(fileOf(slot.kind)?.size || 0) }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-ink-400">更新时间</dt>
          <dd>{{ fmtDate(fileOf(slot.kind)?.updatedAt || null) }}</dd>
        </div>
        <div v-if="fileOf(slot.kind)?.exists" class="flex justify-between gap-3">
          <dt class="text-ink-400">下载链接</dt>
          <dd>
            <a
              :href="fileOf(slot.kind)!.url"
              class="text-brand-600 hover:underline font-mono"
              target="_blank"
            >{{ fileOf(slot.kind)!.url }}</a>
          </dd>
        </div>
      </dl>

      <div class="flex flex-wrap items-center gap-2">
        <label
          class="inline-flex items-center justify-center px-3 h-9 rounded-lg brand-gradient text-white text-sm font-medium cursor-pointer hover:opacity-90"
          :class="{ 'opacity-60 pointer-events-none': uploading === slot.kind }"
        >
          {{ uploading === slot.kind ? '上传中…' : (fileOf(slot.kind)?.exists ? '重新上传' : '选择文件上传') }}
          <input
            type="file"
            class="hidden"
            :accept="slot.accept"
            :disabled="!!uploading"
            @change="onPick(slot.kind, $event)"
          />
        </label>
        <button
          v-if="fileOf(slot.kind)?.exists"
          class="px-3 h-9 rounded-lg border border-rose-200 text-rose-700 text-sm hover:bg-rose-50"
          :disabled="!!uploading"
          @click="remove(slot.kind)"
        >删除</button>
      </div>
    </div>
  </div>
</template>
