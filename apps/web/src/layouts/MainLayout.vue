<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';
void ElDropdown; void ElDropdownMenu; void ElDropdownItem;

const router = useRouter();
const user = useUserStore();
const site = useSiteStore();

const mobileOpen = ref(false);

function logout() {
  user.logout();
  router.push({ name: 'home' });
}

function goAndClose(path: string) {
  mobileOpen.value = false;
  router.push(path);
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gradient-to-b from-ink-50/40 to-white">
    <!-- Topbar -->
    <header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-ink-100">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <router-link to="/" class="flex items-center gap-2 shrink-0">
          <img
            :src="site.settings.site_logo || '/logo.png'"
            class="w-9 h-9 rounded-xl object-cover"
            alt="logo"
          />
          <div class="font-semibold text-lg whitespace-nowrap">
            {{ site.settings.site_name || 'Polo 接码' }}
          </div>
        </router-link>

        <nav class="hidden md:flex items-center gap-6 text-sm text-ink-600">
          <router-link to="/" class="hover:text-brand-600">首页</router-link>
          <router-link to="/me" class="hover:text-brand-600">个人中心</router-link>
          <router-link to="/recharge" class="hover:text-brand-600">账户充值</router-link>
          <router-link to="/query" class="hover:text-brand-600">订单查询</router-link>
          <router-link to="/recycle" class="hover:text-brand-600">回收</router-link>
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
                  <el-dropdown-item @click="router.push('/recharge')">账户充值</el-dropdown-item>
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

          <!-- 移动端汉堡 -->
          <button
            class="md:hidden p-1.5 -mr-1.5 text-ink-700 hover:text-brand-600"
            :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'"
            @click="mobileOpen = !mobileOpen"
          >
            <svg v-if="!mobileOpen" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6l-12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 移动端菜单 -->
      <div
        v-if="mobileOpen"
        class="md:hidden border-t border-ink-100 bg-white"
      >
        <nav class="max-w-7xl mx-auto px-4 py-3 grid gap-1 text-sm">
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/')">首页</button>
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/me')">个人中心</button>
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/recharge')">账户充值</button>
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/query')">订单查询</button>
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/recycle')">回收</button>
          <template v-if="user.isLoggedIn">
            <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/me')">个人中心</button>
            <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/recharge')">账户充值</button>
            <button
              v-if="user.profile?.role === 'ADMIN'"
              class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-brand-700"
              @click="goAndClose('/admin')"
            >管理后台</button>
            <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-rose-600" @click="logout">退出登录</button>
          </template>
          <template v-else>
            <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/login')">登录 / 注册</button>
          </template>
        </nav>
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
