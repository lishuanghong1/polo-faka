<script setup lang="ts">
// 后台统一搜索框：左侧放大镜图标 + 有内容时右侧清除按钮 + 回车触发。
withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    widthClass?: string;
  }>(),
  {
    modelValue: '',
    placeholder: '搜索…',
    widthClass: 'w-full sm:w-64',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'enter'): void;
  (e: 'clear'): void;
}>();

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function clear() {
  emit('update:modelValue', '');
  emit('clear');
}
</script>

<template>
  <div class="relative" :class="widthClass">
    <svg
      class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" stroke-linecap="round" />
    </svg>
    <input
      :value="modelValue"
      :placeholder="placeholder"
      class="admin-input w-full !pl-9 !pr-8"
      @input="onInput"
      @keydown.enter="emit('enter')"
    />
    <button
      v-if="modelValue"
      type="button"
      class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition"
      aria-label="清除"
      @click="clear"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3 h-3">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>
