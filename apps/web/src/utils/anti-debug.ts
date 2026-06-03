/// <reference types="vite/client" />
/**
 * 前端反调试 / 防控制台。
 *
 * 注意：这是「防君子不防小人」的措施 —— 任何反调试都可以被绕过（关掉 JS、
 * 用 Charles 抓包、改本地 hosts 跳过等）。它的真正价值是：
 *   1. 提高普通用户的窥探门槛（90% 用户会被劝退）
 *   2. 把决心调试的人逼到桌面端，留下水印 / 可追踪痕迹
 *
 * 真正的安全永远靠后端 —— 这部分的代码已经做好（鉴权 / 限流 / 加密 / 审计）。
 *
 * 默认在 production 生效；通过 VITE_ANTI_DEBUG=false 可关闭。
 * 同时可通过 url 加 ?devtools=1 + localStorage 里设置开发凭证短路放行（仅 dev 模式）。
 */

// 用类型断言绕过环境类型不全的问题（部分项目没装 vite/client 三斜杠）
const META_ENV: Record<string, string | boolean | undefined> =
  ((import.meta as any).env as Record<string, string | boolean | undefined>) || {};

const ENABLED = !!META_ENV.PROD && META_ENV.VITE_ANTI_DEBUG !== 'false';

type Mode = 'block' | 'warn' | 'silent';
const MODE: Mode = ((META_ENV.VITE_ANTI_DEBUG_MODE as Mode) || 'block');

let started = false;

/**
 * 从 localStorage 里取当前 token 并解 base64 payload 拿 role。
 * 注意：前端不验签，但这无关安全 —— 反调试本来就是「劝退普通用户」，
 * 即使有人伪造 JWT 让反调试关掉，他也只是看到自己本应能看到的页面而已，
 * 真正的接口鉴权在后端用 HS256 + JWT_SECRET 兜底。
 */
/**
 * 检测是否为移动端 / 触屏设备。
 *
 * 移动端必须关掉两个检测：
 *  1. 窗口尺寸差检测：手机 outerHeight 包含浏览器外壳（地址栏 + 系统栏），
 *     和 innerHeight 的差常驻 100–300px；输入框弹起虚拟键盘时 innerHeight 还会
 *     瞬间被砍半，几乎 100% 命中"检测到 DevTools"误判。
 *  2. debugger 语句耗时检测：低端机 / GC 卡顿很容易让 debugger noop
 *     的耗时偶发 > 100ms，误判为命中断点。
 *
 * 手机端本身也没有 F12 / 停靠 DevTools 这种"小白能打开"的入口
 * （要 USB 远程调试，已经在"决心调试的人"档位，不在我们劝退范围）。
 */
function isMobileLike(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // 1. UA 关键字（最直接）
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile Safari/i.test(ua)) {
    return true;
  }
  // 2. UA-CH（新 Chrome 已用 Client Hints 替代 UA）
  if ((navigator as any).userAgentData?.mobile) return true;
  // 3. 触屏 + 小屏：兜底 iPad / 国产浏览器伪装 UA
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const isCoarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (hasTouch && (isCoarse || Math.min(window.innerWidth, window.innerHeight) < 768)) {
    return true;
  }
  return false;
}

function isAdminFromToken(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const token = localStorage.getItem('website_token');
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    // URL-safe base64 → 标准 base64
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '==='.slice((padded.length + 3) % 4));
    const payload = JSON.parse(json);
    if (payload?.role !== 'ADMIN') return false;
    // 顺手做一下过期校验（exp 是秒）
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function showBlocker(reason: string) {
  if (typeof document === 'undefined') return;
  // 已经渲染过了就别重复
  if (document.getElementById('__anti_debug_blocker')) return;

  const div = document.createElement('div');
  div.id = '__anti_debug_blocker';
  div.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'background:#0b1220',
    'color:#e2e8f0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'flex-direction:column',
    'font-family:system-ui,-apple-system,sans-serif',
    'text-align:center',
    'padding:24px',
    'user-select:none',
  ].join(';');
  div.innerHTML = `
    <div style="font-size:48px;margin-bottom:16px;">🛡️</div>
    <div style="font-size:20px;font-weight:600;margin-bottom:8px;">页面已暂停</div>
    <div style="font-size:14px;color:#94a3b8;max-width:480px;line-height:1.7;">
      检测到调试工具，出于安全考虑页面已被锁定。<br/>
      请关闭浏览器开发者工具后刷新页面继续访问。
    </div>
    <div style="font-size:12px;color:#64748b;margin-top:24px;opacity:.6;">${reason}</div>
  `;
  document.body.appendChild(div);
}

let bypassed = false;

function blockOrWarn(reason: string) {
  if (bypassed) return;
  if (MODE === 'silent') return;
  if (MODE === 'warn') {
    // 不挡用户，仅一次 toast 之类（这里简单 console.warn 给开发者）
    console.warn('[anti-debug]', reason);
    return;
  }
  showBlocker(reason);
}

/**
 * 登录成 ADMIN 后调用：抑制所有后续告警，并撤掉已渲染的遮罩。
 * 已经挂上的事件监听 / setInterval 不会被卸载（成本不值），但都会被 bypassed 短路。
 */
export function bypassAntiDebugForAdmin() {
  bypassed = true;
  const el = typeof document !== 'undefined'
    ? document.getElementById('__anti_debug_blocker')
    : null;
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/**
 * 1. 禁用右键菜单（防止「检查元素」入口）
 */
function disableContextMenu() {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
}

/**
 * 2. 屏蔽常见 DevTools 快捷键
 *    F12 / Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C / Ctrl+U
 */
function disableShortcuts() {
  window.addEventListener('keydown', (e) => {
    const key = e.key?.toLowerCase();
    if (key === 'f12') {
      e.preventDefault();
      blockOrWarn('快捷键被禁用');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(key)) {
      e.preventDefault();
      blockOrWarn('快捷键被禁用');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'u') {
      e.preventDefault();
      blockOrWarn('快捷键被禁用');
      return;
    }
  });
}

/**
 * 3. DevTools 打开检测 —— 用窗口尺寸差。
 *    DevTools 停靠时 outerWidth/Height 与 innerWidth/Height 差距明显（一般 > 160px）。
 *    分离窗口检测不到，但绝大多数小白都是停靠模式。
 */
function detectByWindowSize() {
  const threshold = 160;
  const check = () => {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    if (widthDiff > threshold || heightDiff > threshold) {
      blockOrWarn('检测到开发者工具');
    }
  };
  setInterval(check, 1000);
}

/**
 * 4. debugger 拖时检测 —— 主流方法。
 *    在 console.log(对象) 时若有 DevTools 打开，对象的 getter 会被触发。
 *    或通过 `debugger` + performance.now() 测量执行时间。
 */
function detectByDebuggerStmt() {
  const check = () => {
    const t0 = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const dt = performance.now() - t0;
    // 没开 DevTools 时 debugger 是 noop；开了会触发断点暂停（>100ms）
    if (dt > 100) {
      blockOrWarn('检测到调试器');
    }
  };
  setInterval(check, 1500);
}

/**
 * 5. console getter trick —— DevTools 在打印对象时会访问其属性。
 *    给一个 toString 触发 getter，能感知到 console 面板被打开。
 */
function detectByConsoleGetter() {
  const bait: any = /./;
  bait.toString = () => {
    blockOrWarn('检测到控制台被打开');
    return '';
  };
  setInterval(() => {
    console.log(bait);
    console.clear();
  }, 2000);
}

/**
 * 6. 清空原始 console 方法 —— 用户即便打开了控制台也看不到任何输出。
 */
function muteConsole() {
  if (typeof window === 'undefined' || !window.console) return;
  const noop = () => undefined;
  const methods: string[] = [
    'log',
    'debug',
    'info',
    'warn',
    'error',
    'trace',
    'table',
    'group',
    'groupEnd',
    'groupCollapsed',
    'dir',
    'dirxml',
    'count',
    'time',
    'timeEnd',
    'timeLog',
    'profile',
    'profileEnd',
    'assert',
  ];
  for (const m of methods) {
    try {
      (window.console as any)[m] = noop;
    } catch {
      /* readonly 浏览器忽略 */
    }
  }
}

export function startAntiDebug() {
  if (!ENABLED || started) return;

  // 管理员旁路：登录 token 里 role=ADMIN 时跳过反调试，方便日常排障。
  // 切换登录态后需刷新页面才会重新判定。
  if (isAdminFromToken()) {
    started = true;
    // 兼顾“开发者控制台不被静音”，啥也不挂，啥也不监听。
    return;
  }

  started = true;

  const mobile = isMobileLike();

  // 给一些反应时间（极慢的浏览器加载时可能误触发尺寸检测）
  setTimeout(() => {
    disableContextMenu();
    disableShortcuts();
    // 移动端关掉尺寸差和 debugger 检测：误判率太高（虚拟键盘 / GC 卡顿）。
    // 桌面端两项都开，是当前小白调试入口的主要拦截点。
    if (!mobile) {
      detectByWindowSize();
      detectByDebuggerStmt();
    }
    detectByConsoleGetter();
    muteConsole();
  }, 600);
}
