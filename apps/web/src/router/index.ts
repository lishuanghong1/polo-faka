import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';

/** 路由名 → 页面标题（用于 document.title）。未命中则只显示站点名。 */
const ROUTE_TITLES: Record<string, string> = {
  home: '首页',
  product: '商品详情',
  order: '订单详情',
  query: '订单查询',
  login: '登录',
  register: '注册',
  me: '个人中心',
  recharge: '账户充值',
  'recharge-detail': '账户充值',
  redeem: '兑换码下单',
  recycle: '账号回收',
  'aizhp-recycle': '账号退款',
  'customer-refund': '账号退款',
  'forge-product': '商品详情',
  'forge-order': '订单详情',
  'quota-package': '额度包详情',
  'quota-order': '订单详情',
  'email-code-page': '在线接码',
  'cursor-login-tool': 'Token 一键登录',
  'desktop-tool': '桌面工具',
  'mock-pay': '模拟支付',
  'admin-home': '后台概览',
  'admin-products': '商品管理',
  'admin-orders': '订单管理',
  'admin-keys': '卡密池',
  'admin-cats': '分类管理',
  'admin-users': '用户管理',
  'admin-points': '积分管理',
  'admin-anns': '公告管理',
  'admin-pool': '号池',
  'admin-warehouse': '仓库',
  'admin-cursor-sub': '订阅号池',
  'admin-cursor-quota': '额度号池',
  'admin-recycle': '回收管理',
  'admin-settings': '站点设置',
  'admin-audit': '审计日志',
  'admin-abuse': 'IP 黑名单',
  'admin-redeem': '兑换码',
  'admin-forge-products': '三方商品',
  'admin-forge-redeem': '三方兑换码',
  'admin-forge-quota-packages': '额度包',
  'admin-forge-quota-orders': '额度包订单',
  'admin-refund-whitelist': '客户退款名单',
  'admin-token-refunds': 'Token 退款记录',
  'admin-vip': 'VIP 等级',
  'admin-vip-discounts': '商品折扣',
  'admin-aizhp': 'Aizhp 渠道',
};

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('@/pages/Home.vue') },
      {
        path: 'product/:id',
        name: 'product',
        component: () => import('@/pages/ProductDetail.vue'),
      },
      { path: 'order/:orderNo', name: 'order', component: () => import('@/pages/OrderResult.vue') },
      // mock-pay 仅在开发环境暴露
      ...(import.meta.env.DEV
        ? [
            {
              path: 'mock-pay',
              name: 'mock-pay',
              component: () => import('@/pages/MockPay.vue'),
            },
          ]
        : []),
      { path: 'query', name: 'query', component: () => import('@/pages/Query.vue') },
      { path: 'login', name: 'login', component: () => import('@/pages/Login.vue') },
      { path: 'register', name: 'register', component: () => import('@/pages/Register.vue') },
      {
        path: 'me',
        name: 'me',
        component: () => import('@/pages/UserCenter.vue'),
        meta: { auth: true },
      },
      {
        path: 'tools/cursor-login',
        name: 'cursor-login-tool',
        component: () => import('@/pages/CursorLoginTool.vue'),
      },
      {
        path: 'tools/desktop',
        name: 'desktop-tool',
        component: () => import('@/pages/DesktopTool.vue'),
      },
      // 短链兼容：/download → /tools/desktop
      { path: 'download', redirect: '/tools/desktop' },
      { path: 'redeem', name: 'redeem', component: () => import('@/pages/Redeem.vue') },
      { path: 'recycle', name: 'recycle', component: () => import('@/pages/Recycle.vue') },
      { path: 'aizhp-recycle', name: 'aizhp-recycle', component: () => import('@/pages/AizhpRecycle.vue') },
      { path: 'refund', name: 'customer-refund', component: () => import('@/pages/CustomerRefund.vue') },
      {
        path: 'recharge',
        name: 'recharge',
        component: () => import('@/pages/Recharge.vue'),
        meta: { auth: true },
      },
      {
        path: 'recharge/:orderNo',
        name: 'recharge-detail',
        component: () => import('@/pages/Recharge.vue'),
        meta: { auth: true },
      },
      // 兼容旧链接 /forge-redeem，重定向到统一兑换页
      { path: 'forge-redeem', redirect: '/redeem' },
      {
        path: 'forge-product/:typeKey',
        name: 'forge-product',
        component: () => import('@/pages/ForgeProductDetail.vue'),
      },
      {
        path: 'forge-order/:orderNo',
        name: 'forge-order',
        component: () => import('@/pages/ForgeOrder.vue'),
      },
      {
        path: 'quota-package/:packageKey',
        name: 'quota-package',
        component: () => import('@/pages/ForgeQuotaPackageDetail.vue'),
      },
      {
        path: 'quota-order/:orderNo',
        name: 'quota-order',
        component: () => import('@/pages/ForgeQuotaOrder.vue'),
      },
      {
        path: 'email-code',
        name: 'email-code-page',
        component: () => import('@/pages/EmailCodePage.vue'),
      },
    ],
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { auth: true, admin: true },
    children: [
      { path: '', name: 'admin-home', component: () => import('@/pages/admin/Dashboard.vue') },
      { path: 'products', name: 'admin-products', component: () => import('@/pages/admin/Products.vue') },
      { path: 'orders', name: 'admin-orders', component: () => import('@/pages/admin/Orders.vue') },
      { path: 'card-keys', name: 'admin-keys', component: () => import('@/pages/admin/CardKeys.vue') },
      { path: 'categories', name: 'admin-cats', component: () => import('@/pages/admin/Categories.vue') },
      { path: 'users', name: 'admin-users', component: () => import('@/pages/admin/Users.vue') },
      { path: 'points', name: 'admin-points', component: () => import('@/pages/admin/Points.vue') },
      { path: 'announcements', name: 'admin-anns', component: () => import('@/pages/admin/Announcements.vue') },
      { path: 'pool', name: 'admin-pool', component: () => import('@/pages/admin/Pool.vue') },
      { path: 'warehouse', name: 'admin-warehouse', component: () => import('@/pages/admin/Warehouse.vue') },
      { path: 'cursor-sub', name: 'admin-cursor-sub', component: () => import('@/pages/admin/CursorSub.vue') },
      { path: 'cursor-quota', name: 'admin-cursor-quota', component: () => import('@/pages/admin/CursorQuota.vue') },
      { path: 'refund-whitelist', name: 'admin-refund-whitelist', component: () => import('@/pages/admin/RefundWhitelist.vue') },
      { path: 'token-refunds', name: 'admin-token-refunds', component: () => import('@/pages/admin/TokenRefunds.vue') },
      { path: 'recycle', name: 'admin-recycle', component: () => import('@/pages/admin/Recycle.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/pages/admin/Settings.vue') },
      { path: 'audit', name: 'admin-audit', component: () => import('@/pages/admin/Audit.vue') },
      { path: 'abuse', name: 'admin-abuse', component: () => import('@/pages/admin/Abuse.vue') },
      { path: 'redeem-codes', name: 'admin-redeem', component: () => import('@/pages/admin/RedeemCodes.vue') },
      { path: 'forge-products', name: 'admin-forge-products', component: () => import('@/pages/admin/ForgeProducts.vue') },
      { path: 'forge-redeem-codes', name: 'admin-forge-redeem', component: () => import('@/pages/admin/ForgeRedeemCodes.vue') },
      { path: 'forge-quota-packages', name: 'admin-forge-quota-packages', component: () => import('@/pages/admin/ForgeQuotaPackages.vue') },
      { path: 'forge-quota-orders', name: 'admin-forge-quota-orders', component: () => import('@/pages/admin/ForgeQuotaOrders.vue') },
      { path: 'forge-orders', redirect: '/admin/orders' },
      { path: 'vip', name: 'admin-vip', component: () => import('@/pages/admin/Vip.vue') },
      { path: 'vip/discounts', name: 'admin-vip-discounts', component: () => import('@/pages/admin/VipDiscounts.vue') },
      { path: 'aizhp', name: 'admin-aizhp', component: () => import('@/pages/admin/AizhpRefund.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', component: () => import('@/pages/NotFound.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

/**
 * 部署新版本后，还开着的旧页面去懒加载路由 chunk 时，旧 hash 文件已被新构建替换，
 * 浏览器会报 "Failed to fetch dynamically imported module"（表现为菜单点不开）。
 * 这里捕获后自动整页刷新一次拉取新版本；sessionStorage 节流防止坏网络下无限刷新。
 */
const CHUNK_RELOAD_KEY = 'polo:chunk-reload-at';
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload/i;

function reloadOnceForStaleChunk(targetPath?: string): boolean {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
  if (Date.now() - last < 30_000) return false; // 30s 内已刷过 → 大概率不是版本问题，别循环
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  if (targetPath) window.location.href = targetPath;
  else window.location.reload();
  return true;
}

router.onError((error, to) => {
  if (CHUNK_ERROR_RE.test(String((error as Error)?.message ?? error))) {
    if (!reloadOnceForStaleChunk(to?.fullPath)) {
      ElMessage.error('页面资源加载失败，请按 Ctrl+F5 强制刷新');
    }
  }
});

// Vite 的 modulepreload 失败（CSS / 依赖 chunk）也走同一套刷新兜底
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForStaleChunk()) {
    e.preventDefault();
  }
});

router.beforeEach(async (to) => {
  const user = useUserStore();
  // 有 token 但 profile 还没 hydrate（首次进入 / 直接打开受保护页面）→ 先拉一下
  if (user.isLoggedIn && !user.profile) {
    await user.restore();
  }
  if (to.meta.auth && !user.isLoggedIn) {
    ElMessage.info('请先登录');
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.admin && user.profile?.role !== 'ADMIN') {
    ElMessage.error('需要管理员权限');
    return { name: 'home' };
  }
  return true;
});

router.afterEach((to) => {
  let base = 'Polo';
  try {
    base = useSiteStore().settings.site_name || 'Polo';
  } catch {
    /* pinia 尚未就绪时退回默认名 */
  }
  const title = ROUTE_TITLES[to.name as string];
  document.title = title ? `${title} · ${base}` : base;
});

export default router;
