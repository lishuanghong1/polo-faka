<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';

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
          <el-dropdown trigger="hover">
            <span class="cursor-pointer hover:text-brand-600 flex items-center gap-1">
              兑换码
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/redeem')">
                  <div class="flex flex-col py-0.5">
                    <div class="font-medium text-ink-900">本站卡密兑换</div>
                    <div class="text-[11px] text-ink-400">RD- 开头 · 直接发卡密</div>
                  </div>
                </el-dropdown-item>
                <el-dropdown-item divided @click="router.push('/forge-redeem')">
                  <div class="flex flex-col py-0.5">
                    <div class="font-medium text-ink-900">三方账号兑换</div>
                    <div class="text-[11px] text-ink-400">FK- 开头 · 选三方商品下单</div>
                  </div>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/email-code')">接验证码</button>
          <div class="px-3 pt-3 pb-1 text-[11px] text-ink-400 uppercase tracking-wider">兑换码</div>
          <button class="px-3 py-2 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/redeem')">
            <div class="flex justify-between items-center">
              <span>本站卡密兑换</span>
              <span class="text-[10px] text-ink-400 font-mono">RD-</span>
            </div>
          </button>
          <button class="px-3 py-2 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/forge-redeem')">
            <div class="flex justify-between items-center">
              <span>三方账号兑换</span>
              <span class="text-[10px] text-ink-400 font-mono">FK-</span>
            </div>
          </button>
          <div class="border-t border-ink-100 my-2"></div>
          <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/query')">订单查询</button>
          <template v-if="user.isLoggedIn">
            <button class="px-3 py-2.5 rounded-lg text-left hover:bg-ink-50 text-ink-700" @click="goAndClose('/me')">个人中心</button>
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
