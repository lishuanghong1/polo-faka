<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const user = useUserStore();

const groups = [
  {
    label: '运营',
    items: [
      { to: '/admin', icon: 'M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10', label: '概览', exact: true },
      { to: '/admin/orders', icon: 'M9 12h6m-6 4h6M5 8h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2zm0 0V6a2 2 0 012-2h10a2 2 0 012 2v2', label: '订单' },
      { to: '/admin/users', icon: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 20c0-3 4-5 8-5s8 2 8 5', label: '用户' },
    ],
  },
  {
    label: '商品',
    items: [
      { to: '/admin/products', icon: 'M20 7l-8-4-8 4m16 0v10l-8 4m8-14L12 11M4 7v10l8 4m-8-14l8 4m0 0v10', label: '商品' },
      { to: '/admin/categories', icon: 'M4 6h16M4 12h16M4 18h16', label: '分类' },
      { to: '/admin/card-keys', icon: 'M15 7a4 4 0 11-8 0 4 4 0 018 0zM10 11l5 5m0 0l3-3m-3 3l-3-3', label: '卡密池' },
      { to: '/admin/redeem-codes', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z', label: '兑换码' },
    ],
  },
  {
    label: '高阶',
    items: [
      { to: '/admin/pool', icon: 'M4 18l4-2 4 4 4-4 4 2M4 14l4-2 4 4 4-4 4 2M4 10l4-2 4 4 4-4 4 2', label: '号池' },
      { to: '/admin/announcements', icon: 'M11 5h2a2 2 0 012 2v12l-3-2-3 2V7a2 2 0 012-2zM5 9h2M5 13h2M5 17h2', label: '公告' },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/admin/settings', icon: 'M10 3v2a2 2 0 11-4 0V3M20 14v4a2 2 0 01-2 2h-4M4 4l4 4m12 8l-4-4m0 0l4-4M10 14l-4 4M12 15a3 3 0 100-6 3 3 0 000 6z', label: '站点设置' },
      { to: '/admin/audit', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: '审计日志' },
    ],
  },
];

const currentLabel = computed(() => {
  for (const g of groups) {
    for (const item of g.items) {
      if (item.exact ? route.path === item.to : route.path.startsWith(item.to)) {
        return item.label;
      }
    }
  }
  return '后台';
});

function logout() {
  user.logout();
  router.push('/');
}
</script>

<template>
  <div class="min-h-screen flex bg-ink-50">
    <!-- Sidebar -->
    <aside class="w-60 bg-white border-r border-ink-100 flex flex-col">
      <!-- Brand -->
      <div class="h-14 flex items-center px-4 border-b border-ink-100">
        <div class="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold mr-2.5 text-sm">
          P
        </div>
        <div class="font-semibold text-ink-900">Polo Admin</div>
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
        <div v-for="g in groups" :key="g.label">
          <div class="px-2 mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-ink-400">
            {{ g.label }}
          </div>
          <div class="space-y-0.5">
            <router-link
              v-for="m in g.items"
              :key="m.to"
              :to="m.to"
              class="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-ink-600 hover:bg-ink-50 hover:text-ink-900 transition-colors"
              :exact-active-class="m.exact ? 'bg-brand-50 !text-brand-700 font-medium' : ''"
              :active-class="m.exact ? '' : 'bg-brand-50 !text-brand-700 font-medium'"
            >
              <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path :d="m.icon" />
              </svg>
              <span>{{ m.label }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <!-- User -->
      <div class="px-3 py-3 border-t border-ink-100 flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-ink-100 text-ink-700 flex items-center justify-center text-xs font-semibold">
          {{ user.profile?.username?.[0]?.toUpperCase() }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-ink-900 truncate">{{ user.profile?.nickname || user.profile?.username }}</div>
          <div class="text-[11px] text-ink-400">管理员</div>
        </div>
        <button class="text-ink-400 hover:text-ink-900 text-xs" title="退出" @click="logout">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 16l4-4m0 0l-4-4m4 4H9M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4" />
          </svg>
        </button>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <!-- Top bar -->
      <header class="h-14 bg-white border-b border-ink-100 flex items-center justify-between px-6 shrink-0">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-ink-400">Polo</span>
          <span class="text-ink-300">/</span>
          <span class="font-medium text-ink-900">{{ currentLabel }}</span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <router-link to="/" class="text-ink-500 hover:text-ink-900" target="_blank">
            <svg class="w-4 h-4 inline mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7m0-7L10 14M5 5h6V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-6h-2v6H5V5z"/></svg>
            访问前台
          </router-link>
        </div>
      </header>

      <!-- Page -->
      <div class="flex-1 overflow-auto">
        <div class="max-w-7xl mx-auto p-6">
          <router-view />
        </div>
      </div>
    </main>
  </div>
</template>
