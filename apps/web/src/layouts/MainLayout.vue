<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';

const router = useRouter();
const user = useUserStore();
const site = useSiteStore();

function logout() {
  user.logout();
  router.push({ name: 'home' });
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gradient-to-b from-ink-50/40 to-white">
    <!-- Topbar -->
    <header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-ink-100">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <router-link to="/" class="flex items-center gap-2 shrink-0">
          <img
            v-if="site.settings.site_logo"
            :src="site.settings.site_logo"
            class="w-9 h-9 rounded-xl object-cover"
            alt="logo"
          />
          <div
            v-else
            class="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold"
          >
            {{ (site.settings.site_name || 'P')[0]?.toUpperCase() }}
          </div>
          <div class="font-semibold text-lg whitespace-nowrap">
            {{ site.settings.site_name || 'Polo 接码' }}
          </div>
        </router-link>

        <nav class="hidden md:flex items-center gap-6 text-sm text-ink-600">
          <router-link to="/" class="hover:text-brand-600">首页</router-link>
          <router-link to="/email-code" class="hover:text-brand-600">接验证码</router-link>
          <router-link to="/forge-redeem" class="hover:text-brand-600">兑换码</router-link>
          <router-link to="/query" class="hover:text-brand-600">订单查询</router-link>
        </nav>

        <div class="flex items-center gap-3">
          <template v-if="user.isLoggedIn">
            <el-dropdown>
              <span class="flex items-center gap-2 cursor-pointer text-sm">
                <div class="w-7 h-7 rounded-full brand-gradient flex items-center justify-center text-white text-xs font-semibold">
                  {{ user.profile?.nickname?.[0] || user.profile?.username?.[0] || 'U' }}
                </div>
                <span class="hidden sm:inline">{{ user.profile?.nickname || user.profile?.username }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="router.push('/me')">个人中心</el-dropdown-item>
                  <el-dropdown-item v-if="user.profile?.role === 'ADMIN'" @click="router.push('/admin')">
                    后台
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="logout">退出</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <router-link to="/login" class="text-sm text-ink-700 hover:text-brand-600 hidden sm:inline">
              登录
            </router-link>
          </template>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <router-view />
    </main>

    <footer class="border-t border-ink-100 bg-white">
      <div class="max-w-7xl mx-auto px-4 py-5 text-center text-xs text-ink-400 space-y-1">
        <div>
          © {{ new Date().getFullYear() }} {{ site.settings.site_name || 'Polo 接码' }}
          <template v-if="site.settings.footer_note"> · {{ site.settings.footer_note }}</template>
        </div>
        <div v-if="site.settings.site_icp">{{ site.settings.site_icp }}</div>
      </div>
    </footer>
  </div>
</template>
