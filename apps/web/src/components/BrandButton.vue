<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  icon?: boolean; // 是否纯图标，调整 padding 为方形
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  block: false,
  loading: false,
  disabled: false,
  type: 'button',
  icon: false,
});

defineEmits<{ (e: 'click', ev: MouseEvent): void }>();

const classes = computed(() => {
  const base = [
    'inline-flex items-center justify-center gap-1.5 font-medium',
    'rounded-lg select-none whitespace-nowrap',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ];

  const variants: Record<NonNullable<Props['variant']>, string> = {
    primary:
      'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm disabled:hover:bg-brand-600',
    secondary:
      'bg-white text-ink-700 border border-ink-200 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50/50',
    ghost:
      'text-ink-600 hover:text-brand-700 hover:bg-brand-50/60',
    danger:
      'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm',
    subtle:
      'bg-brand-50 text-brand-700 border border-brand-100 hover:bg-brand-100 hover:border-brand-200',
  };

  const sizes: Record<NonNullable<Props['size']>, string> = {
    sm: props.icon ? 'h-8 w-8' : 'h-8 px-3 text-xs',
    md: props.icon ? 'h-10 w-10' : 'h-10 px-4 text-sm',
    lg: props.icon ? 'h-12 w-12' : 'h-12 px-6 text-base',
  };

  return [
    ...base,
    variants[props.variant],
    sizes[props.size],
    props.block ? 'w-full' : '',
  ].join(' ');
});
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    @click="(ev) => !loading && !disabled && $emit('click', ev)"
  >
    <span v-if="loading" class="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
    <slot />
  </button>
</template>
