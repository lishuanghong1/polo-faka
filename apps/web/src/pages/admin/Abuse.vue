<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';
import DataTable from '@/components/admin/DataTable.vue';

interface BlockedItem {
  ip: string;
  reason: string;
  createdAt: number;
  ttl: number;
}

const list = ref<BlockedItem[]>([]);
const loading = ref(false);

const form = ref({
  ip: '',
  hours: 24,
  reason: '',
});

const profileOpen = ref(false);
const profileLoading = ref(false);
const profile = ref<any>(null);
const profileIp = ref('');
const profileDays = ref(30);

async function load() {
  loading.value = true;
  try {
    list.value = (await api.admin.abuseList()) || [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function doBlock() {
  const ip = form.value.ip.trim();
  if (!ip) {
    ElMessage.warning('请输入 IP');
    return;
  }
  const hours = Number(form.value.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    ElMessage.warning('封禁时长必须 > 0');
    return;
  }
  try {
    await api.admin.abuseBlock(ip, Math.floor(hours * 3600), form.value.reason || 'manual');
    ElMessage.success(`已封禁 ${ip}（${hours}h）`);
    form.value = { ip: '', hours: 24, reason: '' };
    await load();
  } catch (e: any) {
    ElMessage.error(e?.message || '封禁失败');
  }
}

async function doUnblock(item: BlockedItem) {
  try {
    await ElMessageBox.confirm(`确认解封 ${item.ip} ?`, '解封确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.admin.abuseUnblock(item.ip);
    ElMessage.success(`已解封 ${item.ip}`);
    await load();
  } catch (e: any) {
    ElMessage.error(e?.message || '解封失败');
  }
}

const stats = computed(() => {
  const auto = list.value.filter((i) => i.reason.startsWith('auto:')).length;
  const manual = list.value.length - auto;
  return { total: list.value.length, auto, manual };
});

function fmtTtl(s: number) {
  if (s <= 0) return '已过期';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function fmtCreatedAt(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return d.toLocaleString();
}

function reasonTag(reason: string) {
  if (reason.startsWith('auto:alipay_notify_malformed'))
    return { label: '自动 · 入参非法', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (reason.startsWith('auto:alipay_notify_signfail'))
    return { label: '自动 · 验签失败', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (reason.startsWith('auto:'))
    return { label: '自动', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: '手动', cls: 'bg-ink-50 text-ink-700 border-ink-200' };
}

async function openProfile(ip: string) {
  profileIp.value = ip;
  profileOpen.value = true;
  await loadProfile();
}
async function loadProfile() {
  profileLoading.value = true;
  try {
    profile.value = await api.admin.abuseProfile(profileIp.value, profileDays.value);
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
    profile.value = null;
  } finally {
    profileLoading.value = false;
  }
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}
function fmtDetail(d: any) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  try { return JSON.stringify(d); } catch { return String(d); }
}

/** 简单识别 UA：是否是脚本工具 */
function uaCategory(ua: string) {
  const s = ua.toLowerCase();
  if (s.includes('sqlmap')) return { label: 'sqlmap', cls: 'text-rose-700' };
  if (s.includes('nikto') || s.includes('nmap')) return { label: '安全扫描器', cls: 'text-rose-700' };
  if (s.includes('python-requests') || s.includes('python/'))
    return { label: 'Python 脚本', cls: 'text-amber-700' };
  if (s.includes('curl/')) return { label: 'curl', cls: 'text-amber-700' };
  if (s.includes('go-http-client')) return { label: 'Go 脚本', cls: 'text-amber-700' };
  if (s.includes('node-fetch') || s.includes('axios/'))
    return { label: 'Node 脚本', cls: 'text-amber-700' };
  if (s.includes('postman')) return { label: 'Postman', cls: 'text-amber-700' };
  if (s.includes('chrome') && s.includes('safari'))
    return { label: '浏览器（真人）', cls: 'text-ink-600' };
  if (s.includes('mozilla') || s.includes('webkit'))
    return { label: '浏览器', cls: 'text-ink-600' };
  return { label: '未知', cls: 'text-ink-500' };
}
</script>

<template>
  <AdminPageHeader title="IP 黑名单" :subtitle="`共 ${stats.total} 个封禁中 · 自动 ${stats.auto} / 手动 ${stats.manual}`">
    <template #actions>
      <button class="px-3 py-1.5 rounded-lg border border-ink-200 hover:bg-ink-50 text-sm text-ink-700" @click="load">
        刷新
      </button>
    </template>
  </AdminPageHeader>

  <div class="card p-4 mb-4">
    <div class="text-sm text-ink-700 font-medium mb-2">手动封禁</div>
    <div class="flex items-center gap-2 flex-wrap">
      <input
        v-model="form.ip"
        placeholder="IP 地址（如 59.64.129.233）"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-64 font-mono"
      />
      <div class="flex items-center gap-1 text-sm">
        <span class="text-ink-500">时长</span>
        <input
          v-model.number="form.hours"
          type="number"
          min="1"
          class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm w-20"
        />
        <span class="text-ink-500">小时</span>
      </div>
      <input
        v-model="form.reason"
        placeholder="备注（可选）"
        class="px-3 py-1.5 border border-ink-200 rounded-lg text-sm flex-1 min-w-40"
      />
      <button
        class="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm"
        @click="doBlock"
      >
        立即封禁
      </button>
    </div>
    <div class="text-xs text-ink-500 mt-2">
      系统会自动封禁可疑 IP：支付宝 notify 入参非法 5 次/5 分钟、验签失败 3 次/10 分钟 → 自动拉黑 24 小时
    </div>
  </div>

  <DataTable :loading="loading" :is-empty="!list.length" empty="当前没有被封禁的 IP">
    <thead>
      <tr>
        <th style="width: 160px">IP</th>
        <th style="width: 130px">类型</th>
        <th>原因</th>
        <th style="width: 140px">封禁时间</th>
        <th style="width: 120px">剩余时长</th>
        <th style="width: 100px">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in list" :key="row.ip">
        <td class="font-mono text-sm">
          <button class="text-brand-700 hover:underline" @click="openProfile(row.ip)">
            {{ row.ip }}
          </button>
        </td>
        <td>
          <span class="text-[11px] px-2 py-0.5 rounded border" :class="reasonTag(row.reason).cls">
            {{ reasonTag(row.reason).label }}
          </span>
        </td>
        <td class="text-xs font-mono text-ink-500 break-all max-w-md">{{ row.reason }}</td>
        <td class="text-xs text-ink-500" :title="row.createdAt ? new Date(row.createdAt).toLocaleString() : ''">
          {{ fmtCreatedAt(row.createdAt) }}
        </td>
        <td class="text-xs text-ink-600">{{ fmtTtl(row.ttl) }}</td>
        <td class="space-x-1 whitespace-nowrap">
          <button
            class="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 text-ink-700"
            @click="openProfile(row.ip)"
          >
            档案
          </button>
          <button
            class="text-xs px-2 py-1 rounded border border-ink-200 hover:bg-ink-50 text-ink-700"
            @click="doUnblock(row)"
          >
            解封
          </button>
        </td>
      </tr>
    </tbody>
  </DataTable>

  <!-- IP 档案抽屉 -->
  <el-drawer v-model="profileOpen" :title="`IP 档案 · ${profileIp}`" size="60%" :destroy-on-close="true">
    <div v-if="profileLoading" class="py-16 text-center text-ink-400 text-sm">加载中...</div>
    <div v-else-if="!profile" class="py-16 text-center text-ink-400 text-sm">无数据</div>
    <div v-else class="space-y-4">
      <div class="flex items-center gap-2 text-sm">
        <span class="text-ink-500">查询范围</span>
        <select v-model.number="profileDays" class="px-3 py-1 border border-ink-200 rounded-lg text-sm bg-white" @change="loadProfile">
          <option :value="7">近 7 天</option>
          <option :value="30">近 30 天</option>
          <option :value="90">近 90 天</option>
        </select>
        <span v-if="profile.blocked" class="text-[11px] px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
          已封禁中
        </span>
      </div>

      <!-- 统计卡 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card p-3">
          <div class="text-xs text-ink-500">总请求数</div>
          <div class="text-2xl font-semibold mt-1">{{ profile.stats.totalRequests }}</div>
        </div>
        <div class="card p-3">
          <div class="text-xs text-ink-500">不同动作</div>
          <div class="text-2xl font-semibold mt-1">{{ profile.stats.distinctActions }}</div>
        </div>
        <div class="card p-3">
          <div class="text-xs text-ink-500">关联账号</div>
          <div class="text-2xl font-semibold mt-1" :class="profile.stats.linkedAccounts > 0 ? 'text-rose-600' : ''">
            {{ profile.stats.linkedAccounts }}
          </div>
        </div>
      </div>

      <div class="card p-3 text-sm">
        <div class="flex justify-between text-ink-500 mb-1">
          <span>首次出现</span>
          <span class="text-ink-700">{{ fmtDateTime(profile.stats.firstSeen) }}</span>
        </div>
        <div class="flex justify-between text-ink-500">
          <span>最后出现</span>
          <span class="text-ink-700">{{ fmtDateTime(profile.stats.lastSeen) }}</span>
        </div>
      </div>

      <!-- 关联账号（关键信息：他登录/注册过哪些号） -->
      <div v-if="profile.linkedUsers.length" class="card p-4">
        <div class="text-sm font-medium text-rose-700 mb-3">⚠ 关联账号 · {{ profile.linkedUsers.length }} 个</div>
        <div class="space-y-2">
          <div v-for="u in profile.linkedUsers" :key="u.id" class="flex items-center justify-between text-sm border-b border-ink-100 pb-2 last:border-0">
            <div>
              <div class="font-medium">{{ u.username }} <span class="text-xs text-ink-400">#{{ u.id }}</span></div>
              <div class="text-xs text-ink-500">{{ u.email || '—' }} · 注册于 {{ fmtDateTime(u.createdAt) }}</div>
            </div>
            <div class="text-right">
              <div class="text-xs">{{ u.role }}</div>
              <div class="text-xs text-ink-500">余额 ¥{{ u.balance }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 关联订单 -->
      <div v-if="profile.linkedOrders.local.length || profile.linkedOrders.forge.length" class="card p-4">
        <div class="text-sm font-medium text-ink-700 mb-3">关联订单</div>
        <div v-if="profile.linkedOrders.local.length" class="mb-3">
          <div class="text-xs text-ink-500 mb-1">自建订单</div>
          <div v-for="o in profile.linkedOrders.local" :key="o.orderNo" class="text-xs flex justify-between border-b border-ink-100 py-1 last:border-0">
            <span class="font-mono">{{ o.orderNo }}</span>
            <span class="text-ink-500">{{ o.productTitle }}</span>
            <span>{{ o.status }} · ¥{{ o.payAmount }}</span>
          </div>
        </div>
        <div v-if="profile.linkedOrders.forge.length">
          <div class="text-xs text-ink-500 mb-1">代下订单</div>
          <div v-for="o in profile.linkedOrders.forge" :key="o.orderNo" class="text-xs flex justify-between border-b border-ink-100 py-1 last:border-0">
            <span class="font-mono">{{ o.orderNo }}</span>
            <span class="text-ink-500">{{ o.typeName }}</span>
            <span>{{ o.status }} · ¥{{ o.payAmount ?? o.totalAmount }}</span>
          </div>
        </div>
      </div>

      <!-- UA 列表（识别脚本工具） -->
      <div v-if="profile.userAgents.length" class="card p-4">
        <div class="text-sm font-medium text-ink-700 mb-3">User-Agent · {{ profile.stats.distinctUserAgents }} 种</div>
        <div class="space-y-2">
          <div v-for="(u, i) in profile.userAgents" :key="i" class="text-xs">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[11px] px-1.5 py-0.5 rounded border" :class="uaCategory(u.ua).cls">
                {{ uaCategory(u.ua).label }}
              </span>
              <span class="text-ink-500">{{ u.count }} 次</span>
            </div>
            <div class="text-ink-400 font-mono break-all">{{ u.ua }}</div>
          </div>
        </div>
      </div>

      <!-- 动作分布 -->
      <div v-if="profile.actions.length" class="card p-4">
        <div class="text-sm font-medium text-ink-700 mb-3">动作分布</div>
        <div class="space-y-1">
          <div v-for="a in profile.actions" :key="a.action" class="flex items-center text-xs">
            <span class="font-mono w-56 truncate" :title="a.action">{{ a.action }}</span>
            <div class="flex-1 bg-ink-100 rounded-full h-2 mx-2 overflow-hidden">
              <div
                class="bg-brand-500 h-full"
                :style="{ width: ((a.count / profile.stats.totalRequests) * 100) + '%' }"
              ></div>
            </div>
            <span class="w-12 text-right text-ink-600">{{ a.count }}</span>
          </div>
        </div>
      </div>

      <!-- 最近请求 -->
      <div v-if="profile.recentLogs.length" class="card p-4">
        <div class="text-sm font-medium text-ink-700 mb-3">最近请求（最多 30 条）</div>
        <div class="space-y-2 max-h-80 overflow-y-auto">
          <div v-for="r in profile.recentLogs" :key="r.id" class="text-xs border-b border-ink-100 pb-2 last:border-0">
            <div class="flex justify-between text-ink-500">
              <span class="font-mono">{{ r.action }}</span>
              <span>{{ fmtDateTime(r.createdAt) }}</span>
            </div>
            <div v-if="r.target" class="text-ink-700 font-mono truncate">{{ r.target }}</div>
            <div v-if="r.detail" class="text-ink-400 font-mono break-all">{{ fmtDetail(r.detail) }}</div>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
