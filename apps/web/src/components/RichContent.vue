<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';

const props = defineProps<{ html?: string | null }>();

// 给所有外链补 target/rel，图片补 referrerpolicy，防止 referrer 泄露
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer');
    node.setAttribute('loading', 'lazy');
  }
});

const safeHtml = computed(() => {
  const raw = (props.html || '').trim();
  if (!raw) return '';
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'loading'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'script'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  });
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="rich-content" v-html="safeHtml"></div>
</template>

<style scoped>
.rich-content {
  font-size: 14px;
  line-height: 1.75;
  color: #44403c;
  word-break: break-word;
}
.rich-content :deep(h1),
.rich-content :deep(h2),
.rich-content :deep(h3),
.rich-content :deep(h4) {
  font-weight: 600;
  color: #1c1917;
  margin: 1em 0 0.5em;
  line-height: 1.4;
}
.rich-content :deep(h1) { font-size: 1.5em; }
.rich-content :deep(h2) { font-size: 1.3em; }
.rich-content :deep(h3) { font-size: 1.15em; }
.rich-content :deep(h4) { font-size: 1em; }
.rich-content :deep(p) { margin: 0.5em 0; }
.rich-content :deep(ul),
.rich-content :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.rich-content :deep(ul) { list-style: disc; }
.rich-content :deep(ol) { list-style: decimal; }
.rich-content :deep(li) { margin: 0.25em 0; }
.rich-content :deep(a) {
  color: #059669;
  text-decoration: underline;
}
.rich-content :deep(blockquote) {
  border-left: 3px solid #d6d3d1;
  padding-left: 1em;
  margin: 0.75em 0;
  color: #78716c;
}
.rich-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 0.5em 0;
}
.rich-content :deep(table) {
  border-collapse: collapse;
  width: auto;
  max-width: 100%;
  margin: 0.75em 0;
}
.rich-content :deep(th),
.rich-content :deep(td) {
  border: 1px solid #e7e5e4;
  padding: 6px 10px;
}
.rich-content :deep(th) { background: #fafaf9; font-weight: 600; }
.rich-content :deep(pre) {
  background: #f5f5f4;
  padding: 0.75em 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.75em 0;
}
.rich-content :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
}
.rich-content :deep(hr) {
  border: none;
  border-top: 1px solid #e7e5e4;
  margin: 1em 0;
}
</style>
