<script setup lang="ts">
withDefaults(defineProps<{ name: keyof typeof paths; size?: number }>(), { size: 20 });

const paths = {
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 20h14',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 4 4 10-10',
  monitor: 'M4 4h16v12H4zM8 21h8m-4-5v5',
  windows: 'M3 5.2 10.5 4v7.3H3V5.2Zm8.4-1.3L21 2.5v8.8h-9.6V3.9ZM3 12.2h7.5v7.4L3 18.4v-6.2Zm8.4 0H21V21l-9.6-1.4v-7.4Z',
  apple: 'M16.7 12.8c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.9-1.6 0-3.1.9-4 2.4-1.7 3-.4 7.5 1.2 9.9.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.3-.8 1.5 0 2 .8 3.3.8 1.4 0 2.2-1.2 3-2.4.9-1.4 1.3-2.8 1.4-2.9-.1 0-3.2-1.3-3.2-3.8ZM14.3 5.6c.7-.9 1.2-2.1 1.1-3.3-1.1 0-2.4.7-3.2 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.4-.6 3.2-1.4Z',
  shield: 'M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Zm-3 9 2 2 4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M18 6 6 18',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  chart: 'M4 3v17h17M8 14l4-5 4 3 5-7',
  chevron: 'm7 9 5 5 5-5',
  book: 'M12 5v15M3 4h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z',
} as const;
</script>

<template>
  <svg
    :width="size" :height="size" viewBox="0 0 24 24"
    :fill="name === 'windows' || name === 'apple' ? 'currentColor' : 'none'"
    :stroke="name === 'windows' || name === 'apple' ? 'none' : 'currentColor'"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  ><path :d="paths[name]" /></svg>
</template>
