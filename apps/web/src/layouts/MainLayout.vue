<script setup lang="ts">
import { useSiteStore } from '@/stores/site';

const site = useSiteStore();
</script>

<template>
  <div class="min-h-screen flex flex-col bg-gradient-to-b from-ink-50/40 to-white">
    <!-- Topbar -->
    <header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-ink-100">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <router-link to="/" class="flex items-center gap-2">
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
            {{ site.settings.site_name || 'Polo 接码' }}
          </div>
        </router-link>
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
