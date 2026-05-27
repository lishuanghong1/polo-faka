<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

/**
 * Cursor 网页版一键登录工具（极简版）
 *
 * 工作原理：
 *   1) 用户把 token 粘到输入框（必须含 user_XXX:: 前缀）
 *   2) 点登录 → 自动复制 cookie 写入脚本到剪贴板，弹指引
 *   3) 用户点弹窗里的「打开 cursor.com 开始操作」→ 新标签打开 cursor.com
 *   4) 用户按指引：F12 → Application 删旧 cookie → Console 粘脚本回车
 *
 * Token 全程不上传任何服务器，纯前端处理。
 */

const rawInput = ref('');
const submitting = ref(false);

/**
 * cursor.com 的完整会话字符串，必须形如 `user_XXX::eyJhbG...`，
 * 这才是 WorkosCursorSessionToken cookie 的真实值（写入时再 url-encode）。
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

/** 简单格式校验：要么 user_xxx::JWT，要么至少看起来像 JWT */
const looksValid = computed(() => {
  const v = cleanToken.value;
  if (!v) return false;
  // 有 :: 前缀且后面像 JWT
  if (v.includes('::')) {
    const jwt = v.split('::').pop() || '';
    return jwt.split('.').length === 3;
  }
  // 纯 JWT 也允许（虽然没 user_ 前缀，但脚本会照样尝试）
  return v.split('.').length === 3;
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

async function doLogin() {
  if (!cleanToken.value) {
    ElMessage.warning('请先粘贴 Token');
    return;
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
        rows="4"
        spellcheck="false"
        autocorrect="off"
        class="w-full px-3 py-2.5 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 transition"
        placeholder="支持以下三种粘贴格式：&#10;· user_xxx::eyJhbG...        ← 推荐&#10;· WorkosCursorSessionToken=user_xxx%3A%3AeyJhbG...&#10;· 浏览器复制 cookie 值（带 url-encode）"
      />
      <div class="mt-2 flex items-center justify-between text-xs">
        <span class="text-ink-400">{{ rawInput ? `${rawInput.length} 字符 / 已识别 ${cleanToken.length}` : '尚未输入' }}</span>
        <button v-if="rawInput" class="text-ink-400 hover:text-rose-600" @click="clearInput">清空</button>
      </div>

      <!-- 简单格式提示 -->
      <div
        v-if="rawInput && !looksValid"
        class="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800"
      >
        ⚠️ Token 格式看起来不完整。请确认是 <code class="font-mono">user_XXX::eyJ...</code> 这种形式。
      </div>
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
