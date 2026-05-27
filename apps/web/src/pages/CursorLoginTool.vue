<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';

/**
 * Cursor 网页版一键登录工具
 *
 * 浏览器安全策略限制：A 站的 JS 无法直接给 B 站设 cookie
 *（cursor.com 的会话 cookie 还是 HttpOnly + Secure 跨域）。
 *
 * 因此「真·一键」做不到。本工具能做到的最接近体验：
 *   1) 用户粘 Token
 *   2) 点登录 → 自动复制脚本到剪贴板 + 自动打开 cursor.com 新标签
 *   3) 用户在新标签里 F12 → 粘贴 → 回车（一次粘贴）
 *
 * Token 全程不上传任何服务器，纯前端处理。
 */

const rawInput = ref('');
const showAdvanced = ref(false);

/**
 * cursor.com 的完整会话字符串，必须形如 `user_XXX::eyJhbG...`，
 * 这才是 WorkosCursorSessionToken cookie 的真实值（写入时再 url-encode）。
 * 之前只取后半 JWT 会写不进去。
 */
const cleanToken = computed(() => {
  let v = rawInput.value.trim();
  if (!v) return '';

  // 1) 从 "WorkosCursorSessionToken=xxx; Path=/..." 中抠出 cookie 值
  const cookieMatch = v.match(/WorkosCursorSessionToken=([^;\s]+)/i);
  if (cookieMatch) v = cookieMatch[1];

  // 2) 多次 decodeURIComponent 兜底（cookie 可能 %3A%3A → ::）
  for (let i = 0; i < 3; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(v)) break;
    try {
      const next = decodeURIComponent(v);
      if (next === v) break;
      v = next;
    } catch {
      break;
    }
  }

  // 3) 去引号 / 空白
  v = v.replace(/^["']+|["']+$/g, '').trim();
  return v;
});

/** 只用于解码 JWT payload 的部分 */
const jwtPart = computed(() => {
  const v = cleanToken.value;
  if (!v) return '';
  if (v.includes('::')) {
    const parts = v.split('::');
    return parts[parts.length - 1].trim();
  }
  return v;
});

/**
 * 抽取 user_XXX：
 * 1) 优先用 `user_XXX::JWT` 前缀里的
 * 2) 否则从 JWT 的 sub 字段（auth0|user_XXX）里抠
 */
const userId = computed(() => {
  const v = cleanToken.value;
  if (v.includes('::')) {
    const head = v.split('::')[0];
    if (head.startsWith('user_')) return head;
  }
  const sub = decoded.value?.sub;
  if (sub) {
    const m = sub.match(/user_[A-Za-z0-9]+/i);
    if (m) return m[0];
  }
  return '';
});

interface DecodedPayload {
  sub?: string;
  email?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  time?: string;
  scope?: string;
  aud?: string;
  type?: string;
  workosSessionId?: string;
  [k: string]: any;
}

const decoded = computed<DecodedPayload | null>(() => {
  const t = jwtPart.value;
  if (!t || !t.includes('.')) return null;
  const parts = t.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    try {
      return JSON.parse(atob(parts[1]));
    } catch {
      return null;
    }
  }
});

const expiredAt = computed(() => {
  const d = decoded.value;
  if (!d) return null;
  const raw = typeof d.exp === 'number' ? d.exp : Number(d.exp);
  if (!raw || !Number.isFinite(raw)) return null;
  return new Date(raw * 1000);
});

/**
 * 签发时间：标准 JWT 是 iat，但 Cursor 自家的 token 用的是 `time` 字段（字符串）
 */
const issuedAt = computed(() => {
  const d = decoded.value;
  if (!d) return null;
  const raw =
    typeof d.iat === 'number' ? d.iat : d.time ? Number(d.time) : null;
  if (!raw || !Number.isFinite(raw)) return null;
  return new Date(raw * 1000);
});

const isExpired = computed(() => (expiredAt.value ? expiredAt.value.getTime() < Date.now() : null));
const remainingDays = computed(() => {
  if (!expiredAt.value) return null;
  const diff = expiredAt.value.getTime() - Date.now();
  if (diff < 0) return 0;
  return Math.ceil(diff / 86400_000);
});

/**
 * 注入到 cursor.com Console 的 JS 片段。
 *
 * 前置条件：用户已经在 Application → Cookies 里手动删掉了旧的
 * WorkosCursorSessionToken（HttpOnly 的，JS 删不掉，必须手动）。
 *
 * 脚本只负责把新 cookie 写入 .cursor.com / cursor.com 两个 domain。
 */
const browserSnippet = computed(() => {
  const t = cleanToken.value;
  if (!t) return '';
  return `(()=>{const v=${JSON.stringify(t)};const enc=encodeURIComponent(v);
['.cursor.com','cursor.com',''].forEach(d=>{document.cookie='WorkosCursorSessionToken='+enc+'; path=/; max-age=2592000; secure; samesite=lax'+(d?'; domain='+d:'');});
const after=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('WorkosCursorSessionToken=')&&s.includes(enc.slice(0,20)));
if(!after){
  alert('⚠️ Cookie 写入失败。\\n\\n大概率是旧的 WorkosCursorSessionToken 还在（HttpOnly，JS 删不掉）。\\n\\n请到 DevTools → Application → Cookies → https://www.cursor.com，\\n把所有 WorkosCursorSessionToken 行都右键 Delete 删掉，再粘脚本一次。');
  return;
}
alert('✅ Cookie 写入成功，正在跳转 dashboard');
location.href='https://www.cursor.com/dashboard';})();`;
});

const submitting = ref(false);

// === 在线查询 cursor.com 账号信息 ===
interface CursorOnlineInfo {
  valid: boolean;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  sub?: string | null;
  membership?: any;
  usage?: any;
  stripe?: {
    membershipType?: string | null;
    subscriptionStatus?: string | null;
    currentPeriodEnd?: number | null;
    cancelAtPeriodEnd?: boolean | null;
    plan?: string | null;
    trialEnd?: number | null;
  } | null;
  errors: string[];
}
const onlineInfo = ref<CursorOnlineInfo | null>(null);
const onlineLoading = ref(false);

// token 变了就清掉旧的查询结果
watch(cleanToken, () => {
  onlineInfo.value = null;
});

async function inspectOnline() {
  if (!cleanToken.value) {
    ElMessage.warning('请先粘贴 Token');
    return;
  }
  onlineLoading.value = true;
  try {
    // http wrapper 已自动解包 { success, data }，这里拿到的就是 data
    const data = (await api.cursorTools.inspect(cleanToken.value)) as CursorOnlineInfo;
    onlineInfo.value = data;
    if (!data.valid) {
      ElMessage.warning('Token 看起来无效（cursor.com 拒绝了它）');
    } else {
      ElMessage.success('Token 有效，已拉取账号信息');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '在线查询失败');
  } finally {
    onlineLoading.value = false;
  }
}

/**
 * 综合月度用量。cursor /api/usage 返回结构会按模型分桶，
 * 这里聚合 gpt-4 / gpt-3.5 等的 numRequests / maxRequestUsage。
 */
const usageSummary = computed(() => {
  const u = onlineInfo.value?.usage;
  if (!u || typeof u !== 'object') return null;
  const buckets: Array<{ key: string; used: number; total: number | null }> = [];
  for (const [k, v] of Object.entries(u)) {
    if (k === 'startOfMonth') continue;
    if (!v || typeof v !== 'object') continue;
    const used = Number((v as any).numRequests ?? (v as any).num_requests ?? 0);
    const max = (v as any).maxRequestUsage ?? (v as any).max_request_usage;
    const total = max == null ? null : Number(max);
    buckets.push({ key: k, used, total: Number.isFinite(total as number) ? (total as number) : null });
  }
  return { buckets, startOfMonth: u.startOfMonth || null };
});

function fmtUnixDate(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return '-';
  let n: number;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    if (!Number.isFinite(parsed)) return '-';
    return new Date(parsed).toLocaleDateString();
  }
  n = v as number;
  if (!Number.isFinite(n)) return '-';
  const t = n > 1e12 ? n : n * 1000;
  return new Date(t).toLocaleDateString();
}

async function doLogin() {
  if (!cleanToken.value) {
    ElMessage.warning('请先粘贴 Token');
    return;
  }
  if (isExpired.value) {
    try {
      await ElMessageBox.confirm(
        '检测到此 Token 已过期，仍要继续登录吗？过期 Token 不会真正登录成功。',
        '提示',
        { type: 'warning', confirmButtonText: '仍然继续' },
      );
    } catch {
      return;
    }
  }

  submitting.value = true;
  try {
    // 1. 复制脚本到剪贴板
    let copied = false;
    try {
      await navigator.clipboard.writeText(browserSnippet.value);
      copied = true;
    } catch {
      ElMessage.warning('浏览器拒绝写剪贴板，请手动复制下面的代码');
    }

    // 2. 先弹指引，用户读完点确认按钮才打开 cursor.com
    let confirmed = false;
    try {
      await ElMessageBox.confirm(
      `<div style="line-height:1.8;font-size:13px">
        <p>${copied ? '登录脚本已复制到剪贴板。' : '请手动复制下方代码框中的脚本。'}<b>点下方按钮才会打开 cursor.com</b>。</p>
        <p style="color:#991b1b;background:#fee2e2;padding:8px 10px;border-radius:6px;margin:8px 0;font-size:12px">
          ⚠️ 浏览器规定 JS 不能删除 HttpOnly cookie，所以需要你<b>手动删一下旧 cookie</b>，之后脚本才能写入新的。
        </p>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:8px 0">
          <p style="font-weight:600;color:#111827;margin-bottom:4px">第 1 步：删除旧 Cookie</p>
          <ol style="padding-left:20px;margin:0;color:#374151">
            <li>在新标签按 <kbd style="background:#fff;border:1px solid #d1d5db;padding:1px 6px;border-radius:3px">F12</kbd> 打开开发者工具</li>
            <li>切到顶部 <b>Application</b> 标签</li>
            <li>左侧栏展开 <b>Cookies</b> → 点 <b>https://www.cursor.com</b></li>
            <li>找到 Name 为 <code style="background:#fff;padding:1px 4px;border-radius:3px">WorkosCursorSessionToken</code> 的行</li>
            <li><b>右键 → Delete</b>（如果有多行同名都删掉）</li>
          </ol>
        </div>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin:8px 0">
          <p style="font-weight:600;color:#065f46;margin-bottom:4px">第 2 步：粘脚本登录</p>
          <ol style="padding-left:20px;margin:0;color:#374151">
            <li>切到顶部 <b>Console</b> 标签</li>
            <li>按 <kbd style="background:#fff;border:1px solid #d1d5db;padding:1px 6px;border-radius:3px">Ctrl+V</kbd> 粘贴脚本，回车</li>
            <li>看到 "✅ Cookie 写入成功" 即跳转 dashboard 登录成功</li>
          </ol>
        </div>

        <p style="color:#92400e;background:#fef3c7;padding:8px;border-radius:6px;margin-top:8px;font-size:12px">
          首次粘贴 Chrome 可能要求你输入 <code>allow pasting</code> 后才允许，按提示输入即可。
        </p>
      </div>`,
        '操作指引（2 步）',
        {
          dangerouslyUseHTMLString: true,
          confirmButtonText: '打开 cursor.com 开始操作',
          cancelButtonText: '稍后再说',
          customClass: 'cursor-login-guide',
          closeOnClickModal: false,
        },
      );
      confirmed = true;
    } catch {
      // 用户点了"稍后再说"或关闭弹窗，不跳转
      return;
    }

    // 3. 用户点了"打开 cursor.com"按钮后才跳转
    if (confirmed) {
      const win = window.open('https://www.cursor.com/dashboard', '_blank');
      if (!win) {
        ElMessage.error('浏览器拦截了新窗口，请允许此站点的弹窗权限后重试');
      }
    }
  } finally {
    submitting.value = false;
  }
}

function copySnippet() {
  if (!browserSnippet.value) {
    ElMessage.warning('请先粘贴 Token');
    return;
  }
  navigator.clipboard?.writeText(browserSnippet.value).then(() => ElMessage.success('脚本已复制'));
}

function clearInput() {
  rawInput.value = '';
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-6 md:py-10">
    <div class="mb-6 text-center">
      <h1 class="text-2xl font-semibold text-ink-900 flex items-center justify-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-brand-600"></span>
        Cursor 一键登录
      </h1>
      <p class="mt-2 text-sm text-ink-500 leading-relaxed max-w-md mx-auto">
        粘贴 Token，自动登录 cursor.com 网页版。<br />
        <span class="text-emerald-700">Token 不上传，全在你本地浏览器处理。</span>
      </p>
    </div>

    <!-- 输入框 -->
    <div class="card p-5 bg-white border border-ink-100">
      <label class="text-sm font-medium text-ink-800 block mb-2">Token</label>
      <textarea
        v-model="rawInput"
        rows="3"
        spellcheck="false"
        autocorrect="off"
        class="w-full px-3 py-2.5 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 transition"
        placeholder="支持以下三种粘贴格式：&#10;· user_xxx::eyJhbG...        ← 推荐&#10;· WorkosCursorSessionToken=user_xxx%3A%3AeyJhbG...&#10;· 浏览器复制 cookie 值（带 url-encode）"
      />
      <div class="mt-2 flex items-center justify-between text-xs">
        <span class="text-ink-400">{{ rawInput ? `${rawInput.length} 字符 / 已识别 ${cleanToken.length}` : '尚未输入' }}</span>
        <button v-if="rawInput" class="text-ink-400 hover:text-rose-600" @click="clearInput">清空</button>
      </div>
    </div>

    <!-- Token 解析 -->
    <div v-if="decoded" class="mt-4 card p-4 bg-white border border-ink-100">
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs font-semibold tracking-widest uppercase text-ink-500">Token 信息</div>
        <span
          v-if="isExpired === false"
          class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
        >有效</span>
        <span
          v-else-if="isExpired === true"
          class="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700"
        >已过期</span>
      </div>
      <dl class="space-y-1.5 text-sm">
        <div v-if="userId" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">用户 ID</dt>
          <dd class="font-mono text-xs text-ink-900 break-all">{{ userId }}</dd>
        </div>
        <div v-if="decoded.email" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">邮箱</dt>
          <dd class="text-xs text-ink-900 break-all">{{ decoded.email }}</dd>
        </div>
        <div v-if="decoded.workosSessionId" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">Session</dt>
          <dd class="font-mono text-xs text-ink-700 break-all">{{ decoded.workosSessionId }}</dd>
        </div>
        <div v-if="decoded.type" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">类型</dt>
          <dd class="text-xs text-ink-700">
            {{ decoded.type === 'web' ? 'web（网页登录）' : decoded.type }}
            <span v-if="decoded.type !== 'web'" class="ml-1 text-amber-600">· 非 web 类型可能无法网页登录</span>
          </dd>
        </div>
        <div v-if="decoded.aud" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">受众</dt>
          <dd class="font-mono text-xs text-ink-700 break-all">{{ decoded.aud }}</dd>
        </div>
        <div v-if="decoded.iss" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">签发方</dt>
          <dd class="font-mono text-xs text-ink-700 break-all">{{ decoded.iss }}</dd>
        </div>
        <div v-if="issuedAt" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">签发于</dt>
          <dd class="text-xs text-ink-700">{{ issuedAt.toLocaleString() }}</dd>
        </div>
        <div v-if="expiredAt" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">过期于</dt>
          <dd class="text-xs" :class="isExpired ? 'text-rose-600 font-medium' : 'text-ink-700'">
            {{ expiredAt.toLocaleString() }}
            <span v-if="isExpired" class="ml-1.5 text-rose-600">· 已过期</span>
            <span v-else-if="remainingDays !== null" class="ml-1.5 text-emerald-600">· 剩 {{ remainingDays }} 天</span>
          </dd>
        </div>
      </dl>
      <div class="mt-3 flex items-center gap-3">
        <button
          class="text-xs px-3 py-1.5 rounded-md border border-brand-200 text-brand-700 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
          :disabled="onlineLoading"
          @click="inspectOnline"
        >
          <span v-if="onlineLoading">查询中…</span>
          <span v-else>{{ onlineInfo ? '重新查询账号' : '在线查询账号信息（邮箱 / 额度）' }}</span>
        </button>
        <button class="text-xs text-ink-500 hover:text-brand-600" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '收起' : '展开' }} 完整 payload
        </button>
      </div>
      <p class="mt-1 text-[11px] text-ink-400">
        Token 会经服务端中转一次调用 cursor.com，服务端 <b>不持久化、不写日志</b>
      </p>
      <pre v-if="showAdvanced" class="mt-2 p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto">{{ JSON.stringify(decoded, null, 2) }}</pre>
    </div>

    <!-- 在线查询结果 -->
    <div
      v-if="onlineInfo"
      class="mt-4 card p-4 bg-white border"
      :class="onlineInfo.valid ? 'border-emerald-200' : 'border-rose-200 bg-rose-50/40'"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="text-xs font-semibold tracking-widest uppercase text-ink-500">cursor.com 在线信息</div>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded"
          :class="onlineInfo.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
        >
          {{ onlineInfo.valid ? 'Token 有效' : 'Token 无效' }}
        </span>
      </div>

      <dl v-if="onlineInfo.valid" class="space-y-1.5 text-sm">
        <div v-if="onlineInfo.email" class="flex gap-3 items-center">
          <dt class="text-ink-500 w-16 shrink-0">邮箱</dt>
          <dd class="text-sm font-medium text-ink-900 break-all">{{ onlineInfo.email }}</dd>
        </div>
        <div v-if="onlineInfo.name" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">昵称</dt>
          <dd class="text-xs text-ink-700">{{ onlineInfo.name }}</dd>
        </div>
        <div v-if="onlineInfo.stripe?.membershipType" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">套餐</dt>
          <dd class="text-xs text-ink-700">
            <span class="font-medium">{{ onlineInfo.stripe.membershipType }}</span>
            <span v-if="onlineInfo.stripe.plan" class="ml-1.5 text-ink-500">({{ onlineInfo.stripe.plan }})</span>
            <span v-if="onlineInfo.stripe.subscriptionStatus"
              class="ml-2 text-[10px] px-1.5 py-0.5 rounded"
              :class="onlineInfo.stripe.subscriptionStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
            >{{ onlineInfo.stripe.subscriptionStatus }}</span>
          </dd>
        </div>
        <div v-if="onlineInfo.stripe?.currentPeriodEnd" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">续费日</dt>
          <dd class="text-xs text-ink-700">
            {{ fmtUnixDate(onlineInfo.stripe.currentPeriodEnd) }}
            <span v-if="onlineInfo.stripe.cancelAtPeriodEnd" class="ml-1.5 text-rose-600">· 到期取消</span>
          </dd>
        </div>
        <div v-if="onlineInfo.stripe?.trialEnd" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">试用至</dt>
          <dd class="text-xs text-ink-700">{{ fmtUnixDate(onlineInfo.stripe.trialEnd) }}</dd>
        </div>
      </dl>

      <!-- 用量额度 -->
      <div v-if="usageSummary && usageSummary.buckets.length" class="mt-4 pt-3 border-t border-ink-100">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-semibold text-ink-700">本月用量</div>
          <span v-if="usageSummary.startOfMonth" class="text-[10px] text-ink-400">
            起算：{{ fmtUnixDate(usageSummary.startOfMonth) }}
          </span>
        </div>
        <div class="space-y-2">
          <div
            v-for="b in usageSummary.buckets"
            :key="b.key"
            class="text-xs"
          >
            <div class="flex justify-between mb-0.5">
              <span class="font-mono text-ink-700">{{ b.key }}</span>
              <span class="text-ink-500">
                <b class="text-ink-900">{{ b.used }}</b>
                <span v-if="b.total !== null"> / {{ b.total }}</span>
                <span v-else> · 无限</span>
              </span>
            </div>
            <div v-if="b.total" class="h-1.5 bg-ink-100 rounded overflow-hidden">
              <div
                class="h-full rounded transition-all"
                :class="b.used / b.total > 0.9 ? 'bg-rose-500' : b.used / b.total > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'"
                :style="{ width: Math.min(100, (b.used / b.total) * 100) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 失败提示 -->
      <div v-if="!onlineInfo.valid" class="text-xs text-rose-700 space-y-1">
        <p>cursor.com 拒绝了此 Token。可能原因：</p>
        <ul class="pl-5 list-disc space-y-0.5 text-ink-600">
          <li>Token 已过期或被吊销</li>
          <li>Token 类型不是 web（IDE 专用 token 不能登 dashboard）</li>
          <li>Token 复制不完整，缺了 <code class="font-mono">user_XXX::</code> 前缀</li>
        </ul>
      </div>

      <div v-if="onlineInfo.errors?.length" class="mt-2 text-[10px] text-ink-400">
        <span>调试：</span>
        <span v-for="(err, i) in onlineInfo.errors" :key="i" class="mr-2">{{ err }}</span>
      </div>
    </div>

    <div
      v-else-if="rawInput && !jwtPart.includes('.')"
      class="mt-4 card p-3 bg-amber-50/60 border border-amber-200 text-sm text-amber-800"
    >
      ⚠️ Token 格式无法识别。请粘贴完整字符串（含 <code class="font-mono">user_XXX::</code> 前缀）。
    </div>

    <!-- 登录按钮 -->
    <button
      class="mt-5 w-full py-3.5 rounded-xl text-base font-semibold transition relative overflow-hidden"
      :class="cleanToken
        ? 'bg-gradient-to-r from-brand-600 to-violet-600 hover:from-brand-700 hover:to-violet-700 text-white shadow-lg shadow-brand-200'
        : 'bg-ink-100 text-ink-400 cursor-not-allowed'"
      :disabled="!cleanToken || submitting"
      @click="doLogin"
    >
      <svg v-if="submitting" class="w-5 h-5 inline-block mr-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {{ submitting ? '正在跳转 cursor.com…' : '立即登录 cursor.com' }}
    </button>

    <p class="mt-2 text-center text-xs text-ink-400">
      点击后会先弹出操作指引，确认后再打开 cursor.com 并自动复制脚本
    </p>

    <!-- 高级：手动复制 -->
    <details class="mt-6">
      <summary class="text-xs text-ink-500 cursor-pointer hover:text-brand-600 select-none">
        浏览器拦截了？查看脚本手动复制 →
      </summary>
      <div class="mt-3 card p-3 bg-ink-50/40 border border-ink-200">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-ink-600">手动复制以下代码到 cursor.com 控制台</span>
          <button class="text-xs text-brand-600 hover:underline" @click="copySnippet">复制</button>
        </div>
        <pre class="p-2 bg-white rounded text-[10px] font-mono text-ink-700 overflow-x-auto whitespace-pre-wrap break-all max-h-32">{{ browserSnippet || '（请先粘贴 Token）' }}</pre>
      </div>
    </details>

    <!-- 安全说明 -->
    <div class="mt-6 text-[11px] text-ink-400 leading-relaxed border-t border-ink-100 pt-4 space-y-1">
      <p>· Token 在你的浏览器中处理，不会上传服务器、不会写入任何日志</p>
      <p>· 浏览器禁止跨域设 cookie，所以需要在 cursor.com 控制台执行一次脚本</p>
      <p>· cookie 值必须保留 <code class="font-mono">user_XXX::</code> 前缀。直接粘 <code class="font-mono">eyJ...</code> 纯 JWT 是不能登录的</p>
      <p>· 官方 cookie 是 HttpOnly，JS 不能删。需要你在 <b>DevTools → Application → Cookies → cursor.com</b> 手动右键 Delete 一次</p>
      <p>· 删干净后再粘脚本，JS 就能写入新 Cookie，回到 dashboard 自动登录</p>
      <p>· 如果执行后没登录上，多半是 Token 已过期 / 类型不是 <code class="font-mono">web</code> / 旧 Cookie 没删干净</p>
    </div>
  </div>
</template>
