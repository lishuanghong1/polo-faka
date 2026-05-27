<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue';

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  isPublic: boolean;
  type: 'text' | 'textarea' | 'password' | 'switch' | 'select';
  mono?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
}

const siteFields: Field[] = [
  { key: 'site_name', label: '站点名称', placeholder: 'Polo AI 小铺', isPublic: true, type: 'text' },
  { key: 'site_tagline', label: '站点 Slogan', placeholder: '源头好货 · AI 编程账号一站式服务', isPublic: true, type: 'text' },
  { key: 'site_logo', label: 'Logo URL（可选）', placeholder: 'https://...', isPublic: true, type: 'text' },
  { key: 'site_icp', label: '备案号（可选）', placeholder: '京ICP备 xxxxxxxx 号', isPublic: true, type: 'text' },
  { key: 'qq_groups', label: '客服 QQ 群（JSON 数组）', placeholder: '["651304239"]', isPublic: true, type: 'text', mono: true },
  { key: 'cs_qq', label: '客服 QQ', placeholder: '123456', isPublic: true, type: 'text' },
  { key: 'cs_telegram', label: '客服 Telegram', placeholder: '@xxx', isPublic: true, type: 'text' },
  { key: 'cs_wechat', label: '客服微信号', placeholder: 'ymw_polo', isPublic: true, type: 'text', hint: '订单无库存自动发货失败时，订单详情页会展示这个让客户联系' },
  { key: 'cs_wechat', label: '客服微信', placeholder: 'wx-id', isPublic: true, type: 'text' },
  { key: 'footer_note', label: '页脚附加文字', placeholder: '示例 · 仿 yidachuang.top', isPublic: true, type: 'text' },
  { key: 'after_sale_notice', label: '售后/购买说明（支持换行）', placeholder: '默认无质保 / 选择有质保的规格享受退款', isPublic: true, type: 'textarea' },
  { key: 'only_cursor_download_url', label: 'Cursor 扩展下载地址', placeholder: 'https://...', isPublic: true, type: 'text' },
];

const alipayFields: Field[] = [
  { key: 'alipay_enabled', label: '启用支付宝', isPublic: false, type: 'switch', hint: '关闭后前台不再显示支付宝选项' },
  { key: 'alipay_sandbox', label: '使用沙箱', isPublic: false, type: 'switch', hint: '调试期请打开。线上请关闭' },
  { key: 'alipay_app_id', label: 'AppId', placeholder: '2021000000000000', isPublic: false, type: 'text', mono: true },
  {
    key: 'alipay_sign_type', label: '签名方式', isPublic: false, type: 'select',
    options: [{ value: 'RSA2', label: 'RSA2（推荐）' }, { value: 'RSA', label: 'RSA' }],
  },
  { key: 'alipay_private_key', label: '应用私钥（PKCS1，去掉头尾换行可粘贴一长串）', placeholder: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAS...', isPublic: false, type: 'textarea', mono: true },
  { key: 'alipay_public_key', label: '支付宝公钥', placeholder: 'MIIBIjANBgkqhkiG9w0BAQEFAAO...', isPublic: false, type: 'textarea', mono: true },
  { key: 'alipay_notify_base', label: '公网回调 Base URL（必填）', placeholder: 'https://your-domain.com', isPublic: false, type: 'text', hint: '支付宝异步通知 / 同步返回会拼接到这里。本地调试需用 cpolar / ngrok 暴露公网' },
];

const emailCodeFields: Field[] = [
  { key: 'email_code_enabled', label: '启用接码接口', isPublic: false, type: 'switch', hint: '关闭后前台首页提示「接口未启用」' },
  { key: 'email_code_api_base', label: '三方 API Base URL', placeholder: 'https://apiforge.cursorforgeai.top', isPublic: false, type: 'text', mono: true, hint: '留空时使用默认。不带尾部斜杠。本站会在此基础上拼 /openapi/v1/email-code' },
  { key: 'email_code_agent_key', label: 'Agent Key (ak_)', placeholder: 'ak_xxxxxxxxxxxxxxx（42 字符公开标识）', isPublic: false, type: 'text', mono: true, hint: 'X-Agent-Key 请求头使用' },
  { key: 'email_code_agent_secret', label: 'Agent Secret (sk_)', placeholder: 'sk_xxxxxxxxxxxxxxx（66 字符，仅本站后端用于 HMAC-SHA256 签名）', isPublic: false, type: 'textarea', mono: true },
  { key: 'email_code_timeout_ms', label: '请求超时（毫秒）', placeholder: '15000', isPublic: false, type: 'text', hint: '建议 10000-30000；过小容易超时' },
];

const SECRET_KEYS = new Set(['alipay_private_key', 'alipay_public_key', 'email_code_agent_secret']);
const SECRET_PLACEHOLDER = '__keep__';

const values = ref<Record<string, string>>({});
/** 用于显示"已设置 / 未设置"的标志 */
const hasValueMap = ref<Record<string, boolean>>({});
/** 用户是否修改过此 secret（true 才把新值发出去） */
const secretEdited = ref<Record<string, boolean>>({});
const loading = ref(false);
const saving = ref(false);
const activeTab = ref<'site' | 'alipay' | 'email_code'>('site');

async function load() {
  loading.value = true;
  try {
    const rows = await api.admin.settings();
    for (const r of rows) {
      if (SECRET_KEYS.has(r.key)) {
        // 密文字段不下发原值，仅显示"已设置"
        values.value[r.key] = '';
        hasValueMap.value[r.key] = !!r.hasValue;
        secretEdited.value[r.key] = false;
      } else {
        values.value[r.key] = r.value;
      }
    }
    // boolean 兜底
    if (values.value.alipay_enabled === undefined) values.value.alipay_enabled = 'false';
    if (values.value.alipay_sandbox === undefined) values.value.alipay_sandbox = 'true';
    if (!values.value.alipay_sign_type) values.value.alipay_sign_type = 'RSA2';
    if (values.value.email_code_enabled === undefined) values.value.email_code_enabled = 'false';
    if (!values.value.email_code_timeout_ms) values.value.email_code_timeout_ms = '15000';
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const payload: Record<string, { value: string; isPublic?: boolean }> = {};
    for (const f of [...siteFields, ...alipayFields, ...emailCodeFields]) {
      if (SECRET_KEYS.has(f.key)) {
        if (!secretEdited.value[f.key]) {
          // 没改过 → 发占位符，让后端跳过
          payload[f.key] = { value: SECRET_PLACEHOLDER, isPublic: f.isPublic };
        } else {
          payload[f.key] = { value: values.value[f.key] ?? '', isPublic: f.isPublic };
        }
      } else {
        payload[f.key] = { value: values.value[f.key] ?? '', isPublic: f.isPublic };
      }
    }
    await api.admin.settingsSet(payload);
    ElMessage.success('已保存。支付宝 / 接码接口相关改动会立即生效。');
    await load();
  } finally {
    saving.value = false;
  }
}

function markSecretEdit(key: string) {
  secretEdited.value[key] = true;
}

onMounted(load);
</script>

<template>
  <AdminPageHeader title="站点设置" subtitle="站点名称、Logo、客服联系方式、底部信息">
    <template #actions>
      <button
        class="px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? '保存中...' : '保存所有更改' }}
      </button>
    </template>
  </AdminPageHeader>

  <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">加载中...</div>

  <template v-else>
    <!-- tabs -->
    <div class="card p-1 mb-4 inline-flex">
      <button
        :class="['px-4 py-1.5 rounded-md text-sm transition-colors',
          activeTab === 'site' ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50']"
        @click="activeTab = 'site'"
      >站点信息</button>
      <button
        :class="['px-4 py-1.5 rounded-md text-sm transition-colors ml-1',
          activeTab === 'alipay' ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50']"
        @click="activeTab = 'alipay'"
      >支付宝</button>
      <button
        :class="['px-4 py-1.5 rounded-md text-sm transition-colors ml-1',
          activeTab === 'email_code' ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50']"
        @click="activeTab = 'email_code'"
      >接码接口</button>
    </div>

    <!-- 站点信息 -->
    <div v-show="activeTab === 'site'" class="card p-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        <div
          v-for="f in siteFields"
          :key="f.key"
          :class="f.type === 'textarea' ? 'md:col-span-2' : ''"
        >
          <label class="block text-sm font-medium text-ink-800 mb-1">{{ f.label }}</label>
          <p class="text-[11px] text-ink-400 mb-1.5 font-mono">key: {{ f.key }}</p>
          <textarea
            v-if="f.type === 'textarea'"
            v-model="values[f.key]"
            rows="3"
            :placeholder="f.placeholder"
            class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm"
          />
          <input
            v-else
            v-model="values[f.key]"
            :placeholder="f.placeholder"
            :class="['w-full px-3 py-2 border border-ink-200 rounded-lg text-sm', f.mono ? 'font-mono text-xs' : '']"
          />
        </div>
      </div>

      <div class="mt-6 pt-5 border-t border-ink-100 text-xs text-ink-500 space-y-1.5">
        <p>· 这些设置通过 <code class="font-mono text-ink-700">GET /api/site-settings/public</code> 公开接口下发给前台。</p>
        <p>· Logo URL 留空时会显示默认的"P"色块。</p>
        <p>· 客服 QQ 群字段是 JSON 数组格式：<code class="font-mono">["群号1","群号2"]</code></p>
      </div>
    </div>

    <!-- 支付宝 -->
    <div v-show="activeTab === 'alipay'" class="space-y-4">
      <div class="card p-4 bg-amber-50/40 border-amber-200 text-amber-900 text-xs flex gap-3">
        <span class="text-base">⚠</span>
        <div class="space-y-1.5 leading-relaxed">
          <p><b>沙箱测试</b>：登录 <a class="underline" href="https://open.alipay.com/develop/sandbox/app" target="_blank">支付宝开放平台 → 沙箱环境</a>，复制 AppId / 应用私钥 / 支付宝公钥到下面，打开「使用沙箱」开关。</p>
          <p><b>本地调试回调</b>：支付宝服务器必须能访问到你的 notify_url。本地需用 cpolar / ngrok / frp 把 <code class="font-mono">localhost:4000</code> 暴露到公网，把公网 URL 填到「公网回调 Base URL」（不带末尾斜杠）。</p>
          <p><b>线上正式</b>：关闭沙箱开关；AppId / 私钥 / 公钥 换成正式应用的；回调 Base URL 改成你的正式域名。</p>
        </div>
      </div>

      <div class="card p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div
            v-for="f in alipayFields"
            :key="f.key"
            :class="f.type === 'textarea' ? 'md:col-span-2' : ''"
          >
            <label class="block text-sm font-medium text-ink-800 mb-1">{{ f.label }}</label>
            <p class="text-[11px] text-ink-400 mb-1.5 font-mono">key: {{ f.key }}</p>

            <!-- switch -->
            <label v-if="f.type === 'switch'" class="inline-flex items-center cursor-pointer">
              <input type="checkbox"
                :checked="values[f.key] === 'true'"
                @change="values[f.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
              />
              <span class="ml-2 text-sm text-ink-700">
                {{ values[f.key] === 'true' ? '开启' : '关闭' }}
              </span>
            </label>

            <!-- select -->
            <select v-else-if="f.type === 'select'" v-model="values[f.key]"
              class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm bg-white">
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>

            <!-- textarea -->
            <div v-else-if="f.type === 'textarea'">
              <textarea
                v-model="values[f.key]"
                rows="6"
                :placeholder="SECRET_KEYS.has(f.key) && hasValueMap[f.key] && !secretEdited[f.key] ? '已设置（留空保持不变；输入新值覆盖）' : f.placeholder"
                class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono break-all"
                @input="SECRET_KEYS.has(f.key) && markSecretEdit(f.key)"
              />
              <p v-if="SECRET_KEYS.has(f.key) && hasValueMap[f.key]" class="text-[11px] text-brand-700 mt-1">
                ✓ 已设置且加密保存于数据库；后端读取时自动解密。
              </p>
              <p v-else-if="SECRET_KEYS.has(f.key)" class="text-[11px] text-ink-400 mt-1">
                ✗ 尚未设置
              </p>
            </div>

            <!-- text -->
            <input
              v-else
              v-model="values[f.key]"
              :placeholder="f.placeholder"
              :class="['w-full px-3 py-2 border border-ink-200 rounded-lg text-sm', f.mono ? 'font-mono text-xs' : '']"
            />

            <p v-if="f.hint" class="text-[11px] text-ink-400 mt-1">{{ f.hint }}</p>
          </div>
        </div>

        <div class="mt-6 pt-5 border-t border-ink-100 text-xs text-ink-500 space-y-1.5">
          <p>· 异步通知地址：<code class="font-mono text-ink-700">{回调 Base URL}/api/pay/alipay/notify</code></p>
          <p>· 同步返回地址：<code class="font-mono text-ink-700">{回调 Base URL}/api/pay/alipay/return</code></p>
          <p>· 这两个 URL 不需要在支付宝开放平台后台再单独配置，SDK 会带上。</p>
        </div>
      </div>
    </div>

    <!-- 接码接口 -->
    <div v-show="activeTab === 'email_code'" class="space-y-4">
      <div class="card p-4 bg-sky-50/40 border-sky-200 text-sky-900 text-xs flex gap-3">
        <span class="text-base">ℹ</span>
        <div class="space-y-1.5 leading-relaxed">
          <p>对接 <b>Cursorforge 代理 OpenAPI v1</b>（<code class="font-mono">/openapi/v1/email-code</code>）。鉴权方式：<b>HMAC-SHA256 签名</b>（X-Agent-Key + X-Agent-Timestamp + X-Agent-Nonce + X-Agent-Signature）。</p>
          <p><b>凭证</b>：在 cursorforgeai 代理后台 → 开发者中心 创建，会得到一对 <code class="font-mono">ak_xxx</code>（agent_key）和 <code class="font-mono">sk_xxx</code>（agent_secret，仅创建时显示一次）。</p>
          <p><b>scope</b>：调用 key 必须包含 <code class="font-mono">email:code</code>（或 <code class="font-mono">email:*</code> / <code class="font-mono">*</code>）。</p>
          <p><b>⚠ IP 白名单（必须配置！）</b>：v1.0.2 起 cursorforgeai 强制每个 key 必须配置 IP 白名单。请把 <b>本服务器固定出口 IP</b> 加到 cursorforgeai 代理后台 → 开发者中心 → 编辑该 key 里的「允许 IP」字段，否则会返回 <code class="font-mono">AUTH_IP_WHITELIST_REQUIRED</code>。</p>
          <p><b>NTP</b>：服务器时间偏差需在 ±5 分钟内，否则签名会被判过期。</p>
          <p><b>安全</b>：agent_secret 会被 AES-GCM 加密入库，保存后不再回显，永远不发给浏览器。HMAC 签名在本站后端进行。</p>
        </div>
      </div>

      <div class="card p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <div
            v-for="f in emailCodeFields"
            :key="f.key"
            :class="f.type === 'textarea' ? 'md:col-span-2' : ''"
          >
            <label class="block text-sm font-medium text-ink-800 mb-1">{{ f.label }}</label>
            <p class="text-[11px] text-ink-400 mb-1.5 font-mono">key: {{ f.key }}</p>

            <label v-if="f.type === 'switch'" class="inline-flex items-center cursor-pointer">
              <input type="checkbox"
                :checked="values[f.key] === 'true'"
                @change="values[f.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
              />
              <span class="ml-2 text-sm text-ink-700">
                {{ values[f.key] === 'true' ? '开启' : '关闭' }}
              </span>
            </label>

            <div v-else-if="f.type === 'textarea'">
              <textarea
                v-model="values[f.key]"
                rows="3"
                :placeholder="SECRET_KEYS.has(f.key) && hasValueMap[f.key] && !secretEdited[f.key] ? '已设置（留空保持不变；输入新值覆盖）' : f.placeholder"
                class="w-full px-3 py-2 border border-ink-200 rounded-lg text-sm font-mono break-all"
                @input="SECRET_KEYS.has(f.key) && markSecretEdit(f.key)"
              />
              <p v-if="SECRET_KEYS.has(f.key) && hasValueMap[f.key]" class="text-[11px] text-brand-700 mt-1">
                ✓ 已设置且加密保存于数据库
              </p>
              <p v-else-if="SECRET_KEYS.has(f.key)" class="text-[11px] text-ink-400 mt-1">
                ✗ 尚未设置
              </p>
            </div>

            <input
              v-else
              v-model="values[f.key]"
              :placeholder="f.placeholder"
              :class="['w-full px-3 py-2 border border-ink-200 rounded-lg text-sm', f.mono ? 'font-mono text-xs' : '']"
            />

            <p v-if="f.hint" class="text-[11px] text-ink-400 mt-1">{{ f.hint }}</p>
          </div>
        </div>

        <div class="mt-6 pt-5 border-t border-ink-100 text-xs text-ink-500 space-y-1.5">
          <p>· 前台路径：<code class="font-mono text-ink-700">POST /api/email-code/fetch</code>（本站后端代理，<b>不</b>暴露三方 API Key 到浏览器）</p>
          <p>· 单 IP 限流：每 10 秒最多 5 次（兼容客户端 3s 轮询）</p>
          <p>· 错误码：EMAIL_NOT_OWNED / EMAIL_CODE_NOT_ENABLED / EMAIL_INACTIVE / EMAIL_EXPIRED 会原样透传</p>
        </div>
      </div>
    </div>
  </template>
</template>
