<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import BrandButton from '@/components/BrandButton.vue';

const quotas = ref<any[]>([]);
const refunds = ref<any[]>([]);
const accounts = ref<any[]>([]);
const accountTotal = ref(0);
const loading = ref(false);
const loadingQuotas = ref(false);
const tab = ref<'refund' | 'accounts' | 'records'>('refund');

// 退款表单
const form = ref({ email: '', plan: 'pro' });
const submitting = ref(false);

// 账号列表
const accountFilter = ref<'all' | 'used' | 'unused'>('unused');
const accountPage = ref(1);

async function loadQuotas() {
  loadingQuotas.value = true;
  try {
    const r = await api.admin.aizhpQuotas();
    quotas.value = r.quotas || [];
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '加载额度失败');
  } finally {
    loadingQuotas.value = false;
  }
}

async function loadRefunds() {
  loading.value = true;
  try {
    const r = await api.admin.aizhpRefunds({ page: 1, pageSize: 50 });
    refunds.value = r.refunds || [];
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '加载退款记录失败');
  } finally {
    loading.value = false;
  }
}

async function loadAccounts() {
  loading.value = true;
  try {
    const r = await api.admin.aizhpAccounts({
      filter: accountFilter.value,
      page: accountPage.value,
      pageSize: 50,
    });
    accounts.value = r.accounts || [];
    accountTotal.value = r.total || 0;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '加载账号失败');
  } finally {
    loading.value = false;
  }
}

async function submitRefund() {
  if (!form.value.email) return ElMessage.warning('请填写邮箱');
  if (!form.value.plan) return ElMessage.warning('请选择档位');
  await ElMessageBox.confirm(
    `确认对 ${form.value.email} 发起 ${form.value.plan} 档位退款？`,
    '提示',
    { type: 'warning' },
  );
  submitting.value = true;
  try {
    const r = await api.admin.aizhpRefund({
      email: form.value.email,
      plan: form.value.plan,
    });
    ElMessage.success(r.message || '退款已提交');
    form.value.email = '';
    loadQuotas();
    loadRefunds();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '退款失败');
  } finally {
    submitting.value = false;
  }
}

async function refreshRefund(id: number) {
  try {
    const r = await api.admin.aizhpRefundDetail(id);
    const refund = r.refund;
    const idx = refunds.value.findIndex((x: any) => x.id === id);
    if (idx >= 0 && refund) {
      refunds.value[idx] = { ...refunds.value[idx], ...refund };
    }
    ElMessage.success(`状态: ${refund?.status || '未知'}`);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '查询失败');
  }
}

async function testConnection() {
  try {
    const r = await api.admin.aizhpPing();
    ElMessage.success(`连接成功！用户: ${r.username}，能力: ${(r.caps || []).join(', ')}`);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '连接失败');
  }
}

onMounted(() => {
  loadQuotas();
  loadRefunds();
});

const statusLabel = (s: string) => {
  const map: Record<string, { text: string; cls: string }> = {
    refunded: { text: '已退款', cls: 'text-emerald-700 bg-emerald-50' },
    external_pending: { text: '处理中', cls: 'text-amber-700 bg-amber-50' },
    sent: { text: '处理中', cls: 'text-amber-700 bg-amber-50' },
    failed: { text: '失败', cls: 'text-rose-700 bg-rose-50' },
    rejected: { text: '被拒绝', cls: 'text-rose-700 bg-rose-50' },
  };
  return map[s] || { text: s, cls: 'text-ink-600 bg-ink-50' };
};
</script>

<template>
  <AdminPageHeader title="Aizhp 渠道" subtitle="账号管理 · 接码 · 退款">
    <template #actions>
      <BrandButton variant="secondary" size="sm" @click="testConnection">测试连接</BrandButton>
    </template>
  </AdminPageHeader>

  <!-- Tab 切换 -->
  <div class="flex gap-1 mb-5 p-1 bg-ink-50 rounded-lg w-fit">
    <button
      v-for="t in [
        { k: 'refund', l: '退款操作' },
        { k: 'accounts', l: '账号池' },
        { k: 'records', l: '退款记录' },
      ]"
      :key="t.k"
      class="px-4 py-1.5 text-sm rounded-md transition"
      :class="tab === t.k ? 'bg-white text-ink-900 font-medium shadow-sm' : 'text-ink-500 hover:text-ink-700'"
      @click="tab = t.k as any; t.k === 'accounts' && loadAccounts()"
    >
      {{ t.l }}
    </button>
  </div>

  <!-- 退款操作 -->
  <div v-show="tab === 'refund'" class="space-y-4">
    <!-- 额度卡片 -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div
        v-for="q in quotas"
        :key="q.plan"
        class="rounded-xl border border-ink-100 bg-white p-4"
      >
        <div class="text-xs text-ink-500">{{ q.plan_label }} 退款额度</div>
        <div class="mt-1 text-2xl font-bold text-ink-900">
          {{ q.balance === null ? '∞' : q.balance }}
          <span class="text-sm font-normal text-ink-400">次</span>
        </div>
        <div class="text-[11px] text-ink-400 mt-1">方式: {{ q.refund_method }}</div>
      </div>
      <div v-if="!quotas.length && !loadingQuotas" class="col-span-full text-sm text-ink-400 py-4">
        暂无退款额度数据（请检查 API Key 配置）
      </div>
    </div>

    <!-- 退款表单 -->
    <div class="rounded-xl border border-ink-100 bg-white p-5">
      <div class="text-sm font-medium text-ink-900 mb-3">发起退款</div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex-1 min-w-[200px]">
          <label class="text-xs text-ink-500 block mb-1">账号邮箱</label>
          <input
            v-model="form.email"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
            placeholder="foo@outlook.com"
          />
        </div>
        <div class="w-32">
          <label class="text-xs text-ink-500 block mb-1">档位</label>
          <select
            v-model="form.plan"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white"
          >
            <option value="pro">Pro</option>
            <option value="pro+">Pro+</option>
            <option value="ultra">Ultra</option>
          </select>
        </div>
        <BrandButton
          variant="primary"
          size="md"
          :loading="submitting"
          @click="submitRefund"
        >
          提交退款
        </BrandButton>
      </div>
    </div>
  </div>

  <!-- 账号池 -->
  <div v-show="tab === 'accounts'" class="space-y-3">
    <div class="flex items-center gap-3 flex-wrap">
      <select
        v-model="accountFilter"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white"
        @change="accountPage = 1; loadAccounts()"
      >
        <option value="all">全部</option>
        <option value="unused">未使用</option>
        <option value="used">已使用</option>
      </select>
      <span class="text-xs text-ink-400">共 {{ accountTotal }} 个</span>
      <BrandButton variant="secondary" size="sm" @click="loadAccounts">刷新</BrandButton>
    </div>
    <div class="rounded-xl border border-ink-100 bg-white overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-ink-50 text-ink-600">
          <tr>
            <th class="px-4 py-2 text-left">ID</th>
            <th class="px-4 py-2 text-left">邮箱</th>
            <th class="px-4 py-2 text-left">分组</th>
            <th class="px-4 py-2 text-center">状态</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="a in accounts" :key="a.id">
            <td class="px-4 py-2 text-ink-400 font-mono text-xs">#{{ a.id }}</td>
            <td class="px-4 py-2 text-ink-900">{{ a.email }}</td>
            <td class="px-4 py-2 text-ink-600">{{ a.group_name }}</td>
            <td class="px-4 py-2 text-center">
              <span
                class="inline-block px-2 py-0.5 text-[11px] rounded-md"
                :class="a.used ? 'bg-ink-100 text-ink-500' : 'bg-emerald-50 text-emerald-700'"
              >
                {{ a.used ? '已使用' : '可用' }}
              </span>
            </td>
          </tr>
          <tr v-if="!accounts.length && !loading">
            <td colspan="4" class="px-4 py-8 text-center text-ink-400">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 退款记录 -->
  <div v-show="tab === 'records'" class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-xs text-ink-400">最近 {{ refunds.length }} 条</span>
      <BrandButton variant="secondary" size="sm" @click="loadRefunds">刷新</BrandButton>
    </div>
    <div class="rounded-xl border border-ink-100 bg-white overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[700px]">
        <thead class="bg-ink-50 text-ink-600">
          <tr>
            <th class="px-4 py-2 text-left">ID</th>
            <th class="px-4 py-2 text-left">邮箱</th>
            <th class="px-4 py-2 text-left">订单号</th>
            <th class="px-4 py-2 text-left">档位</th>
            <th class="px-4 py-2 text-center">状态</th>
            <th class="px-4 py-2 text-left">售出时间</th>
            <th class="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ink-100">
          <tr v-for="r in refunds" :key="r.id">
            <td class="px-4 py-2 text-ink-400 font-mono text-xs">#{{ r.id }}</td>
            <td class="px-4 py-2 text-ink-900 text-xs">{{ r.account_email }}</td>
            <td class="px-4 py-2">
              <span v-if="r.orderNo" class="font-mono text-xs text-brand-700 cursor-pointer hover:underline" @click="$router.push(`/order/${r.orderNo}`)">
                {{ r.orderNo }}
              </span>
              <span v-else class="text-xs text-ink-400">—</span>
            </td>
            <td class="px-4 py-2 text-ink-600">{{ r.subscription_plan }}</td>
            <td class="px-4 py-2 text-center">
              <span
                class="inline-block px-2 py-0.5 text-[11px] rounded-md"
                :class="statusLabel(r.status).cls"
              >
                {{ statusLabel(r.status).text }}
              </span>
            </td>
            <td class="px-4 py-2 text-xs text-ink-500">
              {{ r.soldAt ? new Date(r.soldAt).toLocaleString() : '—' }}
            </td>
            <td class="px-4 py-2 text-right">
              <button
                class="text-xs text-brand-600 hover:text-brand-700"
                @click="refreshRefund(r.id)"
              >
                刷新状态
              </button>
            </td>
          </tr>
          <tr v-if="!refunds.length && !loading">
            <td colspan="7" class="px-4 py-8 text-center text-ink-400">暂无退款记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
