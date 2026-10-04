<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import createDOMPurify from 'dompurify';
import PoloAiIcon from '@/components/PoloAiIcon.vue';
import docsContent from '@/content/poloai-docs.json';

interface DocsArticle {
  slug: string;
  title: string;
  summary: string;
  updatedAt: string;
  html: string;
  headings: { id: string; title: string; level: number }[];
}
interface DocsContent {
  title: string;
  description: string;
  articles: DocsArticle[];
}

const docs = docsContent as DocsContent;
const route = useRoute();
const router = useRouter();
const articleBody = ref<HTMLElement | null>(null);
const tocOpen = ref(false);
const activeHeading = ref('');
// 独立实例避免 RichContent 注册的全局 hook 改变文档内链的打开方式。
const purifier = createDOMPurify(window);
let headingObserver: IntersectionObserver | undefined;

const slug = computed(() => {
  const value = route.params.slug;
  return Array.isArray(value) ? value[0] || '' : String(value || '');
});
const articleIndex = computed(() => docs.articles.findIndex((item) => item.slug === slug.value));
const article = computed(() => docs.articles[articleIndex.value]);
const previousArticle = computed(() => docs.articles[articleIndex.value - 1]);
const nextArticle = computed(() => articleIndex.value >= 0 ? docs.articles[articleIndex.value + 1] : undefined);

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
  }).format(date);
}

const safeHtml = computed(() => {
  if (!article.value) return '';
  const sanitized = purifier.sanitize(article.value.html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'loading', 'decoding'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'textarea', 'button', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  });
  const container = document.createElement('div');
  container.innerHTML = sanitized;

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const url = new URL(href, window.location.origin + route.path);
    const internal = href.startsWith('#') || (url.origin === window.location.origin && url.pathname.startsWith('/poloai'));
    if (internal) {
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } else {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });

  container.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('referrerpolicy', 'no-referrer');
    if (!image.getAttribute('src') || image.closest('a')) return;
    const link = document.createElement('a');
    link.href = image.src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'docs-image-link';
    link.title = '点击查看原图';
    link.setAttribute('aria-label', image.alt ? `查看原图：${image.alt}` : '查看文档截图原图');
    image.replaceWith(link);
    link.appendChild(image);
  });

  container.querySelectorAll('table').forEach((table) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'docs-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '文档表格，可横向滚动');
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
  return container.innerHTML;
});

function scrollToHash(hash: string) {
  if (!hash) return;
  let id = hash.slice(1);
  try { id = decodeURIComponent(id); } catch { /* 保留无法解码的原始锚点。 */ }
  const target = document.getElementById(id);
  if (target && articleBody.value?.contains(target)) {
    activeHeading.value = id;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function goToHeading(id: string) {
  tocOpen.value = false;
  const hash = `#${encodeURIComponent(id)}`;
  if (route.hash !== hash) await router.replace({ path: route.path, query: route.query, hash });
  await nextTick();
  scrollToHash(hash);
}

function handleArticleClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || !articleBody.value?.contains(link)) return;
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    event.preventDefault();
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch { /* 使用原始锚点。 */ }
    void goToHeading(id);
    return;
  }
  const url = new URL(href, window.location.origin + route.path);
  if (url.origin === window.location.origin && (url.pathname === '/poloai' || url.pathname.startsWith('/poloai/docs'))) {
    event.preventDefault();
    void router.push(url.pathname + url.search + url.hash);
  }
}

watch([slug, () => route.hash], async () => {
  await nextTick();
  document.title = article.value ? `${article.value.title} · PoloAi 使用文档` : slug.value ? '文档未找到 · PoloAi' : `${docs.title} · PoloAi`;
  headingObserver?.disconnect();
  activeHeading.value = article.value?.headings[0]?.id || '';
  if (articleBody.value && 'IntersectionObserver' in window) {
    headingObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) activeHeading.value = visible[0].target.id;
    }, { rootMargin: '-96px 0px -65% 0px' });
    articleBody.value.querySelectorAll('h2[id], h3[id]').forEach((heading) => headingObserver?.observe(heading));
  }
  scrollToHash(route.hash);
}, { immediate: true, flush: 'post' });

onBeforeUnmount(() => headingObserver?.disconnect());
</script>

<template>
  <div class="poloai-docs max-w-7xl mx-auto px-4 py-6 md:py-8">
    <nav class="docs-breadcrumb" aria-label="面包屑">
      <router-link to="/poloai">PoloAi 客户端</router-link>
      <span aria-hidden="true">/</span>
      <router-link v-if="slug" to="/poloai/docs">使用文档</router-link>
      <span v-else class="docs-breadcrumb-current">使用文档</span>
      <template v-if="article">
        <span aria-hidden="true">/</span>
        <span class="docs-breadcrumb-current">{{ article.title }}</span>
      </template>
    </nav>

    <template v-if="!slug">
      <header class="card docs-intro">
        <div class="docs-eyebrow"><PoloAiIcon name="book" :size="17" /> POLOAI DOCS</div>
        <h1>{{ docs.title }}</h1>
        <p>{{ docs.description }}</p>
        <router-link to="/poloai" class="docs-home-link">PoloAi 客户端官网 <PoloAiIcon name="arrow" :size="16" /></router-link>
      </header>
      <div class="docs-directory" aria-label="全部使用文档">
        <router-link v-for="(item, index) in docs.articles" :key="item.slug" :to="`/poloai/docs/${item.slug}`" class="card docs-directory-card">
          <div class="docs-card-top"><span>{{ String(index + 1).padStart(2, '0') }}</span><PoloAiIcon name="arrow" :size="17" /></div>
          <h2>{{ item.title }}</h2>
          <p>{{ item.summary }}</p>
          <div v-if="item.updatedAt" class="docs-date">更新于 <time :datetime="item.updatedAt">{{ formatUpdatedAt(item.updatedAt) }}</time></div>
        </router-link>
      </div>
    </template>

    <div v-else-if="article" class="docs-article-layout">
      <article class="card docs-article">
        <header class="docs-article-header">
          <router-link to="/poloai/docs" class="docs-back-link"><PoloAiIcon name="arrow" :size="15" /> 全部文档</router-link>
          <h1>{{ article.title }}</h1>
          <p v-if="article.summary" class="docs-article-summary">{{ article.summary }}</p>
          <p v-if="article.updatedAt" class="docs-date">更新于 <time :datetime="article.updatedAt">{{ formatUpdatedAt(article.updatedAt) }}</time></p>
        </header>
        <div ref="articleBody" class="docs-body" @click="handleArticleClick" v-html="safeHtml"></div>
        <nav class="docs-pagination" aria-label="文档翻页">
          <router-link v-if="previousArticle" :to="`/poloai/docs/${previousArticle.slug}`" class="docs-page-link">
            <span>上一篇</span><strong>{{ previousArticle.title }}</strong>
          </router-link>
          <span v-else></span>
          <router-link v-if="nextArticle" :to="`/poloai/docs/${nextArticle.slug}`" class="docs-page-link docs-page-next">
            <span>下一篇</span><strong>{{ nextArticle.title }}</strong>
          </router-link>
        </nav>
      </article>

      <aside class="card docs-sidebar" aria-label="文档导航">
        <div class="docs-sidebar-heading">
          <h2>本文目录</h2>
          <button type="button" class="docs-toc-toggle" :aria-expanded="tocOpen" aria-controls="poloai-docs-sidebar-content" :aria-label="tocOpen ? '收起文档目录' : '展开文档目录'" @click="tocOpen = !tocOpen">
            <PoloAiIcon name="chevron" :size="18" :class="{ 'docs-chevron-open': tocOpen }" />
          </button>
        </div>
        <div id="poloai-docs-sidebar-content" class="docs-sidebar-content" :class="{ 'is-open': tocOpen }">
          <nav v-if="article.headings.length" class="docs-toc" aria-label="本文章节">
            <a v-for="heading in article.headings" :key="heading.id" :href="`#${encodeURIComponent(heading.id)}`" :class="{ 'docs-toc-nested': heading.level > 2, 'is-active': activeHeading === heading.id }" :aria-current="activeHeading === heading.id ? 'location' : undefined" @click.prevent="goToHeading(heading.id)">{{ heading.title }}</a>
          </nav>
          <p v-else class="docs-empty-toc">本篇文档没有章节目录</p>
          <div class="docs-sidebar-divider"></div>
          <details class="docs-all-articles">
            <summary>全部文档 <span>{{ docs.articles.length }} 篇</span></summary>
            <nav aria-label="所有文档">
              <router-link v-for="item in docs.articles" :key="item.slug" :to="`/poloai/docs/${item.slug}`" :class="{ 'is-active': item.slug === slug }" :aria-current="item.slug === slug ? 'page' : undefined">{{ item.title }}</router-link>
            </nav>
          </details>
          <router-link to="/poloai" class="docs-sidebar-home">PoloAi 客户端官网 <PoloAiIcon name="arrow" :size="15" /></router-link>
        </div>
      </aside>
    </div>

    <section v-else class="card docs-not-found">
      <PoloAiIcon name="book" :size="36" />
      <h1>文档未找到</h1>
      <p>这篇文档暂时无法访问，你可以从文档目录继续查看使用说明。</p>
      <router-link to="/poloai/docs" class="brand-gradient docs-return-button">返回文档目录 <PoloAiIcon name="arrow" :size="16" /></router-link>
    </section>
  </div>
</template>

<style scoped>
.poloai-docs { color: #44403c; }
.docs-breadcrumb { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-bottom: 20px; color: #a8a29e; font-size: 13px; }
.docs-breadcrumb a { color: #78716c; transition: color .18s; }
.docs-breadcrumb a:hover { color: #047857; }
.docs-breadcrumb-current { color: #44403c; overflow-wrap: anywhere; }
.docs-intro { padding: 38px 40px; margin-bottom: 24px; background: linear-gradient(120deg, #fff 55%, #f0fdf4); }
.docs-eyebrow { display: flex; align-items: center; gap: 8px; color: #047857; font-size: 11px; font-weight: 700; letter-spacing: .13em; }
.docs-intro h1 { margin-top: 15px; color: #1c1917; font-size: clamp(28px, 4vw, 38px); font-weight: 700; line-height: 1.25; letter-spacing: -.04em; }
.docs-intro p { margin-top: 16px; max-width: 780px; color: #78716c; font-size: 15px; line-height: 1.85; white-space: pre-line; }
.docs-home-link { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; color: #047857; font-size: 13px; font-weight: 600; }
.docs-directory { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.docs-directory-card { display: flex; flex-direction: column; min-width: 0; padding: 24px; transition: border-color .18s, transform .18s, box-shadow .18s; }
.docs-directory-card:hover { transform: translateY(-2px); border-color: #a7d7c6; box-shadow: 0 8px 24px -14px rgb(6 95 70 / 25%); }
.docs-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; color: #047857; }
.docs-card-top span { padding: 4px 8px; border-radius: 7px; background: #f0fdf4; font-size: 11px; font-weight: 700; }
.docs-directory-card h2 { color: #292524; font-size: 17px; font-weight: 650; line-height: 1.55; overflow-wrap: anywhere; }
.docs-directory-card p { flex: 1; margin-top: 10px; color: #78716c; font-size: 13px; line-height: 1.8; white-space: pre-line; overflow-wrap: anywhere; }
.docs-directory-card .docs-date { margin-top: 20px; padding-top: 15px; border-top: 1px solid #f5f5f4; }
.docs-date { color: #a8a29e; font-size: 12px; line-height: 1.6; }
.docs-article-layout { display: grid; grid-template-columns: minmax(0, 1fr) 245px; gap: 24px; align-items: start; }
.docs-article { min-width: 0; padding: 34px 40px 30px; }
.docs-article-header { padding-bottom: 24px; margin-bottom: 26px; border-bottom: 1px solid #e7e5e4; }
.docs-back-link { display: inline-flex; align-items: center; gap: 7px; color: #047857; font-size: 12px; }
.docs-back-link svg { transform: rotate(180deg); }
.docs-article-header h1 { margin-top: 20px; color: #1c1917; font-size: clamp(25px, 3.2vw, 34px); font-weight: 700; line-height: 1.4; letter-spacing: -.035em; overflow-wrap: anywhere; }
.docs-article-summary { margin-top: 14px; color: #78716c; font-size: 14px; line-height: 1.85; white-space: pre-line; }
.docs-article-header .docs-date { margin-top: 14px; }
.docs-sidebar { position: sticky; top: 88px; min-width: 0; max-height: calc(100vh - 112px); padding: 22px 19px; overflow-y: auto; }
.docs-sidebar-heading { display: flex; align-items: center; justify-content: space-between; }
.docs-sidebar-heading h2 { color: #292524; font-size: 13px; font-weight: 700; }
.docs-toc-toggle { display: none; color: #78716c; padding: 5px; border-radius: 6px; }
.docs-toc-toggle:hover { background: #f5f5f4; }
.docs-chevron-open { transform: rotate(180deg); }
.docs-toc { display: grid; gap: 3px; margin: 15px -7px 0; }
.docs-toc a, .docs-all-articles nav a { display: block; padding: 7px 10px; border-radius: 7px; color: #78716c; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.docs-toc a:hover, .docs-all-articles nav a:hover { background: #fafaf9; color: #047857; }
.docs-toc a.is-active, .docs-all-articles nav a.is-active { color: #047857; background: #f0fdf4; font-weight: 600; }
.docs-toc a.docs-toc-nested { padding-left: 21px; font-size: 11px; }
.docs-empty-toc { margin-top: 15px; color: #a8a29e; font-size: 12px; }
.docs-sidebar-divider { height: 1px; margin: 20px 0; background: #e7e5e4; }
.docs-all-articles summary { color: #57534e; font-size: 12px; font-weight: 600; cursor: pointer; }
.docs-all-articles summary span { margin-left: 8px; color: #a8a29e; font-size: 11px; font-weight: 400; }
.docs-all-articles nav { display: grid; gap: 3px; margin: 10px -7px 0; }
.docs-sidebar-home { display: flex; align-items: center; gap: 6px; margin-top: 20px; color: #047857; font-size: 12px; }
.docs-pagination { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 38px; padding-top: 26px; border-top: 1px solid #e7e5e4; }
.docs-page-link { display: grid; gap: 7px; padding: 15px 17px; border: 1px solid #e7e5e4; border-radius: 12px; transition: border-color .18s; }
.docs-page-link:hover { border-color: #6ee7b7; }
.docs-page-link span { color: #a8a29e; font-size: 11px; }
.docs-page-link strong { color: #047857; font-size: 13px; font-weight: 600; line-height: 1.65; overflow-wrap: anywhere; }
.docs-page-next { text-align: right; }
.docs-not-found { display: flex; flex-direction: column; align-items: center; padding: 64px 24px; text-align: center; }
.docs-not-found > svg { color: #047857; }
.docs-not-found h1 { margin-top: 20px; color: #292524; font-size: 26px; font-weight: 700; }
.docs-not-found p { margin-top: 12px; color: #78716c; font-size: 14px; line-height: 1.8; }
.docs-return-button { display: inline-flex; align-items: center; gap: 10px; padding: 11px 18px; margin-top: 24px; border-radius: 10px; color: white; font-size: 13px; }
.docs-body { min-width: 0; color: #44403c; font-size: 14px; line-height: 1.95; overflow-wrap: anywhere; }
.docs-body :deep(h1), .docs-body :deep(h2), .docs-body :deep(h3), .docs-body :deep(h4), .docs-body :deep(h5), .docs-body :deep(h6) { color: #292524; font-weight: 650; line-height: 1.55; scroll-margin-top: 100px; }
.docs-body :deep(h1) { margin: 1.8em 0 .7em; font-size: 1.65em; }
.docs-body :deep(h2) { margin: 1.9em 0 .7em; font-size: 1.4em; }
.docs-body :deep(h3) { margin: 1.7em 0 .6em; font-size: 1.18em; }
.docs-body :deep(h4), .docs-body :deep(h5), .docs-body :deep(h6) { margin: 1.5em 0 .6em; font-size: 1.05em; }
.docs-body :deep(> :first-child) { margin-top: 0; }
.docs-body :deep(p) { margin: .8em 0; }
.docs-body :deep(strong) { color: #292524; font-weight: 650; }
.docs-body :deep(ul), .docs-body :deep(ol) { margin: .9em 0; padding-left: 1.65em; }
.docs-body :deep(ul) { list-style: disc; }
.docs-body :deep(ol) { list-style: decimal; }
.docs-body :deep(li) { margin: .45em 0; }
.docs-body :deep(li > p) { margin: .4em 0; }
.docs-body :deep(a) { color: #047857; text-decoration: underline; text-underline-offset: 3px; }
.docs-body :deep(a:hover) { color: #065f46; }
.docs-body :deep(blockquote) { margin: 1.2em 0; padding: 10px 17px; border-left: 3px solid #10b981; border-radius: 0 9px 9px 0; background: #f0fdf4; color: #57534e; }
.docs-body :deep(blockquote > :first-child) { margin-top: 0; }
.docs-body :deep(blockquote > :last-child) { margin-bottom: 0; }
.docs-body :deep(figure) { min-width: 0; margin: 1.4em 0; }
.docs-body :deep(img) { display: block; width: auto; max-width: 100%; height: auto; border: 1px solid #e7e5e4; border-radius: 10px; margin: 1em auto; }
.docs-body :deep(.docs-image-link) { display: block; cursor: zoom-in; }
.docs-body :deep(figcaption) { margin-top: 8px; color: #78716c; font-size: 12px; line-height: 1.7; text-align: center; }
.docs-body :deep(.docs-table-scroll) { max-width: 100%; margin: 1.3em 0; overflow-x: auto; border: 1px solid #e7e5e4; border-radius: 9px; }
.docs-body :deep(table) { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.7; overflow-wrap: normal; }
.docs-body :deep(th), .docs-body :deep(td) { min-width: 100px; padding: 11px 14px; border-bottom: 1px solid #e7e5e4; text-align: left; vertical-align: top; }
.docs-body :deep(th) { color: #292524; background: #fafaf9; font-weight: 600; }
.docs-body :deep(tr:last-child td) { border-bottom: 0; }
.docs-body :deep(pre) { max-width: 100%; margin: 1.2em 0; padding: 17px 19px; border: 1px solid #e7e5e4; border-radius: 10px; background: #fafaf9; overflow-x: auto; line-height: 1.8; tab-size: 2; }
.docs-body :deep(code), .docs-body :deep(kbd), .docs-body :deep(samp) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: .88em; }
.docs-body :deep(:not(pre) > code), .docs-body :deep(kbd) { padding: .18em .4em; border-radius: 4px; background: #f5f5f4; color: #065f46; }
.docs-body :deep(pre code) { padding: 0; background: transparent; color: #44403c; white-space: pre; overflow-wrap: normal; }
.docs-body :deep(hr) { border: 0; border-top: 1px solid #e7e5e4; margin: 2em 0; }
.docs-body :deep(details) { margin: 1.2em 0; padding: 13px 17px; border: 1px solid #e7e5e4; border-radius: 9px; }
.docs-body :deep(summary) { cursor: pointer; color: #292524; font-weight: 600; }
.docs-directory-card:focus-visible, .docs-page-link:focus-visible, .docs-toc a:focus-visible, .docs-body :deep(a:focus-visible), .docs-body :deep(.docs-table-scroll:focus-visible) { outline: 2px solid #10b981; outline-offset: 3px; }
@media (max-width: 1050px) {
  .docs-directory { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .docs-article-layout { grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
  .docs-article { padding: 28px; }
}
@media (max-width: 850px) {
  .docs-article-layout { display: flex; flex-direction: column; gap: 16px; }
  .docs-article { width: 100%; }
  .docs-sidebar { position: static; order: -1; width: 100%; max-height: none; padding: 15px 18px; }
  .docs-toc-toggle { display: inline-flex; }
  .docs-sidebar-content { display: none; }
  .docs-sidebar-content.is-open { display: block; }
  .docs-toc { max-height: 42vh; overflow-y: auto; }
}
@media (max-width: 560px) {
  .docs-breadcrumb { font-size: 12px; gap: 7px; margin-bottom: 16px; }
  .docs-intro { padding: 28px 23px; margin-bottom: 18px; }
  .docs-intro p { font-size: 14px; }
  .docs-directory { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .docs-directory-card { padding: 22px; }
  .docs-card-top { margin-bottom: 15px; }
  .docs-article { padding: 24px 19px; }
  .docs-article-header { margin-bottom: 22px; padding-bottom: 21px; }
  .docs-article-summary, .docs-body { font-size: 13px; }
  .docs-article-header h1 { margin-top: 17px; }
  .docs-pagination { gap: 10px; padding-top: 21px; margin-top: 29px; }
  .docs-page-link { padding: 13px 12px; }
  .docs-page-link strong { font-size: 12px; }
  .docs-body :deep(pre) { padding: 13px 14px; }
  .docs-body :deep(th), .docs-body :deep(td) { min-width: 90px; padding: 9px 11px; }
}
</style>
