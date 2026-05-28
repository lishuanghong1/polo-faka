<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

const props = defineProps<{
  /** 由父组件 v-model 绑定的 captchaId / captchaCode */
  modelValue: { id: string; code: string };
  /** 输入回车时触发提交 */
  onEnter?: () => void;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: { id: string; code: string }): void;
}>();

const svg = ref('');
const loading = ref(false);

function set(partial: Partial<{ id: string; code: string }>) {
  emit('update:modelValue', { ...props.modelValue, ...partial });
}

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    const r = await api.captcha();
    svg.value = r.svg;
    set({ id: r.id, code: '' });
  } catch {
    ElMessage.error('验证码加载失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}

/** 让父组件在提交失败时可以主动刷新 */
defineExpose({ refresh });

onMounted(refresh);

watch(
  () => props.modelValue.code,
  (v) => {
    // 仅保留字母数字，防止粘贴异常字符
    const clean = (v || '').replace(/[^a-zA-Z0-9]/g, '');
    if (clean !== v) set({ code: clean });
  },
);
</script>

<template>
  <div class="flex items-stretch gap-2">
    <input
      :value="modelValue.code"
      @input="set({ code: ($event.target as HTMLInputElement).value })"
      @keydown.enter="onEnter && onEnter()"
      class="flex-1 px-4 py-2.5 border border-ink-200 rounded-lg text-sm tracking-widest focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 transition placeholder:text-ink-300"
      placeholder="请输入图中字符"
      maxlength="8"
      autocomplete="off"
      inputmode="text"
    />
    <button
      type="button"
      class="relative w-[130px] h-[42px] rounded-lg border border-ink-200 overflow-hidden bg-ink-50/60 flex-shrink-0 hover:border-brand-400 hover:bg-brand-50/40 transition cursor-pointer"
      :title="loading ? '加载中…' : '点击刷新验证码'"
      :disabled="loading"
      @click="refresh"
    >
      <div
        v-if="svg && !loading"
        class="absolute inset-0 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full"
        v-html="svg"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center text-xs text-ink-400">
        {{ loading ? '加载中…' : '点击获取' }}
      </div>
      <!-- 刷新提示 -->
      <div v-if="svg && !loading" class="absolute top-0.5 right-1 text-[9px] text-ink-400 opacity-60">↻</div>
    </button>
  </div>
</template>
