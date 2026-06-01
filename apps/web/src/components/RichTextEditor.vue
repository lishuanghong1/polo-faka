<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css';
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Editor, Toolbar } from '@wangeditor/editor-for-vue';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    height?: string;
  }>(),
  { placeholder: '请输入商品介绍，可设置标题、加粗、颜色、列表、插入图片/链接……', height: '320px' },
);

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

// editor 实例必须用 shallowRef
const editorRef = shallowRef<IDomEditor>();
const valueHtml = ref(props.modelValue || '');

// 外部值变化时同步进编辑器（仅在不同的时候，避免光标跳动）
watch(
  () => props.modelValue,
  (v) => {
    const nv = v || '';
    if (nv !== valueHtml.value) valueHtml.value = nv;
  },
);

// 编辑器内容变化时回传
watch(valueHtml, (v) => {
  if (v !== props.modelValue) emit('update:modelValue', v);
});

const toolbarConfig: Partial<IToolbarConfig> = {
  // 去掉需要后端 / 不常用的功能：视频、全屏
  excludeKeys: ['group-video', 'insertVideo', 'uploadVideo', 'fullScreen'],
};

const editorConfig: Partial<IEditorConfig> = {
  placeholder: props.placeholder,
  MENU_CONF: {
    // 图片：不走上传服务器，改为输入 URL 插入（与站点其它图片字段保持一致，避免把 base64 塞进数据库）
    uploadImage: {
      customBrowseAndUpload(insertFn: (url: string, alt: string, href: string) => void) {
        const url = window.prompt('请输入图片地址（URL）');
        const v = (url || '').trim();
        if (v) insertFn(v, '', '');
      },
    },
  },
};

function handleCreated(editor: IDomEditor) {
  editorRef.value = editor;
}

onBeforeUnmount(() => {
  editorRef.value?.destroy();
});
</script>

<template>
  <div class="rich-editor border border-ink-200 rounded-lg overflow-hidden">
    <Toolbar
      :editor="editorRef"
      :default-config="toolbarConfig"
      mode="default"
      class="border-b border-ink-200 bg-ink-50/50"
    />
    <Editor
      v-model="valueHtml"
      :default-config="editorConfig"
      mode="default"
      :style="{ height: props.height, overflowY: 'auto' }"
      @on-created="handleCreated"
    />
  </div>
</template>

<style scoped>
.rich-editor :deep(.w-e-text-container) {
  background: #fff;
}
.rich-editor :deep(.w-e-bar) {
  flex-wrap: wrap;
}
</style>
