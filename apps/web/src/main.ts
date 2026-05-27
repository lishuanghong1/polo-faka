import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './styles/tailwind.css';
import './styles/global.scss';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import { startAntiDebug } from './utils/anti-debug';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(i18n);
app.use(ElementPlus);

app.mount('#app');

// 生产环境启用反调试（VITE_ANTI_DEBUG=false 可关闭）
startAntiDebug();
