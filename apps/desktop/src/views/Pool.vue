<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type {
  AppSettings,
  CaptchaInfo,
  PoolGrantView,
  ShopProfile,
} from '../types';
import UsageBar from '../components/UsageBar.vue';

const props = defineProps<{
  settings: AppSettings | null;
}>();

const emit = defineEmits<{
  (e: 'settings-changed', s: AppSettings): void;
  (e: 'reload-accounts'): void;
  (e: 'toast', kind: 'info' | 'warn' | 'critical' | 'error', text: string): void;
}>();

const profile = ref<ShopProfile | null>(null);
const grants = ref<PoolGrantView[]>([]);
const loading = ref(false);

const captcha = ref<CaptchaInfo | null>(null);
const captchaLoading = ref(false);
const loginForm = ref({
  username: '',
  password: '',
  captchaCode: '',
});
const loggingIn = ref(false);
const acting = ref<string | null>(null); // 当前正在执行的 grant orderNo

const isLoggedIn = computed(() => !!props.settings?.shopJwt);

async function refreshCaptcha() {
  captchaLoading.value = true;
  try {
    captcha.value = await api.shopGetCaptcha();
    loginForm.value.captchaCode = '';
  } catch (e: any) {
    emit('toast', 'error', `获取验证码失败：${e?.message || e}`);
  } finally {
    captchaLoading.value = false;
  }
}

async function login() {
  if (!captcha.value || !loginForm.value.username || !loginForm.value.password || !loginForm.value.captchaCode) {
    emit('toast', 'error', '请填写完整登录信息');
    return;
  }
  loggingIn.value = true;
  try {
    profile.value = await api.shopLogin({
      username: loginForm.value.username,
      password: loginForm.value.password,
      captchaId: captcha.value.id,
      captchaCode: loginForm.value.captchaCode,
    });
    emit('toast', 'info', `已登录商城账号：${profile.value.username || ''}`);
    // 重新拉设置（含 JWT）让外层知道已登录
    const s = await api.getSettings();
    emit('settings-changed', s);
    await refreshGrants();
  } catch (e: any) {
    emit('toast', 'error', `登录失败：${e?.message || e}`);
    await refreshCaptcha();
  } finally {
    loggingIn.value = false;
  }
}

async function logout() {
  await api.shopLogout();
  profile.value = null;
  grants.value = [];
  const s = await api.getSettings();
  emit('settings-changed', s);
  emit('toast', 'info', '已退出商城账号');
  await refreshCaptcha();
}

async function refreshGrants() {
  loading.value = true;
  try {
    grants.value = await api.poolListMyGrants();
  } catch (e: any) {
    const msg = String(e?.message || e);
    emit('toast', 'error', `拉取号池列表失败：${msg}`);
    // 401 → token 过期，退出
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      await logout();
    }
  } finally {
    loading.value = false;
  }
}

async function claim(g: PoolGrantView) {
  if (acting.value) return;
  acting.value = g.orderNo;
  try {
    const r = await api.poolClaim(g.orderNo, {
      writeToCursor: true,
      resetMachineId: props.settings?.defaultResetMachineId ?? true,
      killAndRelaunch: props.settings?.defaultRelaunch ?? true,
    });
    emit('toast', 'info', `已申请并写入：${r.grant.account?.email || '(无 email)'}`);
    emit('reload-accounts');
    await refreshGrants();
  } catch (e: any) {
    emit('toast', 'error', `申请失败：${e?.message || e}`);
  } finally {
    acting.value = null;
  }
}

async function swap(g: PoolGrantView) {
  if (acting.value) return;
  if (!confirm(`确认换一个新号？\n会自动释放当前账号 → 申请新号 → 写入 Cursor`)) return;
  acting.value = g.orderNo;
  try {
    const r = await api.poolSwap(g.orderNo, {
      writeToCursor: true,
      resetMachineId: props.settings?.defaultResetMachineId ?? true,
      killAndRelaunch: props.settings?.defaultRelaunch ?? true,
    });
    if (r.wroteToCursor) {
      emit('toast', 'info', `已换号：${r.grant.account?.email || '(无 email)'}`);
      emit('reload-accounts');
    } else {
      emit('toast', 'warn', '没有可换的号了（额度耗尽或已过期）');
    }
    await refreshGrants();
  } catch (e: any) {
    emit('toast', 'error', `换号失败：${e?.message || e}`);
  } finally {
    acting.value = null;
  }
}

async function release(g: PoolGrantView) {
  if (acting.value) return;
  if (!confirm(`确认释放当前账号？\n释放后号回到可分配池，你可以稍后再申请新的。`)) return;
  acting.value = g.orderNo;
  try {
    await api.poolRelease(g.orderNo);
    emit('toast', 'info', '已释放');
    emit('reload-accounts');
    await refreshGrants();
  } catch (e: any) {
    emit('toast', 'error', `释放失败：${e?.message || e}`);
  } finally {
    acting.value = null;
  }
}

onMounted(async () => {
  if (isLoggedIn.value) {
    await refreshGrants();
  } else {
    await refreshCaptcha();
  }
});

watch(
  () => isLoggedIn.value,
  async (v) => {
    if (v && grants.value.length === 0) await refreshGrants();
    if (!v && !captcha.value) await refreshCaptcha();
  },
);

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—';
  return `$${v.toFixed(2)}`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}
function fmtQuota(v: number | null | undefined) {
  if (v === null || v === undefined || v === 0) return '—';
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}
function percentOf(g: PoolGrantView) {
  if (!g.quotaTotal) return null;
  return (g.quotaUsed / g.quotaTotal) * 100;
}
</script>

<template>
  <div class="space-y-4">
    <!-- 登录 -->
    <section v-if="!isLoggedIn" class="card p-4">
      <div class="text-sm font-medium text-ink-100 mb-2">登录商城账号</div>
      <p class="text-[11px] text-ink-500 mb-3 leading-relaxed">
        用商城同一个用户名 / 密码登录即可看到名下所有号池额度包。<br/>
        商城地址：<span class="font-mono text-ink-400">{{ settings?.shopBaseUrl || '(未配置)' }}</span>
      </p>
      <div class="grid grid-cols-1 gap-2">
        <input
          v-model="loginForm.username"
          placeholder="用户名"
          autocomplete="username"
          class="px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-sm text-ink-100 focus:outline-none focus:border-brand-500"
        />
        <input
          v-model="loginForm.password"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          class="px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-sm text-ink-100 focus:outline-none focus:border-brand-500"
          @keydown.enter="login"
        />
        <div class="grid grid-cols-[1fr_140px] gap-2">
          <input
            v-model="loginForm.captchaCode"
            placeholder="验证码"
            class="px-3 py-2 bg-ink-900 border border-ink-700 rounded-md text-sm text-ink-100 font-mono focus:outline-none focus:border-brand-500"
            @keydown.enter="login"
          />
          <button
            class="bg-white rounded-md flex items-center justify-center px-2 hover:opacity-80"
            :disabled="captchaLoading"
            title="点击换一张"
            @click="refreshCaptcha"
          >
            <span v-if="captchaLoading || !captcha" class="text-[11px] text-ink-500">加载…</span>
            <span v-else v-html="captcha.svg" class="w-full h-9 [&_svg]:w-full [&_svg]:h-full" />
          </button>
        </div>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <button class="btn-primary" :disabled="loggingIn" @click="login">
          {{ loggingIn ? '登录中…' : '登录' }}
        </button>
        <button class="btn-ghost text-xs" @click="refreshCaptcha">换验证码</button>
      </div>
    </section>

    <template v-else>
      <!-- 顶部用户条 -->
      <section class="card p-3 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-ink-400">已登录</span>
          <span class="text-ink-100 font-mono">{{ settings?.shopUsername || profile?.username }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost text-xs" :disabled="loading" @click="refreshGrants">
            {{ loading ? '刷新中…' : '刷新列表' }}
          </button>
          <button class="text-[11px] text-rose-400 hover:underline" @click="logout">退出</button>
        </div>
      </section>

      <!-- 调度状态 -->
      <section v-if="settings" class="card p-3 text-xs leading-relaxed text-ink-400">
        <span class="text-ink-200 font-medium">自动调度</span>：
        <span :class="settings.poolAutoEnabled ? 'text-emerald-300' : 'text-rose-300'">
          {{ settings.poolAutoEnabled ? '已开启' : '已关闭' }}
        </span>
        · 阈值
        <span class="text-ink-200">{{ settings.poolSwapThresholdPercent }}%</span>
        · 用尽后
        <span class="text-ink-200">{{ settings.poolClearCursorOnExhausted ? '释放号 + 清 Cursor 登录' : '只释放号' }}</span>
        <span class="ml-2 text-ink-600">(可在「设置」改)</span>
      </section>

      <!-- 列表 -->
      <div v-if="!grants.length && !loading" class="card p-10 text-center text-ink-400 text-sm">
        当前账号名下没有号池额度包订单。
      </div>

      <ul v-else class="space-y-2">
        <li v-for="g in grants" :key="g.orderNo" class="card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm text-ink-100 font-medium truncate">
                {{ g.orderTitle || g.orderNo }}
              </div>
              <div class="text-[11px] text-ink-500 mt-0.5 font-mono">
                {{ g.orderNo }}
                <span v-if="g.notProvisioned" class="ml-2 text-rose-300">未发放</span>
                <span v-else-if="!g.active" class="ml-2 text-amber-300">已停用</span>
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <button
                v-if="!g.account && !g.notProvisioned && g.active"
                class="btn-primary text-xs py-1 px-3"
                :disabled="acting === g.orderNo"
                @click="claim(g)"
              >{{ acting === g.orderNo ? '申请中…' : '申请号 + 写 Cursor' }}</button>
              <button
                v-if="g.account"
                class="btn-primary text-xs py-1 px-3"
                :disabled="acting === g.orderNo"
                @click="swap(g)"
              >{{ acting === g.orderNo ? '换号中…' : '换一个号' }}</button>
              <button
                v-if="g.account"
                class="btn-ghost text-xs py-1 px-3"
                :disabled="acting === g.orderNo"
                @click="release(g)"
              >释放当前号</button>
            </div>
          </div>

          <div class="mt-3">
            <UsageBar
              size="sm"
              :percent="percentOf(g)"
              :left-label="`额度 ${fmtQuota(g.quotaUsed)} / ${fmtQuota(g.quotaTotal)}`"
              :right-label="`剩余 ${fmtQuota(g.quotaRemain)}`"
            />
          </div>

          <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-1.5">
              <div class="text-ink-500">绑定账号</div>
              <div class="text-ink-200 font-mono truncate">
                {{ g.account?.email || '—' }}
              </div>
            </div>
            <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-1.5">
              <div class="text-ink-500">到期</div>
              <div class="text-ink-200">{{ fmtDate(g.endAt) }}</div>
            </div>
            <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-1.5">
              <div class="text-ink-500">已用</div>
              <div class="text-ink-200">{{ fmtMoney(g.quotaUsed) }}</div>
            </div>
            <div class="rounded-md bg-ink-900/60 border border-ink-700 px-3 py-1.5">
              <div class="text-ink-500">最近检查</div>
              <div class="text-ink-200">{{ fmtDate(g.lastCheckAt) }}</div>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
