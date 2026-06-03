<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import UserDetailDrawer from '@/components/admin/UserDetailDrawer.vue';

const list = ref<any[]>([]);
const total = ref(0);
const keyword = ref('');
const loading = ref(false);
const page = ref(1);
const pageSize = 20;
const detailUserId = ref<number | null>(null);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
  loading.value = true;
  try {
    const a = await api.admin.users({ keyword: keyword.value, page: page.value, pageSize });
    list.value = a.items;
    total.value = a.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function go(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  load();
}

onMounted(load);

const vipLabel: Record<string, { text: string; cls: string }> = {
  NONE: { text: '—', cls: 'text-ink-400' },
  GOLD: { text: '黄金', cls: 'text-amber-700' },
  DIAMOND: { text: '钻石', cls: 'text-sky-700' },
  SUPREME: { text: '至尊', cls: 'text-fuchsia-700' },
};

async function adjust(u: any) {
  const { value } = await ElMessageBox.prompt(
    `调整 ${u.username} (#${u.id}) 余额（正数为充值，负数为扣除）`,
    '调整余额',
    {
      inputPattern: /^-?\d+(\.\d+)?$/,
      inputErrorMessage: '请输入有效金额',
      inputPlaceholder: '例如 10 或 -5.5',
    },
  );
  await api.admin.userAdjust(u.id, { amount: Number(value), note: '管理员调整' });
  ElMessage.success('已调整');
  load();
}

function openDetail(u: any) {
  detailUserId.value = u.id;
}
</script>

<template>
  <AdminPageHeader title="用户" :subtitle="`${total} 个注册用户`" />

  <div class="card p-3 mb-4 flex items-center gap-2 text-sm flex-wrap">
    <input
      v-model="keyword"
      placeholder="搜索 ID / 账号 / 邮箱 / 昵称"
      class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-full sm:w-64"
      @keydown.enter="search"
    />
    <button class="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="search">查询</button>
    <button class="px-3 py-1.5 border border-ink-200 text-ink-700 hover:bg-ink-50 rounded-lg text-sm shrink-0" @click="load">刷新</button>
  </div>

  <div class="overflow-x-auto">
    <DataTable :loading="loading" :is-empty="!list.length">
      <thead>
        <tr>
          <th style="width: 60px">ID</th>
          <th>账号</th>
          <th>邮箱</th>
          <th class="!text-right">余额</th>
          <th class="!text-right">累计充值</th>
          <th>VIP</th>
          <th>角色</th>
          <th>状态</th>
          <th>注册时间</th>
          <th>最后登录</th>
          <th class="!text-right" style="width: 140px"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in list" :key="u.id" class="cursor-pointer hover:bg-ink-50/40" @click="openDetail(u)">
          <td class="text-ink-400 font-mono text-xs">#{{ u.id }}</td>
          <td>
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-xs font-semibold">
                {{ u.username[0]?.toUpperCase() }}
              </div>
              <div>
                <div class="font-medium text-ink-900">{{ u.username }}</div>
                <div v-if="u.nickname" class="text-xs text-ink-500">{{ u.nickname }}</div>
              </div>
            </div>
          </td>
          <td class="text-ink-600">{{ u.email || '—' }}</td>
          <td class="text-right font-medium text-ink-900">¥{{ u.balance }}</td>
          <td class="text-right text-ink-700">¥{{ u.totalRecharged }}</td>
          <td>
            <span class="text-xs font-medium" :class="vipLabel[u.vipTier]?.cls || 'text-ink-400'">
              {{ vipLabel[u.vipTier]?.text || u.vipTier }}
            </span>
          </td>
          <td><StatusTag :status="u.role" /></td>
          <td><StatusTag :status="u.status" /></td>
          <td class="text-ink-500 text-xs">{{ u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—' }}</td>
          <td class="text-ink-500 text-xs">{{ u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '从未登录' }}</td>
          <td class="text-right" @click.stop>
            <button class="text-brand-700 hover:underline text-sm mr-2" @click="openDetail(u)">详情</button>
            <button class="text-ink-500 hover:text-brand-700 text-sm" @click="adjust(u)">调余额</button>
          </td>
        </tr>
      </tbody>
    </DataTable>
  </div>

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

  <UserDetailDrawer
    :user-id="detailUserId"
    @close="detailUserId = null"
    @changed="load"
  />
</template>
