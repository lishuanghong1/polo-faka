<script setup lang="ts">
import { onMounted } from 'vue';
import { useSiteStore } from '@/stores/site';
import { useUserStore } from '@/stores/user';
import AnnouncementDialog from '@/components/AnnouncementDialog.vue';

const site = useSiteStore();
const user = useUserStore();

onMounted(async () => {
  await Promise.all([
    site.loadPublic(),
    site.loadAnnouncements(),
    user.restore(),
  ]);
});
</script>

<template>
  <router-view />
  <AnnouncementDialog />
</template>
