import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useUserStore } from '@/stores/user';

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
      { path: 'mock-pay', name: 'mock-pay', component: () => import('@/pages/MockPay.vue') },
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
        path: 'tools/activate',
        name: 'activate',
        component: () => import('@/pages/ActivateTool.vue'),
      },
      { path: 'redeem', name: 'redeem', component: () => import('@/pages/Redeem.vue') },
      {
        path: 'forge-redeem',
        name: 'forge-redeem',
        component: () => import('@/pages/ForgeRedeem.vue'),
      },
      {
        path: 'forge-order/:orderNo',
        name: 'forge-order',
        component: () => import('@/pages/ForgeOrder.vue'),
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
      { path: 'announcements', name: 'admin-anns', component: () => import('@/pages/admin/Announcements.vue') },
      { path: 'pool', name: 'admin-pool', component: () => import('@/pages/admin/Pool.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/pages/admin/Settings.vue') },
      { path: 'audit', name: 'admin-audit', component: () => import('@/pages/admin/Audit.vue') },
      { path: 'redeem-codes', name: 'admin-redeem', component: () => import('@/pages/admin/RedeemCodes.vue') },
      { path: 'forge-products', name: 'admin-forge-products', component: () => import('@/pages/admin/ForgeProducts.vue') },
      { path: 'forge-redeem-codes', name: 'admin-forge-redeem', component: () => import('@/pages/admin/ForgeRedeemCodes.vue') },
      { path: 'forge-orders', name: 'admin-forge-orders', component: () => import('@/pages/admin/ForgeOrders.vue') },
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
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.admin && user.profile?.role !== 'ADMIN') {
    return { name: 'home' };
  }
  return true;
});

export default router;
