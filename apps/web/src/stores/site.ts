import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api';

export interface Announcement {
  id: number;
  title: string;
  content: string;
  popup: boolean;
  popupMode: 'ALWAYS' | 'ONCE' | 'NONE';
  cover?: string;
}

export const useSiteStore = defineStore('site', () => {
  const settings = ref<Record<string, string>>({});
  const announcements = ref<Announcement[]>([]);
  const dialogOpen = ref(false);
  const dialogIdx = ref(0);

  async function loadPublic() {
    try {
      settings.value = await api.publicSettings();
    } catch {}
  }

  async function loadAnnouncements() {
    try {
      const list = await api.announcements();
      announcements.value = list as Announcement[];
      const popups = list.filter((a: Announcement) => a.popup);
      if (popups.length) {
        const always = popups.filter((a: Announcement) => a.popupMode === 'ALWAYS');
        const once = popups.filter((a: Announcement) => a.popupMode !== 'ALWAYS');
        let shouldOpen = always.length > 0;
        if (once.length > 0) {
          try {
            const cache = JSON.parse(localStorage.getItem('ann_dismissed') || '{}');
            const ids = once.map((a: any) => a.id).sort().join(',');
            const cachedIds = (cache.ids || []).sort().join(',');
            if (ids !== cachedIds || Date.now() - (cache.time || 0) >= 24 * 3600 * 1000) {
              shouldOpen = true;
            }
          } catch {
            shouldOpen = true;
          }
        }
        if (shouldOpen) {
          dialogIdx.value = list.findIndex((a: Announcement) => a.popup) ?? 0;
          dialogOpen.value = true;
        }
      }
    } catch {}
  }

  function closeDialog() {
    dialogOpen.value = false;
    const onceIds = announcements.value
      .filter((a) => a.popup && a.popupMode !== 'ALWAYS')
      .map((a) => a.id);
    if (onceIds.length) {
      localStorage.setItem(
        'ann_dismissed',
        JSON.stringify({ ids: onceIds, time: Date.now() }),
      );
    }
  }

  return { settings, announcements, dialogOpen, dialogIdx, loadPublic, loadAnnouncements, closeDialog };
});
