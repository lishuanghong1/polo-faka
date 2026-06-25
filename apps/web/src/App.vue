<script setup lang="ts">
import { onMounted } from 'vue';
import { useSiteStore } from '@/stores/site';
import { useUserStore } from '@/stores/user';
import AnnouncementDialog from '@/components/AnnouncementDialog.vue';
import TopProgress from '@/components/TopProgress.vue';

const site = useSiteStore();
const user = useUserStore();

onMounted(async () => {
  await Promise.allSettled([
    site.loadPublic(),
    site.loadAnnouncements(),
    user.restore(),
  ]);
});
</script>

<template>
  <TopProgress />
  <router-view />
  <AnnouncementDialog />
</template>
