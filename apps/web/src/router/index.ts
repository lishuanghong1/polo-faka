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
  'forge-product': '商品详情',
  'forge-order': '订单详情',
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
  'admin-recycle': '回收管理',
  'admin-settings': '站点设置',
  'admin-audit': '审计日志',
  'admin-abuse': 'IP 黑名单',
  'admin-redeem': '兑换码',
  'admin-forge-products': '三方商品',
  'admin-forge-redeem': '三方兑换码',
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
      { path: 'recycle', name: 'admin-recycle', component: () => import('@/pages/admin/Recycle.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/pages/admin/Settings.vue') },
      { path: 'audit', name: 'admin-audit', component: () => import('@/pages/admin/Audit.vue') },
      { path: 'abuse', name: 'admin-abuse', component: () => import('@/pages/admin/Abuse.vue') },
      { path: 'redeem-codes', name: 'admin-redeem', component: () => import('@/pages/admin/RedeemCodes.vue') },
      { path: 'forge-products', name: 'admin-forge-products', component: () => import('@/pages/admin/ForgeProducts.vue') },
      { path: 'forge-redeem-codes', name: 'admin-forge-redeem', component: () => import('@/pages/admin/ForgeRedeemCodes.vue') },
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
