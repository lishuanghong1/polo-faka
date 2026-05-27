<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

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

/** 从用户输入中尽量抽出真正的 JWT */
const cleanToken = computed(() => {
  let v = rawInput.value.trim();
  if (!v) return '';

  const cookieMatch = v.match(/WorkosCursorSessionToken=([^;\s]+)/i);
  if (cookieMatch) v = decodeURIComponent(cookieMatch[1]);

  if (v.includes('::')) {
    const parts = v.split('::');
    v = parts[parts.length - 1].trim();
  }

  v = v.replace(/^["']+|["']+$/g, '').trim();
  return v;
});

interface DecodedPayload {
  sub?: string;
  email?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  [k: string]: any;
}

const decoded = computed<DecodedPayload | null>(() => {
  const t = cleanToken.value;
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

const expiredAt = computed(() => (decoded.value?.exp ? new Date(decoded.value.exp * 1000) : null));
const issuedAt = computed(() => (decoded.value?.iat ? new Date(decoded.value.iat * 1000) : null));
const isExpired = computed(() => (expiredAt.value ? expiredAt.value.getTime() < Date.now() : null));
const remainingDays = computed(() => {
  if (!expiredAt.value) return null;
  const diff = expiredAt.value.getTime() - Date.now();
  if (diff < 0) return 0;
  return Math.ceil(diff / 86400_000);
});

/** 注入到 cursor.com Console 的 JS 片段 */
const browserSnippet = computed(() => {
  const t = cleanToken.value;
  if (!t) return '';
  return `(()=>{const t=${JSON.stringify(t)};const c=\`WorkosCursorSessionToken=\${encodeURIComponent(t)}; path=/; max-age=2592000; secure; samesite=lax\`;document.cookie=c;document.cookie=c+'; domain=.cursor.com';document.cookie=c+'; domain=cursor.com';alert('Cookie 已写入，正在跳转');location.href='https://www.cursor.com/dashboard';})();`;
});

const submitting = ref(false);

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
    try {
      await navigator.clipboard.writeText(browserSnippet.value);
    } catch {
      ElMessage.warning('浏览器拒绝写剪贴板，请手动复制下面的代码');
    }

    // 2. 打开 cursor.com 新标签
    const win = window.open('https://www.cursor.com/dashboard', '_blank');
    if (!win) {
      ElMessage.error('浏览器拦截了新窗口，请允许弹窗后重试');
      submitting.value = false;
      return;
    }

    // 3. 弹清晰指引
    await ElMessageBox.alert(
      `<div style="line-height:1.7;font-size:13px">
        <p>已为你打开 <b>cursor.com</b> 并将登录脚本复制到剪贴板。</p>
        <p>在新标签中按下面 3 步操作即可：</p>
        <ol style="padding-left:18px;margin:6px 0">
          <li>按 <kbd style="background:#f3f4f6;padding:2px 6px;border-radius:3px">F12</kbd> 打开开发者工具</li>
          <li>切到 <b>Console</b> 标签</li>
          <li>按 <kbd style="background:#f3f4f6;padding:2px 6px;border-radius:3px">Ctrl+V</kbd> 粘贴，回车执行</li>
        </ol>
        <p style="color:#92400e;background:#fef3c7;padding:8px;border-radius:6px;margin-top:8px;font-size:12px">
          首次粘贴 Chrome 可能要求你输入「allow pasting」后才允许，按提示输入即可。
        </p>
      </div>`,
      '操作指引',
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '我已经知道了',
        customClass: 'cursor-login-guide',
      },
    );
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
        placeholder="支持粘贴：&#10;· user_xxx::eyJhbG...&#10;· eyJhbG... （纯 JWT）&#10;· WorkosCursorSessionToken=eyJhbG... （cookie 整段）"
      />
      <div class="mt-2 flex items-center justify-between text-xs">
        <span class="text-ink-400">{{ rawInput ? `${rawInput.length} 字符 / 已识别 ${cleanToken.length}` : '尚未输入' }}</span>
        <button v-if="rawInput" class="text-ink-400 hover:text-rose-600" @click="clearInput">清空</button>
      </div>
    </div>

    <!-- Token 解析 -->
    <div v-if="decoded" class="mt-4 card p-4 bg-white border border-ink-100">
      <div class="text-xs font-semibold tracking-widest uppercase text-ink-500 mb-3">账号信息</div>
      <dl class="space-y-1.5 text-sm">
        <div v-if="decoded.email" class="flex gap-3"><dt class="text-ink-500 w-16 shrink-0">账号</dt><dd class="font-mono text-ink-900 break-all">{{ decoded.email }}</dd></div>
        <div v-if="issuedAt" class="flex gap-3"><dt class="text-ink-500 w-16 shrink-0">签发</dt><dd class="text-xs text-ink-700">{{ issuedAt.toLocaleString() }}</dd></div>
        <div v-if="expiredAt" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">过期</dt>
          <dd class="text-xs" :class="isExpired ? 'text-rose-600 font-medium' : 'text-ink-700'">
            {{ expiredAt.toLocaleString() }}
            <span v-if="isExpired" class="ml-1.5 text-rose-600">· 已过期</span>
            <span v-else-if="remainingDays !== null" class="ml-1.5 text-emerald-600">· 剩 {{ remainingDays }} 天</span>
          </dd>
        </div>
      </dl>
      <button class="mt-2 text-xs text-ink-500 hover:text-brand-600" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '收起' : '展开' }} 完整 payload
      </button>
      <pre v-if="showAdvanced" class="mt-2 p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto">{{ JSON.stringify(decoded, null, 2) }}</pre>
    </div>

    <div
      v-else-if="rawInput && !cleanToken.includes('.')"
      class="mt-4 card p-3 bg-amber-50/60 border border-amber-200 text-sm text-amber-800"
    >
      ⚠️ Token 格式无法识别。请确认是完整 JWT（形如 <code class="font-mono">eyJ...xxx.yyy</code>）。
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
      点击后会打开 cursor.com 并自动复制脚本，再到新标签按 F12 粘贴即可登录
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
      <p>· 如果脚本执行后没登录上，多半是 Token 已过期 / Token 不属于网页会话类型</p>
    </div>
  </div>
</template>
