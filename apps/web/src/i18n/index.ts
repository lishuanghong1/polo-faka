import { createI18n } from 'vue-i18n';
import zh from './locales/zh';
import en from './locales/en';

const locale = localStorage.getItem('locale') || 'zh';

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'zh',
  messages: { zh, en },
});

export function setLocale(lang: 'zh' | 'en') {
  i18n.global.locale.value = lang;
  localStorage.setItem('locale', lang);
}
