<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useUserStore } from '@/stores/user';
import { useSiteStore } from '@/stores/site';
import { setLocale } from '@/i18n';
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus';

const router = useRouter();
const user = useUserStore();
const site = useSiteStore();
const { t, locale } = useI18n();

function toggleLocale() {
  const next = locale.value === 'zh' ? 'en' : 'zh';
  setLocale(next);
}

function logout() {
  user.logout();
  router.push({ name: 'redeem' });
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Topbar -->
    <header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-100">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <router-link to="/redeem" class="flex items-center gap-2">
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
          <div class="font-semibold text-lg">
            {{ site.settings.site_name || 'Polo AI 小铺' }}
          </div>
        </router-link>

        <nav class="hidden md:flex items-center gap-6 text-sm text-gray-600">
          <router-link to="/redeem" class="hover:text-brand-600">兑换码</router-link>
        </nav>

        <div class="flex items-center gap-3">
          <button class="text-xs text-gray-500 hover:text-brand-600" @click="toggleLocale">
            {{ locale === 'zh' ? 'EN' : '中' }}
          </button>
          <template v-if="user.isLoggedIn && user.profile?.role === 'ADMIN'">
            <el-dropdown>
              <span class="flex items-center gap-2 cursor-pointer text-sm">
                <div class="w-7 h-7 rounded-full brand-gradient flex items-center justify-center text-white text-xs font-semibold">
                  A
                </div>
                <span class="hidden sm:inline">管理员</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="router.push('/admin')">{{ t('common.admin') }}</el-dropdown-item>
                  <el-dropdown-item divided @click="logout">{{ t('common.logout') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <router-view />
    </main>

    <footer class="border-t border-ink-100 bg-white">
      <div class="max-w-7xl mx-auto px-4 py-6 text-center text-xs text-ink-400 space-y-1">
        <div>
          © {{ new Date().getFullYear() }} {{ site.settings.site_name || 'Polo AI 小铺' }}
          <template v-if="site.settings.footer_note"> · {{ site.settings.footer_note }}</template>
        </div>
        <div v-if="site.settings.cs_qq || site.settings.cs_telegram || site.settings.cs_wechat" class="text-ink-500">
          <span v-if="site.settings.cs_qq">客服 QQ: {{ site.settings.cs_qq }}</span>
          <span v-if="site.settings.cs_telegram" class="ml-3">TG: {{ site.settings.cs_telegram }}</span>
          <span v-if="site.settings.cs_wechat" class="ml-3">微信: {{ site.settings.cs_wechat }}</span>
        </div>
        <div v-if="site.settings.site_icp">{{ site.settings.site_icp }}</div>
      </div>
    </footer>
  </div>
</template>
