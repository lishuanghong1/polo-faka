<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';
import StatusTag from '@/components/admin/StatusTag.vue';
import AdminSearchInput from '@/components/admin/AdminSearchInput.vue';
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

function fmtDiscount(d: number | null | undefined) {
  if (d == null) return '—';
  return `${(d * 10).toFixed(1)} 折`;
}

async function setDiscount(u: any) {
  const { value } = await ElMessageBox.prompt(
    `给 ${u.username} (#${u.id}) 设置专属折扣。\n填 0.5 ~ 1（如 0.9 = 9 折），留空则清除。\n下单时取「专属折扣」与「VIP 折扣」中更优的一个。`,
    '设置专属折扣',
    {
      inputValue: u.customDiscount != null ? String(u.customDiscount) : '',
      inputPlaceholder: '例如 0.85（八五折），留空清除',
      inputValidator: (v: string) => {
        const s = (v ?? '').trim();
        if (s === '') return true;
        const n = Number(s);
        if (!Number.isFinite(n)) return '请输入 0.5 ~ 1 的数字，或留空清除';
        if (n < 0.5 || n > 1) return '折扣需在 0.5（五折）~ 1（不折扣）之间';
        return true;
      },
    },
  );
  const s = (value ?? '').trim();
  const discount = s === '' ? null : Number(s);
  await api.vip.adminSetUserDiscount(u.id, { discount, note: '管理员设置专属折扣' });
  ElMessage.success(discount === null ? '已清除专属折扣' : `已设置 ${fmtDiscount(discount)}`);
  load();
}

function openDetail(u: any) {
  detailUserId.value = u.id;
}
</script>

<template>
  <AdminPageHeader title="用户" :subtitle="`${total} 个注册用户`" />

  <div class="card p-3 mb-4 admin-filter-bar">
    <AdminSearchInput
      v-model="keyword"
      placeholder="搜索 ID / 账号 / 邮箱 / 昵称"
      @enter="search"
      @clear="search"
    />
    <button class="px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm shrink-0" @click="search">查询</button>
    <button class="px-3 h-9 border border-ink-200 text-ink-700 hover:bg-ink-50 rounded-lg text-sm shrink-0" @click="load">刷新</button>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" min-width="1480px">
      <thead>
        <tr>
          <th style="width: 60px">ID</th>
          <th>账号</th>
          <th>邮箱</th>
          <th class="!text-right">余额</th>
          <th class="!text-right">积分</th>
          <th class="!text-right">累计充值</th>
          <th>邀请码</th>
          <th>VIP</th>
          <th>专属折扣</th>
          <th>角色</th>
          <th>状态</th>
          <th>注册时间</th>
          <th>最后登录</th>
          <th class="!text-right" style="width: 190px"></th>
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
          <td class="text-right font-medium text-amber-700">{{ u.points || 0 }}</td>
          <td class="text-right text-ink-700">¥{{ u.totalRecharged }}</td>
          <td class="font-mono text-xs text-ink-500">{{ u.inviteCode || '—' }}</td>
          <td>
            <span class="text-xs font-medium" :class="vipLabel[u.vipTier]?.cls || 'text-ink-400'">
              {{ vipLabel[u.vipTier]?.text || u.vipTier }}
            </span>
          </td>
          <td>
            <span
              class="text-xs font-medium"
              :class="u.customDiscount != null ? 'text-rose-600' : 'text-ink-300'"
            >{{ fmtDiscount(u.customDiscount) }}</span>
          </td>
          <td><StatusTag :status="u.role" /></td>
          <td><StatusTag :status="u.status" /></td>
          <td class="text-ink-500 text-xs">{{ u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—' }}</td>
          <td class="text-ink-500 text-xs">{{ u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '从未登录' }}</td>
          <td class="text-right" @click.stop>
            <button class="text-brand-700 hover:underline text-sm mr-2" @click="openDetail(u)">详情</button>
            <button class="text-ink-500 hover:text-brand-700 text-sm mr-2" @click="adjust(u)">调余额</button>
            <button class="text-ink-500 hover:text-rose-600 text-sm" @click="setDiscount(u)">折扣</button>
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

  <UserDetailDrawer
    :user-id="detailUserId"
    @close="detailUserId = null"
    @changed="load"
  />
</template>
