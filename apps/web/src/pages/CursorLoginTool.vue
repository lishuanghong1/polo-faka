<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';

/**
 * 一键 Token 登录 Cursor 工具
 *
 * 设计要点：
 * - 纯前端实现，Token 完全不离开浏览器（不上传后端、不打日志）
 * - 自动识别三种常见输入：
 *     1) `user_XXX::JWT` （Cursor 客户端导出 / 卡密常用格式）
 *     2) 纯 JWT
 *     3) WorkosCursorSessionToken cookie 字符串（含 url-encoded）
 * - 解析 JWT payload 显示账号 / 过期时间，方便用户确认拿到的是不是自己想要的号
 * - 提供 3 种使用方式：
 *     · 浏览器登录 cursor.com（控制台粘贴 JS）  ← 最简单
 *     · Windows 客户端（PowerShell 写入 SQLite）
 *     · macOS / Linux 客户端（bash 写入 SQLite）
 */

const rawInput = ref('');
const showAdvanced = ref(false);

/** 从用户输入中尽量抽出真正的 token */
const cleanToken = computed(() => {
  let v = rawInput.value.trim();
  if (!v) return '';

  // 形如 "WorkosCursorSessionToken=xxx; Path=/" — 抠出等号后到分号前
  const cookieMatch = v.match(/WorkosCursorSessionToken=([^;\s]+)/i);
  if (cookieMatch) v = decodeURIComponent(cookieMatch[1]);

  // 形如 user_XXX::JWT — 取后半段
  if (v.includes('::')) {
    const parts = v.split('::');
    v = parts[parts.length - 1].trim();
  }

  // 去掉首尾引号 / 空白
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

/** ===== 三种使用方式的 snippet ===== */

const browserSnippet = computed(() => {
  const t = cleanToken.value;
  if (!t) return '';
  return `(()=>{const t=${JSON.stringify(t)};document.cookie=\`WorkosCursorSessionToken=\${encodeURIComponent(t)}; path=/; domain=.cursor.com; max-age=2592000; secure\`;document.cookie=\`WorkosCursorSessionToken=\${encodeURIComponent(t)}; path=/; domain=cursor.com; max-age=2592000; secure\`;alert('Cookie 已写入，正在跳转');location.href='https://www.cursor.com/dashboard';})();`;
});

const psSnippet = computed(() => {
  const t = cleanToken.value;
  if (!t) return '';
  return `# Windows PowerShell - 写入 Cursor 客户端登录态
$tk = "${t}"
$db = Join-Path $env:APPDATA "Cursor\\User\\globalStorage\\state.vscdb"
if(!(Test-Path $db)){ Write-Host "未找到 $db，请先安装并启动一次 Cursor" -ForegroundColor Red; exit }

# 解析 token 拿 email（用作 cachedEmail，可选）
$email = ""
try { $payload=$tk.Split('.')[1]; while($payload.Length%4){$payload+='='}
  $j=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Replace('-','+').Replace('_','/')))
  $email=([regex]::Match($j,'"email"\\s*:\\s*"([^"]+)"').Groups[1].Value) } catch {}

# 用 sqlite3.exe（Win10 自带于 System32，Cursor 安装目录也有）写入键值
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if(-not $sqlite){
  $sqliteAlt = "$env:LOCALAPPDATA\\Programs\\cursor\\resources\\app\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node"
  if(Test-Path $sqliteAlt){ Write-Host "请用方案 B（浏览器登录），或安装 sqlite3.exe 到 PATH" -ForegroundColor Yellow; exit }
}

Stop-Process -Name "Cursor" -Force -ErrorAction SilentlyContinue
Start-Sleep 1

@(
  "INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/accessToken', '$tk');"
  "INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/refreshToken', '$tk');"
  "INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/cachedSignUpType', 'Auth_0');"
  "INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/cachedEmail', '$email');"
  "INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/stripeMembershipType', 'pro');"
) -join "\`n" | & sqlite3.exe "$db"

Write-Host "✅ 已写入 Token，重新打开 Cursor 即可" -ForegroundColor Green`;
});

const bashSnippet = computed(() => {
  const t = cleanToken.value;
  if (!t) return '';
  return `#!/bin/bash
# macOS / Linux - 写入 Cursor 客户端登录态
TK="${t}"
if [[ "$(uname)" == "Darwin" ]]; then
  DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
else
  DB="$HOME/.config/Cursor/User/globalStorage/state.vscdb"
fi
[[ ! -f "$DB" ]] && { echo "未找到 $DB，请先安装并启动一次 Cursor"; exit 1; }
command -v sqlite3 >/dev/null || { echo "请先安装 sqlite3：brew install sqlite / apt install sqlite3"; exit 1; }

# 提取 email（可选）
EMAIL=$(echo "$TK" | awk -F. '{print $2}' | base64 -d 2>/dev/null | grep -oE '"email":"[^"]+"' | sed 's/.*"\\([^"]*\\)"$/\\1/' || true)

pkill -f Cursor 2>/dev/null
sleep 1

sqlite3 "$DB" <<SQL
INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/accessToken', '$TK');
INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/refreshToken', '$TK');
INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/cachedSignUpType', 'Auth_0');
INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/cachedEmail', '$EMAIL');
INSERT OR REPLACE INTO ItemTable VALUES('cursorAuth/stripeMembershipType', 'pro');
SQL

echo "✅ 已写入 Token，重新打开 Cursor 即可"`;
});

function copy(text: string, label = '已复制') {
  if (!text) {
    ElMessage.warning('请先输入 Token');
    return;
  }
  navigator.clipboard?.writeText(text).then(() => ElMessage.success(label));
}

function openCursorDashboard() {
  window.open('https://www.cursor.com/dashboard', '_blank');
}

function clearInput() {
  rawInput.value = '';
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
    <div class="mb-5">
      <h1 class="text-xl md:text-2xl font-semibold text-ink-900 flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-brand-600"></span>
        Cursor Token 一键登录
      </h1>
      <p class="mt-1 text-sm text-ink-500 leading-relaxed">
        粘贴你的 Cursor Token，自动生成「浏览器登录 / 客户端登录」三种方式的命令片段。
        <span class="text-emerald-700">Token 全程在你的浏览器本地处理，不会上传任何服务器。</span>
      </p>
    </div>

    <!-- 输入 -->
    <div class="card p-5 bg-white border border-ink-100">
      <label class="text-sm font-medium text-ink-800 block mb-2">Token</label>
      <textarea
        v-model="rawInput"
        rows="3"
        spellcheck="false"
        autocorrect="off"
        class="w-full px-3 py-2.5 border border-ink-200 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 transition"
        placeholder="支持以下三种格式自动识别：&#10;1) user_xxx::eyJhbGciOiJSUzI1NiI...&#10;2) eyJhbGciOiJSUzI1NiI...&#10;3) WorkosCursorSessionToken=eyJhbGciOiJSUzI1NiI..."
      />
      <div class="mt-2 flex items-center justify-between text-xs">
        <span class="text-ink-400">长度 {{ rawInput.length }} / 已识别 {{ cleanToken.length }} 字符</span>
        <button
          v-if="rawInput"
          class="text-ink-400 hover:text-rose-600"
          @click="clearInput"
        >清空</button>
      </div>
    </div>

    <!-- 解析结果 -->
    <div
      v-if="decoded"
      class="mt-4 card p-4 bg-white border border-ink-100"
    >
      <div class="text-xs font-semibold tracking-widest uppercase text-ink-500 mb-3">Token 信息</div>
      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
        <div v-if="decoded.email" class="flex gap-3"><dt class="text-ink-500 w-16 shrink-0">账号</dt><dd class="font-mono text-ink-900 break-all">{{ decoded.email }}</dd></div>
        <div v-if="decoded.sub" class="flex gap-3"><dt class="text-ink-500 w-16 shrink-0">用户 ID</dt><dd class="font-mono text-xs text-ink-700 break-all">{{ decoded.sub }}</dd></div>
        <div v-if="issuedAt" class="flex gap-3"><dt class="text-ink-500 w-16 shrink-0">签发</dt><dd class="text-xs text-ink-700">{{ issuedAt.toLocaleString() }}</dd></div>
        <div v-if="expiredAt" class="flex gap-3">
          <dt class="text-ink-500 w-16 shrink-0">过期</dt>
          <dd class="text-xs" :class="isExpired ? 'text-rose-600 font-medium' : 'text-ink-700'">
            {{ expiredAt.toLocaleString() }}
            <span v-if="isExpired" class="ml-1.5 text-rose-600">· 已过期</span>
            <span v-else-if="remainingDays !== null" class="ml-1.5 text-emerald-600">· 剩 {{ remainingDays }} 天</span>
          </dd>
        </div>
        <div v-if="decoded.iss" class="flex gap-3 sm:col-span-2"><dt class="text-ink-500 w-16 shrink-0">签发方</dt><dd class="text-xs text-ink-700 break-all">{{ decoded.iss }}</dd></div>
      </dl>

      <button
        class="mt-3 text-xs text-ink-500 hover:text-brand-600"
        @click="showAdvanced = !showAdvanced"
      >{{ showAdvanced ? '收起' : '展开' }}完整 payload</button>
      <pre v-if="showAdvanced" class="mt-2 p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto">{{ JSON.stringify(decoded, null, 2) }}</pre>
    </div>

    <div
      v-else-if="rawInput && !cleanToken.includes('.')"
      class="mt-4 card p-3 bg-amber-50/60 border border-amber-200 text-sm text-amber-800"
    >
      ⚠️ Token 格式无法识别。请确认粘贴的是完整 JWT，形如 <code class="font-mono">eyJ...xxx.yyy</code>。
    </div>

    <!-- 使用方式 -->
    <div v-if="cleanToken" class="mt-5 space-y-4">
      <div class="text-xs font-semibold tracking-widest uppercase text-ink-500">使用方式</div>

      <!-- 方式 1：浏览器 -->
      <div class="card p-4 bg-white border border-ink-100">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div class="font-medium text-ink-900 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 text-xs font-bold">1</span>
            浏览器登录 cursor.com
            <span class="text-[10px] text-emerald-700 px-1.5 py-0.5 bg-emerald-50 rounded">推荐</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              class="px-2.5 py-1 text-xs rounded border border-ink-200 hover:bg-ink-50"
              @click="openCursorDashboard"
            >打开 cursor.com</button>
            <button
              class="px-2.5 py-1 text-xs rounded bg-brand-600 hover:bg-brand-700 text-white"
              @click="copy(browserSnippet, 'JS 代码已复制')"
            >复制代码</button>
          </div>
        </div>
        <ol class="text-xs text-ink-600 space-y-1 mb-2 leading-relaxed list-decimal pl-5">
          <li>点「打开 cursor.com」（新标签）</li>
          <li>按 <kbd class="px-1 py-0.5 bg-ink-100 rounded text-[10px]">F12</kbd> 打开开发者工具，切到 Console</li>
          <li>把下面这段 JS 粘进去，回车执行，会自动跳到 Dashboard</li>
        </ol>
        <pre class="p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto whitespace-pre-wrap break-all">{{ browserSnippet }}</pre>
      </div>

      <!-- 方式 2：Windows -->
      <div class="card p-4 bg-white border border-ink-100">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div class="font-medium text-ink-900 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-sky-100 text-sky-700 text-xs font-bold">2</span>
            Windows 客户端登录
          </div>
          <button
            class="px-2.5 py-1 text-xs rounded bg-brand-600 hover:bg-brand-700 text-white"
            @click="copy(psSnippet, 'PowerShell 脚本已复制')"
          >复制脚本</button>
        </div>
        <ol class="text-xs text-ink-600 space-y-1 mb-2 leading-relaxed list-decimal pl-5">
          <li>按 <kbd class="px-1 py-0.5 bg-ink-100 rounded text-[10px]">Win+R</kbd> → 输入 <code class="font-mono">powershell</code> → 回车</li>
          <li>右键粘贴下面这段脚本，回车执行</li>
          <li>重新打开 Cursor 客户端</li>
        </ol>
        <pre class="p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto max-h-60">{{ psSnippet }}</pre>
      </div>

      <!-- 方式 3：Mac / Linux -->
      <div class="card p-4 bg-white border border-ink-100">
        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div class="font-medium text-ink-900 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-violet-100 text-violet-700 text-xs font-bold">3</span>
            macOS / Linux 客户端登录
          </div>
          <button
            class="px-2.5 py-1 text-xs rounded bg-brand-600 hover:bg-brand-700 text-white"
            @click="copy(bashSnippet, 'Bash 脚本已复制')"
          >复制脚本</button>
        </div>
        <ol class="text-xs text-ink-600 space-y-1 mb-2 leading-relaxed list-decimal pl-5">
          <li>需要先装 sqlite3：<code class="font-mono">brew install sqlite</code>（mac）/ <code class="font-mono">apt install sqlite3</code>（linux）</li>
          <li>打开终端，粘贴下面整段脚本回车</li>
          <li>重新打开 Cursor 客户端</li>
        </ol>
        <pre class="p-2 bg-ink-50 rounded text-[10px] font-mono text-ink-700 overflow-x-auto max-h-60">{{ bashSnippet }}</pre>
      </div>
    </div>

    <!-- 安全提示 -->
    <div class="mt-6 text-[11px] text-ink-400 leading-relaxed border-t border-ink-100 pt-4">
      <p class="mb-1">• 本工具完全在你的浏览器中运行，Token 不会上传到我们的服务器，也不会写入日志。</p>
      <p class="mb-1">• 不建议把别人的 Token 写到自己客户端 — 同一 Token 在多设备同时使用可能被风控。</p>
      <p>• 若执行后客户端仍未登录，可能是版本差异。请先尝试方式 1（浏览器登录）确认 Token 本身可用。</p>
    </div>
  </div>
</template>
