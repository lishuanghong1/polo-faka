<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

/**
 * 直接从 GitHub Releases 拉最新版本展示下载链接。
 * GitHub API 匿名速率：60 次/小时/IP，对桌面工具下载页足够；超限时退化到
 * https://github.com/.../releases/latest 让用户自己挑。
 */
const REPO = 'lishuanghong1/polo-faka';
const TAG_PREFIX = 'desktop-v';

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
  created_at: string;
}

interface Release {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
  assets: ReleaseAsset[];
  prerelease: boolean;
  draft: boolean;
}

const release = ref<Release | null>(null);
const loading = ref(true);
const apiError = ref('');

async function loadRelease() {
  loading.value = true;
  apiError.value = '';
  try {
    // 列出 releases，挑第一个 tag_name 以 desktop-v 开头、非 draft 的
    const resp = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
    const list = (await resp.json()) as Release[];
    release.value =
      list.find((r) => !r.draft && r.tag_name.startsWith(TAG_PREFIX)) || null;
  } catch (e: any) {
    apiError.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadRelease);

// ─────── 平台识别 ───────
type OsKey = 'windows' | 'macos-arm' | 'macos-intel' | 'linux' | 'unknown';

const currentOs = computed<OsKey>(() => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  const platform = ((navigator as any).platform || '').toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac') || platform.includes('mac')) {
    // Apple Silicon vs Intel：UA 不直接给出，但可以猜：M 系列 Mac 在最新 Chrome 上 platform 仍是 MacIntel，但 navigator.userAgentData 在 Chromium 里有 arch。
    const uaData = (navigator as any).userAgentData;
    if (uaData?.getHighEntropyValues) {
      // 异步检测在 setup 里不易拿，这里给个 arm 偏好（Apple Silicon 是现在主流）
      return 'macos-arm';
    }
    return 'macos-arm';
  }
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
});

const osLabel: Record<OsKey, string> = {
  windows: 'Windows',
  'macos-arm': 'macOS (Apple Silicon)',
  'macos-intel': 'macOS (Intel)',
  linux: 'Linux',
  unknown: '其它平台',
};

interface PlatformGroup {
  os: OsKey;
  title: string;
  hint: string;
  picks: Array<{ label: string; ext: string[]; recommended?: boolean }>;
}

const platformGroups: PlatformGroup[] = [
  {
    os: 'windows',
    title: 'Windows',
    hint: '64 位 · Win 10 / 11 自带 WebView2，无需额外安装',
    picks: [
      { label: '推荐：MSI 安装包', ext: ['.msi'], recommended: true },
      { label: 'NSIS 安装包', ext: ['-setup.exe', '_setup.exe'] },
    ],
  },
  {
    os: 'macos-arm',
    title: 'macOS · Apple Silicon (M 系列)',
    hint: '首次打开如提示「文件已损坏」，参见底部说明',
    picks: [
      { label: '推荐：DMG 安装包', ext: ['aarch64.dmg', 'arm64.dmg'], recommended: true },
    ],
  },
  {
    os: 'macos-intel',
    title: 'macOS · Intel',
    hint: '旧款 Intel Mac 专用',
    picks: [
      { label: 'DMG 安装包', ext: ['x64.dmg', 'x86_64.dmg', 'amd64.dmg'], recommended: true },
    ],
  },
  {
    os: 'linux',
    title: 'Linux',
    hint: '需要 WebKitGTK 4.1；现代发行版基本自带',
    picks: [
      { label: '通用：AppImage', ext: ['.AppImage'], recommended: true },
      { label: 'Debian / Ubuntu', ext: ['.deb'] },
      { label: 'RHEL / Fedora', ext: ['.rpm'] },
    ],
  },
];

function pickAsset(
  ext: string[] | string,
): ReleaseAsset | null {
  if (!release.value) return null;
  const tests = Array.isArray(ext) ? ext : [ext];
  for (const t of tests) {
    const found = release.value.assets.find((a) =>
      a.name.toLowerCase().endsWith(t.toLowerCase()),
    );
    if (found) return found;
  }
  return null;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString('zh-CN', { hour12: false });
}

const recommendedForCurrentOs = computed(() => {
  const group = platformGroups.find((g) => g.os === currentOs.value);
  if (!group) return null;
  for (const p of group.picks) {
    const asset = pickAsset(p.ext);
    if (asset) return { group, pick: p, asset };
  }
  return null;
});
</script>

<template>
  <section class="max-w-3xl mx-auto px-4 py-8">
    <header class="text-center mb-6">
      <h1 class="text-2xl md:text-3xl font-bold text-ink-900">下载 Polo 桌面账号工具</h1>
      <p class="mt-2 text-sm text-ink-500 leading-relaxed">
        本地工具：粘贴卡密一键写入 Cursor · 多账号管理 · 实时查用量 · 号池自动换号<br />
        全部操作均在本机完成，不向我们的服务器发送 token
      </p>
    </header>

    <!-- 当前平台推荐 -->
    <section
      v-if="recommendedForCurrentOs"
      class="card p-5 md:p-6 mb-6 bg-gradient-to-br from-brand-50/80 to-white border-brand-200"
    >
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-ink-500">检测到你的系统</div>
          <div class="text-base font-semibold text-ink-900">{{ osLabel[currentOs] }}</div>
        </div>
      </div>
      <a
        :href="recommendedForCurrentOs.asset.browser_download_url"
        class="block w-full text-center px-5 py-3 rounded-xl brand-gradient text-white text-sm font-medium hover:opacity-90 transition"
      >
        立即下载 · {{ recommendedForCurrentOs.pick.label }}（{{ fmtSize(recommendedForCurrentOs.asset.size) }}）
      </a>
      <p class="mt-2 text-[11px] text-ink-500 text-center">
        版本 {{ release?.tag_name }} · 发布于 {{ fmtDate(release?.published_at) }}
      </p>
    </section>

    <!-- 加载中 -->
    <div v-if="loading" class="card p-10 text-center text-ink-400 text-sm">
      加载下载链接…
    </div>

    <!-- API 失败兜底 -->
    <div v-else-if="apiError && !release" class="card p-6 text-center space-y-3">
      <div class="text-sm text-rose-600">无法从 GitHub 拉取下载信息：{{ apiError }}</div>
      <a
        :href="`https://github.com/${REPO}/releases/latest`"
        target="_blank"
        rel="noopener"
        class="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700"
      >
        前往 GitHub Releases 手动下载
      </a>
    </div>

    <!-- 还没有发布 -->
    <div v-else-if="!release" class="card p-6 text-center space-y-2">
      <div class="text-sm text-ink-700">尚未发布桌面工具版本。</div>
      <div class="text-xs text-ink-500">关注 GitHub Releases 页面或稍后再来。</div>
    </div>

    <!-- 全平台列表 -->
    <section v-else class="card p-5 md:p-6">
      <div class="text-sm font-semibold text-ink-900 mb-4">所有平台下载</div>
      <div class="space-y-4">
        <div
          v-for="group in platformGroups"
          :key="group.os"
          class="border border-ink-100 rounded-xl p-4"
        >
          <div class="flex items-baseline justify-between flex-wrap gap-2 mb-2">
            <div>
              <div class="text-sm font-medium text-ink-900">{{ group.title }}</div>
              <div class="text-[11px] text-ink-500 mt-0.5">{{ group.hint }}</div>
            </div>
            <span
              v-if="group.os === currentOs"
              class="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200"
            >当前平台</span>
          </div>
          <div class="space-y-1.5">
            <template v-for="p in group.picks" :key="p.label">
              <a
                v-if="pickAsset(p.ext)"
                :href="pickAsset(p.ext)!.browser_download_url"
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-ink-50 transition group"
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span
                    v-if="p.recommended"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                  >推荐</span>
                  <span class="text-sm text-ink-800">{{ p.label }}</span>
                  <span class="text-[11px] text-ink-400 font-mono truncate">{{ pickAsset(p.ext)!.name }}</span>
                </div>
                <span class="text-xs text-ink-500 group-hover:text-brand-700 shrink-0">
                  {{ fmtSize(pickAsset(p.ext)!.size) }} ↓
                </span>
              </a>
              <div
                v-else
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm text-ink-400"
              >
                <span>{{ p.label }}</span>
                <span class="text-xs">未发布</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="mt-4 text-[11px] text-ink-500 text-center">
        所有发布版本：
        <a
          :href="`https://github.com/${REPO}/releases`"
          target="_blank"
          rel="noopener"
          class="text-brand-600 hover:underline"
        >GitHub Releases</a>
      </div>
    </section>

    <!-- 常见问题 -->
    <section class="mt-6 card p-5 md:p-6">
      <h2 class="text-sm font-semibold text-ink-900 mb-3">常见问题</h2>
      <div class="space-y-3 text-xs text-ink-600 leading-relaxed">
        <div>
          <div class="text-ink-800 font-medium mb-1">Q: macOS 提示「文件已损坏」？</div>
          <p>这是 macOS 对未签名应用的默认提示。打开终端，执行：</p>
          <code class="block mt-1 px-3 py-2 bg-ink-50 rounded text-[11px] font-mono whitespace-pre-wrap break-all">
sudo xattr -rd com.apple.quarantine "/Applications/Polo 账号工具.app"
          </code>
        </div>
        <div>
          <div class="text-ink-800 font-medium mb-1">Q: Windows Defender 报毒？</div>
          <p>未做代码签名的小工具常被启发式误报。可右键安装包 → 属性 → 解除阻止；或在 Defender 提示窗口选「仍要运行」。我们后续会接代码签名。</p>
        </div>
        <div>
          <div class="text-ink-800 font-medium mb-1">Q: 这个工具会上传我的账号到你们服务器吗？</div>
          <p>不会。所有读写都在本机执行：写入的是 Cursor 自己的本地存储；查用量调的是 Cursor 自己的接口。号池切换需要登录商城账号，只把账号操作请求发到我们的商城后端，token 本身不离开你的电脑。</p>
        </div>
        <div>
          <div class="text-ink-800 font-medium mb-1">Q: 怎么卸载？</div>
          <p>Windows：控制面板 → 程序和功能 → 卸载 Polo 账号工具<br/>
          macOS：把 Applications 里的 .app 拖到废纸篓<br/>
          数据残留：可手动删 <code class="font-mono">%APPDATA%\PoloAccountTool</code>（Win）或 <code class="font-mono">~/Library/Application Support/PoloAccountTool</code>（Mac）</p>
        </div>
      </div>
    </section>
  </section>
</template>
