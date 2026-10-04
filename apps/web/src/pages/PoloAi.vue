<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useSiteStore } from '@/stores/site';
import { useUserStore } from '@/stores/user';
import PoloAiIcon from '@/components/PoloAiIcon.vue';
import PoloAiClientDemo from '@/components/PoloAiClientDemo.vue';

const site = useSiteStore();
const user = useUserStore();
const announcementOpen = ref(true);
const activeMenu = ref<string | null>(null);
const docsUrl = '/poloai/docs';
const groupUrl = 'https://myws-download.233ka.xyz/cursorHub/group.png';
const downloads = reactive({
  windows: '/static/desktop/polo.exe',
  macos: '/static/desktop/polo.dmg',
});
const controller = new AbortController();
let releaseTimeout: ReturnType<typeof setTimeout> | undefined;

// 使用原下载页的发布清单；没有清单时沿用后台安装包的固定下载地址。
onMounted(async () => {
  releaseTimeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`/static/desktop/latest.json?_t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return;
    const manifest = await response.json();
    if (!Array.isArray(manifest?.assets)) return;
    const base = typeof manifest.urlBase === 'string' ? manifest.urlBase : '/static/desktop/';
    const assetUrl = (name: string) => `${base.replace(/\/?$/, '/')}${encodeURIComponent(name)}`;
    for (const asset of manifest.assets) {
      if (!asset || typeof asset.name !== 'string') continue;
      if (asset.platform === 'windows' && ['exe', 'nsis'].includes(asset.kind)) {
        downloads.windows = assetUrl(asset.name);
      }
      if (typeof asset.platform === 'string' && asset.platform.startsWith('macos') && asset.kind === 'dmg') {
        downloads.macos = assetUrl(asset.name);
      }
    }
  } catch {
    // 发布清单不可用时保留同域下载地址，不影响介绍内容。
  } finally {
    clearTimeout(releaseTimeout);
  }
});
onBeforeUnmount(() => {
  clearTimeout(releaseTimeout);
  controller.abort();
});

const menus = [
  {
    label: '产品',
    items: [
      { title: 'PoloAi 客户端', description: '连接、账号、用量与设置集中管理', href: '#client' },
      { title: '模型与服务', description: '稳定访问主流模型与智能路由能力', href: '#capabilities' },
      { title: '透明计费', description: 'Token、倍率、临时费用与结算清晰可查', href: '#capability-usage' },
    ],
  },
  {
    label: '解决方案',
    heading: '核心能力',
    items: [
      { title: '稳定连接', description: '线路异常时按可用性自动切换', href: '#capability-routing' },
      { title: '用量追踪', description: '每次请求的状态、耗时与用量均可回看', href: '#capability-usage' },
      { title: '统一管理', description: '权益包与钱包按量在同一个账户中结算', href: '#capability-account' },
    ],
  },
  {
    label: '资源',
    heading: '帮助与支持',
    items: [
      { title: '使用文档', description: '安装、证书、连接、计费与卸载说明', href: docsUrl },
      { title: '运行数据', description: '查看公开接口提供的实时服务指标', href: '#metrics' },
      { title: '用户交流群', description: '获取使用交流与人工支持', href: groupUrl },
    ],
  },
];
const highlights = [
  '兼容主流模型', '本地代理状态可见', '用量透明可追溯',
  '权益与钱包统一管理', '线路异常自动切换', '支持 Windows 与 macOS',
];
const capabilities = [
  {
    id: 'capability-routing', number: '01', label: '稳定连接',
    title: '请求不停在一个失败节点',
    description: '线路异常时按可用性切换，并将失败原因、后续响应与最终结算保留在同一条请求记录里。',
    points: ['线路状态持续感知', '异常请求自动切换', '完整保留请求上下文'],
  },
  {
    id: 'capability-usage', number: '02', label: '透明用量',
    title: '知道每次请求去了哪里、花了多少',
    description: '输入、输出、缓存、倍率、临时费用和官方结清状态逐项展示，不用在多个页面之间拼账。',
    points: ['Token 与耗时逐笔查看', '倍率前后费用同时展示', '官方账单到达后自动对账'],
  },
  {
    id: 'capability-account', number: '03', label: '统一管理',
    title: '把账号、权益和连接放回一个客户端',
    description: '扫码登录后即可管理工作环境、账号、权益包与钱包按量，不改变你在 Cursor 里的工作方式。',
    points: ['客户端内扫码注册与登录', '权益包与按量连续结算', '一键启动或停止工作环境'],
  },
];
const privacyItems = [
  { icon: 'shield' as const, title: '本地代理状态可见', description: '代理监听本地回环地址，连接页持续展示本地代理与 Cursor 进程状态。' },
  { icon: 'monitor' as const, title: '证书用途明确', description: '本地证书仅用于承接 Cursor 的 HTTPS 请求，客户端会检查信任状态并提供安装指引。' },
  { icon: 'chart' as const, title: '事件与账单分开记录', description: '连接日志用于排查事件，用量记录则展示 Token、倍率、预估费用与最终结算。' },
];
const faqs = [
  { question: '开始使用需要做什么？', answer: '下载客户端、扫码注册或登录并选择权益包或按量使用，然后从连接页启动工作环境。客户端会处理本地代理与连接状态。' },
  { question: '支持哪些系统？', answer: '目前提供 Windows 安装包与 macOS 通用 DMG。macOS 安装包同时适用于 Apple 芯片和 Intel 芯片。' },
  { question: '为什么会看到临时计费？', answer: '对话进行中可能先显示临时费用；官方用量到达后会自动结清，并明确展示无需补退、补扣或退款。' },
  { question: '最终费用如何计算？', answer: '模型官方单价、实际 Token、缓存价格和当前倍率共同决定最终费用。客户端会同时展示倍率前费用、倍率和实际费用。' },
  { question: '本地证书有什么作用？', answer: '本地证书用于客户端在本机承接 Cursor 的 HTTPS 流量。停止代理并退出客户端后不会继续转发，完整移除步骤可在文档中查看。' },
  { question: '权益包和按量可以同时使用吗？', answer: '可以。权益包负责固定周期额度，钱包负责按量费用和超出权益范围的使用，两者在同一客户端内管理。' },
];
</script>

<template>
  <div class="poloai-page max-w-7xl mx-auto px-4 py-6 md:py-8" @keydown.esc="activeMenu = null">
    <div v-if="announcementOpen" class="pa-announcement rounded-xl border border-brand-200 bg-brand-50 text-brand-800">
      <a :href="downloads.windows" download>
        <span>PoloAi 桌面客户端现已支持 Windows 与 macOS</span>
        <strong>下载客户端 <PoloAiIcon name="arrow" :size="14" /></strong>
      </a>
      <button type="button" aria-label="关闭下载提示" @click="announcementOpen = false">
        <PoloAiIcon name="close" :size="16" />
      </button>
    </div>

    <div class="card pa-product-nav">
      <a href="#top" class="pa-brand">
        <img :src="site.settings.site_logo || '/logo.png'" alt="" />
        <span>PoloAi</span>
      </a>
      <nav class="pa-section-nav" aria-label="PoloAi 产品导航">
        <div v-for="menu in menus" :key="menu.label" class="pa-nav-menu">
          <button
            type="button" :aria-expanded="activeMenu === menu.label"
            :aria-controls="`pa-menu-${menu.label}`"
            @click="activeMenu = activeMenu === menu.label ? null : menu.label"
          >
            {{ menu.label }} <PoloAiIcon name="chevron" :size="14" />
          </button>
          <div v-if="activeMenu === menu.label" :id="`pa-menu-${menu.label}`" class="pa-menu-popover" @click="activeMenu = null">
            <p v-if="menu.heading">{{ menu.heading }}</p>
            <a v-for="item in menu.items" :key="item.title" :href="item.href" :target="item.href.startsWith('https://') ? '_blank' : undefined" rel="noopener noreferrer">
              <strong>{{ item.title }}</strong><span>{{ item.description }}</span>
            </a>
          </div>
        </div>
        <a href="#metrics">实时数据</a>
        <router-link :to="docsUrl">使用文档</router-link>
      </nav>
      <router-link :to="user.isLoggedIn ? '/me' : '/login'" class="pa-login brand-gradient rounded-lg">注册/登录</router-link>
    </div>

    <section id="top" class="card pa-hero">
      <div class="pa-hero-grid">
        <div>
          <p class="pa-eyebrow"><span></span>为 Cursor 提供稳定、透明的模型访问</p>
          <h1>一次连接，<br />每次请求都清清楚楚。</h1>
        </div>
        <div class="pa-hero-copy">
          <p>在 Cursor 里继续原来的工作方式。PoloAi 负责连接、模型调度、用量记录与后续官方结算。</p>
          <div class="pa-hero-actions">
            <a :href="downloads.windows" download class="pa-button brand-gradient rounded-xl">
              <PoloAiIcon name="download" :size="18" />下载 Windows 客户端
            </a>
            <router-link :to="docsUrl" class="pa-text-link">使用文档 <PoloAiIcon name="arrow" :size="17" /></router-link>
          </div>
          <div class="pa-platforms">
            <span><PoloAiIcon name="windows" :size="14" /> Windows 10 / 11</span>
            <span><PoloAiIcon name="apple" :size="14" /> macOS</span>
          </div>
        </div>
      </div>

      <div id="client" class="pa-client">
        <div class="pa-demo-heading">
          <strong>真实客户端界面</strong>
          <p>点击账号、连接、用量、商城与设置，体验与桌面端一致的导航和反馈。</p>
        </div>
        <PoloAiClientDemo />
      </div>
      <div class="pa-highlights">
        <span v-for="item in highlights" :key="item"><PoloAiIcon name="check" :size="15" />{{ item }}</span>
      </div>
    </section>

    <section id="metrics" class="pa-section">
      <div class="pa-section-heading">
        <p class="pa-eyebrow"><span></span>服务数据</p>
        <h2>PoloAi 实时运行数据</h2>
      </div>
      <div class="pa-metrics-grid">
        <article v-for="label in ['总请求量', '当日请求量', '累计成功率']" :key="label" class="card pa-metric-card">
          <strong>—</strong><span>{{ label }}</span>
        </article>
      </div>
    </section>

    <section id="capabilities" class="pa-section">
      <div class="pa-section-heading">
        <p class="pa-eyebrow"><span></span>为什么选择 PoloAi</p>
        <h2>不改变你的编辑器，只把后台过程说清楚</h2>
        <p>连接、费用与权益状态不再散落在看不见的流程中。</p>
      </div>
      <div class="pa-capabilities-layout">
        <nav class="card pa-capability-nav" aria-label="PoloAi 产品能力导航">
          <a v-for="item in capabilities" :key="item.id" :href="`#${item.id}`">
            <span>{{ item.number }}</span>{{ item.label }}<PoloAiIcon name="arrow" :size="16" />
          </a>
        </nav>
        <div class="pa-stories">
          <article v-for="capability in capabilities" :id="capability.id" :key="capability.id" class="card pa-story">
            <div class="pa-visual">
              <div v-if="capability.number === '01'" class="pa-visual-window">
                <div class="pa-window-heading"><span class="pa-window-dots"><i></i><i></i><i></i></span><strong>智能路由记录</strong><small>实时</small></div>
                <div class="pa-request">
                  <span class="pa-square-icon"><PoloAiIcon name="monitor" /></span>
                  <div><small>请求编号 CH-2841</small><strong>模型请求进入</strong></div><time>10:26:08</time>
                </div>
                <div class="pa-timeline">
                  <div><i><PoloAiIcon name="check" :size="13" /></i><span><strong>主线路响应检查</strong><small>8.2 秒内未返回首包</small></span></div>
                  <div><i><PoloAiIcon name="arrow" :size="13" /></i><span><strong>自动切换可用线路</strong><small>保留原请求上下文</small></span></div>
                  <div><i><PoloAiIcon name="check" :size="13" /></i><span><strong>响应完成并结算</strong><small>总耗时 9.6 秒 · 已结清</small></span></div>
                </div>
              </div>

              <div v-else-if="capability.number === '02'" class="pa-visual-window">
                <div class="pa-window-heading"><span class="pa-window-dots"><i></i><i></i><i></i></span><strong>请求用量明细</strong><small>登录后加载</small></div>
                <div class="pa-request"><span class="pa-square-icon"><PoloAiIcon name="chart" /></span><div><small>当前模型</small><strong>登录后逐笔同步账本</strong></div></div>
                <dl class="pa-billing">
                  <div v-for="label in ['未缓存输入', '缓存读取', '模型输出']" :key="label"><dt>{{ label }}</dt><dd>—</dd><span>等待账本</span></div>
                </dl>
                <div class="pa-billing-total"><span><small>结算信息</small><strong>登录后同步结算数据</strong></span><PoloAiIcon name="shield" /></div>
              </div>

              <div v-else class="pa-visual-window">
                <div class="pa-window-heading"><span class="pa-window-dots"><i></i><i></i><i></i></span><strong>统一账户</strong><small>已同步</small></div>
                <div class="pa-profile">
                  <img :src="site.settings.site_logo || '/logo.png'" alt="" />
                  <div><small>当前用户</small><strong>登录后同步</strong></div><span>等待客户端登录</span>
                </div>
                <div class="pa-account-grid">
                  <article v-for="item in [{ icon: 'users' as const, label: '账号', hint: '登录后同步' }, { icon: 'shield' as const, label: '钱包', hint: '登录后同步' }, { icon: 'chart' as const, label: '今日用量', hint: '从个人账本加载' }]" :key="item.label">
                    <PoloAiIcon :name="item.icon" /><span>{{ item.label }}</span><strong>—</strong><small>{{ item.hint }}</small>
                  </article>
                </div>
                <button type="button" class="pa-start-button" disabled><PoloAiIcon name="monitor" :size="16" />启动工作环境<span>请先登录客户端</span></button>
              </div>
            </div>
            <div class="pa-story-copy">
              <span>{{ capability.number }} · {{ capability.label }}</span>
              <h3>{{ capability.title }}</h3><p>{{ capability.description }}</p>
              <ul><li v-for="point in capability.points" :key="point"><PoloAiIcon name="check" :size="16" />{{ point }}</li></ul>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section id="security" class="card pa-section pa-security">
      <div class="pa-section-heading">
        <p class="pa-eyebrow"><span></span>安全与隐私</p>
        <h2>看得见连接路径，也能干净地退出</h2>
        <p>连接路径、证书用途与本地状态都能在客户端内查看。</p>
      </div>
      <div class="pa-data-flow" aria-label="PoloAi 数据连接路径">
        <template v-for="(item, index) in [{ name: 'Cursor', icon: 'users' as const }, { name: '本地代理', icon: 'shield' as const }, { name: 'PoloAi 网关', icon: 'monitor' as const }, { name: '模型服务', icon: 'monitor' as const }]" :key="item.name">
          <span><PoloAiIcon :name="item.icon" />{{ item.name }}</span><PoloAiIcon v-if="index < 3" name="arrow" :size="18" />
        </template>
      </div>
      <div class="pa-privacy-grid">
        <article v-for="item in privacyItems" :key="item.title"><PoloAiIcon :name="item.icon" :size="24" /><h3>{{ item.title }}</h3><p>{{ item.description }}</p></article>
      </div>
    </section>

    <section id="faq" class="pa-section">
      <div class="pa-faq-layout">
        <div class="pa-section-heading">
          <p class="pa-eyebrow"><span></span>常见问题</p><h2>使用前，你可能想确认这些</h2>
          <p>更多安装、证书、计费和卸载说明集中维护在使用文档中。</p>
          <router-link :to="docsUrl" class="pa-text-link">打开使用文档 <PoloAiIcon name="arrow" :size="17" /></router-link>
        </div>
        <div class="card pa-faq-list">
          <details v-for="(faq, index) in faqs" :key="faq.question" :open="index === 0">
            <summary><span>0{{ index + 1 }}</span>{{ faq.question }}<PoloAiIcon name="chevron" :size="17" /></summary><p>{{ faq.answer }}</p>
          </details>
        </div>
      </div>
    </section>

    <section id="download" class="card pa-section pa-download">
      <div class="pa-download-heading">
        <div><p class="pa-eyebrow"><span></span>准备开始</p><h2>下载 PoloAi，<br />从一个清楚的连接开始。</h2></div>
        <div><p>安装后在客户端内扫码注册或登录，选择适合自己的计费方式，再从连接页启动 Cursor。</p><span><PoloAiIcon name="shield" :size="17" />Windows 与 macOS 均使用正式下载地址</span></div>
      </div>
      <div class="pa-download-grid">
        <a :href="downloads.windows" download class="pa-download-platform">
          <PoloAiIcon name="windows" :size="32" /><div><small>Windows 客户端</small><h3>Windows 10 / 11</h3><p>64 位 EXE 安装程序</p></div><span><PoloAiIcon name="download" :size="18" />立即下载</span>
        </a>
        <a :href="downloads.macos" download class="pa-download-platform">
          <PoloAiIcon name="apple" :size="34" /><div><small>macOS 客户端</small><h3>通用安装包</h3><p>Apple 芯片与 Intel 芯片</p></div><span><PoloAiIcon name="download" :size="18" />立即下载</span>
        </a>
      </div>
      <div class="pa-download-support">
        <router-link :to="docsUrl"><span>安装与使用说明</span><strong>查看使用文档</strong><PoloAiIcon name="arrow" :size="19" /></router-link>
        <a :href="groupUrl" target="_blank" rel="noopener noreferrer"><span>使用交流与人工支持</span><strong>打开用户交流群</strong><PoloAiIcon name="arrow" :size="19" /></a>
      </div>
    </section>

    <div id="poloai-product-footer" class="card pa-product-footer">
      <div class="pa-footer-grid">
        <div><a href="#top" class="pa-brand"><img :src="site.settings.site_logo || '/logo.png'" alt="" /><span>PoloAi</span></a><p>Cursor 模型连接与用量管理平台</p></div>
        <div><h3>产品</h3><a href="#download">客户端下载</a><a href="#client">客户端演示</a><a href="#metrics">实时数据</a><a href="#capability-usage">透明用量</a></div>
        <div><h3>帮助</h3><router-link :to="docsUrl">使用文档</router-link><a href="#faq">常见问题</a><a :href="groupUrl" target="_blank" rel="noopener noreferrer">用户交流群</a><a href="#metrics">运行状态</a></div>
        <div><h3>关于</h3><a href="#capabilities">关于 PoloAi</a><a href="#security">安全与隐私</a><a href="#capabilities">产品能力</a><a href="#download">开始使用</a></div>
      </div>
      <div class="pa-footer-bottom"><span>© {{ new Date().getFullYear() }} PoloAi。保留所有权利。</span><a href="#metrics">查看服务状态</a></div>
    </div>
  </div>
</template>

<style scoped>
.poloai-page { color: #1c1917; font-size: 14px; line-height: 1.7; }
.poloai-page section[id], .poloai-page article[id], #client { scroll-margin-top: 100px; }
.poloai-page button { font: inherit; cursor: pointer; }
.poloai-page a:focus-visible, .poloai-page button:focus-visible, .poloai-page summary:focus-visible { outline: 2px solid #059669; outline-offset: 4px; }
.pa-announcement { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 11px 16px; margin-bottom: 16px; font-size: 12px; }
.pa-announcement a { display: inline-flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 20px; }
.pa-announcement strong { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }
.pa-announcement button { margin-left: auto; display: inline-flex; flex-shrink: 0; }
.pa-product-nav { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 28px; padding: 17px 24px; margin-bottom: 20px; }
.pa-brand { display: inline-flex; align-items: center; gap: 9px; font-size: 21px; font-weight: 650; white-space: nowrap; }
.pa-brand img { width: 32px; height: 32px; border-radius: 10px; object-fit: cover; }
.pa-section-nav { display: flex; align-items: center; gap: 25px; flex-wrap: wrap; font-size: 12px; color: #57534e; }
.pa-section-nav > a:hover, .pa-section-nav button:hover { color: #059669; }
.pa-nav-menu { position: relative; }
.pa-nav-menu > button { display: flex; align-items: center; gap: 6px; }
.pa-menu-popover { position: absolute; left: -12px; top: 35px; width: 280px; max-width: calc(100vw - 40px); z-index: 20; padding: 10px; border: 1px solid #e7e5e4; border-radius: 12px; background: white; box-shadow: 0 12px 35px #1c191714; }
.pa-menu-popover > p { padding: 7px 10px; margin: 0; font-size: 10px; color: #a8a29e; }
.pa-menu-popover > a { display: block; padding: 12px 10px; border-radius: 8px; }
.pa-menu-popover > a:hover { background: #f0fdf4; }
.pa-menu-popover strong, .pa-menu-popover span { display: block; }
.pa-menu-popover strong { color: #292524; font-size: 12px; font-weight: 600; }
.pa-menu-popover span { color: #78716c; font-size: 10px; margin-top: 4px; }
.pa-login { margin-left: auto; padding: 8px 15px; font-size: 12px; font-weight: 500; }
.pa-hero { padding: 44px 36px 0; overflow: hidden; }
.pa-hero-grid { display: grid; grid-template-columns: 1.45fr 1fr; gap: 48px; align-items: center; padding-bottom: 44px; }
.pa-eyebrow { display: flex; align-items: center; gap: 8px; color: #047857; margin: 0 0 17px; font-size: 11px; font-weight: 600; }
.pa-eyebrow > span { width: 18px; height: 2px; border-radius: 2px; background: #059669; flex-shrink: 0; }
.pa-hero h1 { margin: 0; font-size: clamp(30px, 3.55vw, 47px); line-height: 1.4; letter-spacing: -1.8px; font-weight: 700; }
.pa-hero-copy > p { color: #78716c; font-size: 13px; line-height: 1.9; margin: 0 0 21px; }
.pa-hero-actions { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.pa-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 17px; font-size: 12px; font-weight: 500; }
.pa-text-link { display: inline-flex; align-items: center; gap: 9px; color: #047857; font-size: 12px; font-weight: 500; }
.pa-text-link:hover { color: #059669; }
.pa-platforms { display: flex; gap: 18px; margin-top: 15px; color: #a8a29e; font-size: 10px; }
.pa-platforms > span { display: inline-flex; align-items: center; gap: 5px; }
.pa-platforms svg { color: #78716c; }
.pa-client { padding-top: 25px; border-top: 1px solid #f5f5f4; }
.pa-demo-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.pa-demo-heading strong { font-size: 12px; font-weight: 600; }
.pa-demo-heading p { font-size: 11px; color: #a8a29e; margin: 0; }
.pa-highlights { display: flex; justify-content: center; gap: 12px 28px; flex-wrap: wrap; padding: 23px 0; color: #78716c; font-size: 11px; }
.pa-highlights > span { display: inline-flex; align-items: center; gap: 6px; }
.pa-highlights svg { color: #059669; }
.pa-section { margin-top: 42px; }
.pa-section-heading h2, .pa-download h2 { font-size: 26px; line-height: 1.5; font-weight: 650; letter-spacing: -.6px; margin: 0; }
.pa-section-heading > p:last-of-type { color: #78716c; margin: 13px 0 0; font-size: 12px; }
.pa-section-heading > .pa-eyebrow:last-of-type { color: #047857; margin: 0 0 17px; font-size: 11px; }
.pa-metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 23px; }
.pa-metric-card { padding: 25px; display: flex; flex-direction: column; gap: 5px; }
.pa-metric-card strong { color: #047857; font-size: 32px; font-weight: 600; }
.pa-metric-card span { color: #78716c; font-size: 12px; }
.pa-capabilities-layout { display: grid; grid-template-columns: 170px minmax(0, 1fr); align-items: start; gap: 22px; margin-top: 24px; }
.pa-capability-nav { position: sticky; top: 88px; padding: 8px; }
.pa-capability-nav > a { display: flex; align-items: center; gap: 9px; padding: 14px 10px; border-radius: 9px; font-size: 12px; color: #57534e; }
.pa-capability-nav > a:hover { background: #f0fdf4; color: #047857; }
.pa-capability-nav > a > span { font-size: 10px; color: #a8a29e; }
.pa-capability-nav > a > svg { margin-left: auto; color: #a8a29e; }
.pa-stories { display: grid; gap: 20px; }
.pa-story { padding: 25px; display: grid; grid-template-columns: 1.05fr 1fr; gap: 28px; align-items: center; }
.pa-visual { padding: 20px; border: 1px solid #dcfce7; border-radius: 12px; background: linear-gradient(135deg, #f0fdf4, #fafaf9); min-width: 0; }
.pa-visual-window { padding: 15px; background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; }
.pa-window-heading { display: flex; align-items: center; gap: 9px; padding-bottom: 13px; border-bottom: 1px solid #f5f5f4; font-size: 10px; }
.pa-window-heading strong { font-weight: 600; }
.pa-window-heading > small { margin-left: auto; color: #a8a29e; font-size: 9px; white-space: nowrap; }
.pa-window-dots { display: flex; gap: 3px; }
.pa-window-dots i { width: 5px; height: 5px; border-radius: 50%; background: #d6d3d1; }
.pa-request, .pa-profile { display: flex; align-items: center; gap: 8px; margin: 15px 0 20px; }
.pa-request small, .pa-request strong, .pa-profile small, .pa-profile strong { display: block; }
.pa-request small, .pa-profile small { color: #a8a29e; font-size: 9px; }
.pa-request strong, .pa-profile strong { margin-top: 3px; font-size: 10px; font-weight: 500; }
.pa-request time { margin-left: auto; font-size: 9px; color: #a8a29e; }
.pa-square-icon { width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0; border-radius: 8px; background: #f0fdf4; color: #059669; }
.pa-timeline { display: grid; gap: 19px; }
.pa-timeline > div { position: relative; display: flex; align-items: center; gap: 10px; }
.pa-timeline > div:not(:last-child)::after { position: absolute; content: ''; width: 1px; height: 23px; top: 23px; left: 10px; background: #dcfce7; }
.pa-timeline i { display: grid; place-items: center; flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; color: #059669; background: #f0fdf4; }
.pa-timeline strong, .pa-timeline small { display: block; font-size: 10px; font-weight: 500; }
.pa-timeline small { color: #a8a29e; margin-top: 3px; font-size: 9px; font-weight: 400; }
.pa-story-copy > span { color: #059669; font-size: 11px; }
.pa-story-copy h3 { font-size: 20px; line-height: 1.5; font-weight: 600; margin: 12px 0; }
.pa-story-copy p { color: #78716c; font-size: 12px; line-height: 1.9; margin: 0; }
.pa-story-copy ul { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 7px; }
.pa-story-copy li { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #57534e; }
.pa-story-copy li svg { color: #059669; flex-shrink: 0; }
.pa-billing { margin: 0; }
.pa-billing > div { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 15px; font-size: 10px; padding: 10px 0; border-bottom: 1px solid #f5f5f4; }
.pa-billing dt, .pa-billing span { color: #a8a29e; }
.pa-billing span { font-size: 9px; }
.pa-billing dd { margin: 0; }
.pa-billing-total { display: flex; align-items: center; justify-content: space-between; margin-top: 13px; padding: 12px; background: #f0fdf4; border-radius: 8px; color: #047857; }
.pa-billing-total small, .pa-billing-total strong { display: block; font-size: 9px; }
.pa-billing-total strong { font-size: 10px; font-weight: 500; margin-top: 4px; }
.pa-profile img { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; }
.pa-profile > span { color: #a8a29e; margin-left: auto; font-size: 8px; }
.pa-account-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.pa-account-grid > article { padding: 12px 8px; display: flex; flex-direction: column; border: 1px solid #f5f5f4; border-radius: 8px; background: #fafaf9; }
.pa-account-grid svg { color: #059669; margin-bottom: 8px; }
.pa-account-grid span { font-size: 9px; color: #78716c; }
.pa-account-grid strong { font-size: 20px; font-weight: 500; }
.pa-account-grid small { font-size: 8px; color: #a8a29e; }
.pa-start-button { display: flex; align-items: center; gap: 7px; justify-content: center; flex-wrap: wrap; margin-top: 13px; width: 100%; padding: 10px; border: 1px solid #e7e5e4; border-radius: 8px; background: #fafaf9; color: #a8a29e; font-size: 10px !important; cursor: default !important; }
.pa-start-button span { font-size: 8px; }
.pa-security { padding: 30px; }
.pa-data-flow { display: flex; align-items: center; gap: 20px; margin-top: 25px; padding: 23px 18px; background: #f0fdf4; border: 1px solid #dcfce7; border-radius: 12px; }
.pa-data-flow > span { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; font-size: 12px; color: #047857; }
.pa-data-flow > svg { color: #86bba4; flex-shrink: 0; }
.pa-privacy-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 28px; }
.pa-privacy-grid svg { color: #059669; }
.pa-privacy-grid h3 { font-size: 15px; font-weight: 600; margin: 12px 0 7px; }
.pa-privacy-grid p { color: #78716c; font-size: 12px; line-height: 1.9; margin: 0; }
.pa-faq-layout { display: grid; grid-template-columns: 1fr 1.35fr; gap: 38px; }
.pa-faq .pa-section-heading { padding-top: 5px; }
.pa-faq-layout .pa-text-link { margin-top: 22px; }
.pa-faq-list { padding: 0 23px; }
.pa-faq-list details:not(:last-child) { border-bottom: 1px solid #f5f5f4; }
.pa-faq-list summary { display: flex; align-items: center; gap: 12px; padding: 19px 0; font-size: 12px; font-weight: 500; list-style: none; cursor: pointer; }
.pa-faq-list summary::-webkit-details-marker { display: none; }
.pa-faq-list summary > span { color: #a8a29e; font-size: 10px; }
.pa-faq-list summary > svg { margin-left: auto; color: #a8a29e; flex-shrink: 0; transition: transform .2s; }
.pa-faq-list details[open] summary > svg { transform: rotate(180deg); color: #059669; }
.pa-faq-list details p { color: #78716c; font-size: 11px; line-height: 1.9; margin: 0; padding: 0 20px 20px 25px; }
.pa-download { padding: 32px; }
.pa-download-heading { display: grid; grid-template-columns: 1.25fr 1fr; gap: 50px; align-items: center; }
.pa-download-heading > div:last-child p { color: #78716c; font-size: 12px; margin: 0 0 15px; line-height: 1.9; }
.pa-download-heading > div:last-child span { color: #047857; display: inline-flex; align-items: center; gap: 7px; font-size: 10px; }
.pa-download-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 27px; }
.pa-download-platform { display: flex; align-items: center; gap: 18px; padding: 23px; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 12px; transition: border-color .15s, background .15s; }
.pa-download-platform:hover { border-color: #86efac; background: #f0fdf4; }
.pa-download-platform > svg { color: #047857; flex-shrink: 0; }
.pa-download-platform small { font-size: 10px; color: #a8a29e; }
.pa-download-platform h3 { font-size: 19px; font-weight: 600; margin: 4px 0; }
.pa-download-platform p { color: #78716c; font-size: 10px; margin: 0; }
.pa-download-platform > span { display: flex; gap: 6px; align-items: center; margin-left: auto; color: #047857; font-size: 11px; font-weight: 500; white-space: nowrap; }
.pa-download-support { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 16px; }
.pa-download-support > a { display: flex; gap: 16px; align-items: center; padding: 13px 0; border-bottom: 1px solid #f5f5f4; font-size: 11px; }
.pa-download-support span { color: #a8a29e; }
.pa-download-support strong { font-weight: 500; color: #57534e; }
.pa-download-support svg { margin-left: auto; color: #059669; }
.pa-product-footer { margin-top: 25px; padding: 28px 32px 0; }
.pa-footer-grid { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: 30px; padding-bottom: 25px; }
.pa-footer-grid > div:first-child p { font-size: 11px; color: #a8a29e; margin-top: 12px; }
.pa-footer-grid h3 { font-size: 12px; font-weight: 600; margin: 0 0 12px; }
.pa-footer-grid > div:not(:first-child) a { display: block; font-size: 11px; color: #78716c; margin-top: 8px; }
.pa-footer-grid a:hover { color: #059669; }
.pa-footer-bottom { display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid #f5f5f4; padding: 17px 0; color: #a8a29e; font-size: 10px; }
.pa-footer-bottom a:hover { color: #059669; }
@media (max-width: 1024px) {
  .pa-hero { padding: 30px 25px 0; }
  .pa-hero-grid { gap: 25px; }
  .pa-hero h1 { font-size: 34px; letter-spacing: -1.2px; }
  .pa-capabilities-layout { grid-template-columns: 140px minmax(0, 1fr); gap: 15px; }
  .pa-story { padding: 20px; gap: 20px; }
  .pa-visual { padding: 14px; }
  .pa-story-copy h3 { font-size: 18px; }
  .pa-download-platform { flex-wrap: wrap; gap: 15px; }
  .pa-product-nav { gap: 22px; }
  .pa-section-nav { gap: 18px; }
}
@media (max-width: 800px) {
  .pa-hero-grid { grid-template-columns: 1fr; gap: 20px; }
  .pa-hero h1 { font-size: 39px; }
  .pa-hero-copy { max-width: 520px; }
  .pa-capabilities-layout { grid-template-columns: 1fr; }
  .pa-capability-nav { display: flex; position: static; }
  .pa-capability-nav > a { flex: 1; justify-content: center; }
  .pa-capability-nav > a > svg { display: none; }
  .pa-faq-layout { grid-template-columns: 1fr; gap: 22px; }
  .pa-download-heading { grid-template-columns: 1fr; gap: 20px; }
  .pa-product-nav { gap: 18px; }
  .pa-section-nav { order: 1; width: 100%; gap: 22px; }
}
@media (max-width: 640px) {
  .pa-announcement { padding: 10px 12px; font-size: 10px; }
  .pa-announcement a { justify-content: flex-start; gap: 3px 10px; }
  .pa-product-nav { padding: 15px 17px; }
  .pa-brand { font-size: 19px; }
  .pa-section-nav { position: relative; font-size: 10px; gap: 15px; }
  .pa-nav-menu { position: static; }
  .pa-menu-popover { top: 31px; left: 0; }
  .pa-login { font-size: 10px; padding: 7px 12px; }
  .pa-hero { padding: 26px 17px 0; }
  .pa-hero-grid { padding-bottom: 25px; }
  .pa-hero h1 { font-size: clamp(25px, 7.5vw, 36px); letter-spacing: -1px; }
  .pa-eyebrow { font-size: 9px; gap: 6px; }
  .pa-eyebrow > span { width: 13px; }
  .pa-hero-copy > p { font-size: 11px; }
  .pa-hero-actions { gap: 18px; }
  .pa-button { font-size: 10px; padding: 10px 12px; }
  .pa-text-link { font-size: 10px; }
  .pa-platforms { font-size: 9px; }
  .pa-client { padding-top: 18px; }
  .pa-demo-heading { display: block; }
  .pa-demo-heading strong { font-size: 11px; }
  .pa-demo-heading p { font-size: 10px; margin-top: 7px; }
  .pa-highlights { justify-content: flex-start; gap: 9px 16px; font-size: 9px; }
  .pa-highlights svg { width: 13px; }
  .pa-section { margin-top: 30px; }
  .pa-section-heading h2, .pa-download h2 { font-size: 22px; letter-spacing: -.4px; }
  .pa-section-heading > p:last-of-type { font-size: 11px; }
  .pa-metrics-grid { gap: 9px; margin-top: 17px; }
  .pa-metric-card { padding: 18px 13px; }
  .pa-metric-card strong { font-size: 25px; }
  .pa-metric-card span { font-size: 10px; }
  .pa-capability-nav > a { font-size: 10px; gap: 7px; padding: 10px 5px; }
  .pa-story { grid-template-columns: 1fr; padding: 18px; gap: 21px; }
  .pa-visual { padding: 17px; }
  .pa-story-copy h3 { font-size: 19px; }
  .pa-story-copy p { font-size: 11px; }
  .pa-story-copy li { font-size: 10px; }
  .pa-security { padding: 23px 18px; }
  .pa-data-flow { gap: 6px; padding: 17px 7px; }
  .pa-data-flow > span { flex-direction: column; gap: 8px; font-size: 9px; text-align: center; }
  .pa-data-flow > svg { width: 12px; }
  .pa-privacy-grid { grid-template-columns: 1fr; gap: 25px; }
  .pa-privacy-grid p { font-size: 11px; }
  .pa-faq-list { padding: 0 17px; }
  .pa-faq-list summary { gap: 9px; font-size: 11px; }
  .pa-faq-list details p { padding-left: 22px; padding-right: 0; font-size: 10px; }
  .pa-download { padding: 24px 18px; }
  .pa-download-heading > div:last-child p { font-size: 11px; }
  .pa-download-heading > div:last-child span { font-size: 9px; }
  .pa-download-grid { grid-template-columns: 1fr; gap: 12px; }
  .pa-download-platform { padding: 20px; gap: 15px; }
  .pa-download-platform h3 { font-size: 17px; }
  .pa-download-platform > span { font-size: 10px; }
  .pa-download-support { grid-template-columns: 1fr; gap: 0; }
  .pa-download-support > a { gap: 12px; font-size: 10px; }
  .pa-product-footer { padding: 23px 20px 0; }
  .pa-footer-grid { grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .pa-footer-grid > div:first-child { grid-column: 1 / -1; }
  .pa-footer-grid > div:not(:first-child) a { font-size: 10px; }
  .pa-footer-bottom { flex-wrap: wrap; font-size: 9px; gap: 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .poloai-page *, .poloai-page *::before, .poloai-page *::after { transition: none !important; animation: none !important; }
}
</style>
