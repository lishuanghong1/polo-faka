<script setup lang="ts">
interface Props {
  variant?: 'text' | 'line' | 'block' | 'circle' | 'orderRow' | 'productCard';
  width?: string;
  height?: string;
  rows?: number;
}
const props = withDefaults(defineProps<Props>(), {
  variant: 'line',
  rows: 1,
});

function styleFor(w?: string, h?: string) {
  const s: Record<string, string> = {};
  if (w) s.width = w;
  if (h) s.height = h;
  return s;
}
</script>

<template>
  <!-- 单条线 -->
  <div
    v-if="variant === 'line'"
    class="skeleton"
    :style="styleFor(width ?? '100%', height ?? '14px')"
  />

  <!-- 短文本 -->
  <div
    v-else-if="variant === 'text'"
    class="space-y-2"
  >
    <div
      v-for="i in props.rows"
      :key="i"
      class="skeleton"
      :style="styleFor(i === props.rows && props.rows > 1 ? '60%' : '100%', '12px')"
    />
  </div>

  <!-- 圆形（头像/缩略图） -->
  <div
    v-else-if="variant === 'circle'"
    class="skeleton rounded-full"
    :style="styleFor(width ?? '40px', height ?? '40px')"
  />

  <!-- 长方块 -->
  <div
    v-else-if="variant === 'block'"
    class="skeleton"
    :style="styleFor(width ?? '100%', height ?? '120px')"
  />

  <!-- 订单条目骨架 -->
  <div v-else-if="variant === 'orderRow'" class="card p-4 flex items-center gap-3">
    <div class="skeleton rounded-lg shrink-0" style="width:44px;height:44px" />
    <div class="flex-1 space-y-2 min-w-0">
      <div class="skeleton" style="width:60%;height:13px" />
      <div class="skeleton" style="width:35%;height:11px" />
    </div>
    <div class="space-y-2 shrink-0 text-right">
      <div class="skeleton ml-auto" style="width:64px;height:14px" />
      <div class="skeleton ml-auto" style="width:48px;height:11px" />
    </div>
  </div>

  <!-- 商品卡片骨架 -->
  <div v-else-if="variant === 'productCard'" class="card p-5 space-y-3">
    <div class="flex items-start gap-3">
      <div class="skeleton rounded-lg shrink-0" style="width:48px;height:48px" />
      <div class="flex-1 space-y-2 min-w-0">
        <div class="skeleton" style="width:80%;height:14px" />
        <div class="skeleton" style="width:55%;height:11px" />
      </div>
    </div>
    <div class="flex items-end justify-between pt-2">
      <div class="skeleton" style="width:80px;height:22px" />
      <div class="skeleton" style="width:56px;height:14px" />
    </div>
  </div>
</template>
