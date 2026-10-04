<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';

const componentId = useId();
const tabs = [
  { key: 'account', label: '账号', icon: 'M12 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6' },
  { key: 'connection', label: '连接', icon: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h5M12 17h5' },
  { key: 'usage', label: '用量', icon: 'M3 12h4l2.2-6 4.2 12 2.2-6H21' },
  { key: 'shop', label: '商城', icon: 'M5 8h14l-1 12H6L5 8ZM9 9V6a3 3 0 0 1 6 0v3' },
  { key: 'settings', label: '设置', icon: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6' },
] as const;
type TabKey = (typeof tabs)[number]['key'];
const activeTab = ref<TabKey>('usage');
const contentElement = ref<HTMLElement | null>(null);
const usageView = ref('我的用量');
const dateRange = ref('7d');
const dateRanges = ['1d', '3d', '7d', '30d', '自定义'];
const startDate = ref('');
const endDate = ref('');
const shopView = ref('权益包');
const selectedGroup = ref('全部');
const groupNames = ref(['全部', '未分组']);
const groupEditorOpen = ref(false);
const newGroupName = ref('');
const interfaceScale = ref('100%');
const performanceMode = ref('精美（默认）');
const minimizeToTray = ref(true);
const autoStart = ref(false);
const cursorPath = ref('');
const workingDirectory = ref('');
const notice = ref('');
const metrics = ['总花费', '今日花费', '总 Token', '缓存命中率'];
// Reference website's public model table. This display does not call a model or billing API.
const publicModels = [
  { name: 'claude-sonnet-5-5-poloai2', provider: 'anthropic', input: '$1.64', output: '$8.2' },
  { name: 'claude-sonnet-5-poloai2', provider: 'anthropic', input: '$1.64', output: '$8.2' },
  { name: 'claude-sonnet-4-6-poloai2', provider: 'anthropic', input: '$2.46', output: '$12.3' },
  { name: 'claude-opus-5-5-poloai2', provider: 'anthropic', input: '$3.28', output: '$16.4' },
  { name: 'claude-opus-5-poloai2', provider: 'anthropic', input: '$4.1', output: '$20.5' },
  { name: 'claude-opus-4-8-poloai2', provider: 'anthropic', input: '$4.1', output: '$20.5' },
];

function activateTab(key: TabKey) {
  activeTab.value = key;
  notice.value = '';
  void nextTick(() => contentElement.value?.scrollTo({ top: 0 }));
}

async function onTabKeydown(event: KeyboardEvent, index: number) {
  let nextIndex = index;
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  activateTab(tabs[nextIndex]!.key);
  await nextTick();
  document.getElementById(`${componentId}-tab-${tabs[nextIndex]!.key}`)?.focus();
}

function requireClient(message = '请登录客户端后使用此功能。') {
  notice.value = message;
}

function addGroup() {
  const name = newGroupName.value.trim();
  if (!name || groupNames.value.includes(name)) return;
  groupNames.value.push(name);
  selectedGroup.value = name;
  newGroupName.value = '';
}
</script>

<template>
  <div class="polo-client">
    <div class="pc-topbar">
      <router-link to="/login" class="pc-brand" aria-label="PoloAi 个人中心"><span class="pc-logo" aria-hidden="true">P<span>·</span></span><strong>PoloAi</strong></router-link>
      <div class="pc-tabs" role="tablist" aria-label="PoloAi 客户端主导航">
        <button v-for="(tab, index) in tabs" :id="`${componentId}-tab-${tab.key}`" :key="tab.key" class="pc-tab" :class="{ 'is-active': activeTab === tab.key }" type="button" role="tab" :aria-selected="activeTab === tab.key" :aria-controls="`${componentId}-panel-${tab.key}`" :tabindex="activeTab === tab.key ? 0 : -1" @click="activateTab(tab.key)" @keydown="onTabKeydown($event, index)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tab.icon" /></svg><span>{{ tab.label }}</span>
        </button>
      </div>
      <span class="pc-window-controls" aria-hidden="true"><span>−</span><span>×</span></span>
    </div>

    <div ref="contentElement" class="pc-content">
      <div v-if="notice" class="pc-notice" role="status"><span>{{ notice }}</span><button type="button" aria-label="关闭提示" @click="notice = ''">×</button></div>

      <section v-show="activeTab === 'account'" :id="`${componentId}-panel-account`" class="pc-panel" role="tabpanel" :aria-labelledby="`${componentId}-tab-account`" tabindex="0">
        <header class="pc-section-header"><h3>账号管理</h3><div class="pc-actions"><button type="button" class="pc-button" @click="requireClient()"><span aria-hidden="true">↻</span>刷新全部</button><button type="button" class="pc-button" :aria-expanded="groupEditorOpen" @click="groupEditorOpen = !groupEditorOpen">分组管理</button><router-link to="/login" class="pc-button pc-button-primary"><span aria-hidden="true">＋</span>添加账号</router-link></div></header>
        <form v-if="groupEditorOpen" class="pc-group-editor" @submit.prevent="addGroup"><label :for="`${componentId}-group`">分组名称</label><input :id="`${componentId}-group`" v-model="newGroupName" class="pc-input" maxlength="24" placeholder="输入分组名称" /><button class="pc-button pc-button-primary" type="submit" :disabled="!newGroupName.trim()">添加分组</button></form>
        <div class="pc-group-tabs" aria-label="账号分组"><button v-for="group in groupNames" :key="group" type="button" :class="{ 'is-active': selectedGroup === group }" :aria-pressed="selectedGroup === group" @click="selectedGroup = group">{{ group }}</button></div>
        <div class="pc-table-wrap pc-accounts-table"><table><thead><tr><th v-for="column in ['#', '分组', '邮箱', '计划', '状态', '额度', '超额', '更新', '备注', '来源', '操作']" :key="column" scope="col">{{ column }}</th></tr></thead><tbody><tr><td colspan="11"><div class="pc-empty pc-empty-account"><span class="pc-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg></span><strong>暂无账号</strong><p>登录客户端后可导入、分组并安全切换本地账号。</p></div></td></tr></tbody></table></div>
      </section>

      <section v-show="activeTab === 'connection'" :id="`${componentId}-panel-connection`" class="pc-panel" role="tabpanel" :aria-labelledby="`${componentId}-tab-connection`" tabindex="0">
        <header class="pc-section-header"><h3>工作环境</h3><div class="pc-wallet"><span>登录后读取倍率</span><strong>$--</strong><router-link to="/recharge" class="pc-button">去充值</router-link></div></header>
        <div class="pc-environment-grid"><article class="pc-card pc-environment"><span class="pc-environment-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h5M12 17h5" /></svg></span><div><h4>本地代理</h4><span class="pc-running-state"><i />未运行</span></div></article><article class="pc-card pc-environment"><span class="pc-environment-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 4h18v13H3zM8 21h8M12 17v4m-4-9 3-3-3-3m6 6h3" /></svg></span><div><h4>Cursor</h4><span class="pc-running-state"><i />未运行</span></div></article></div>
        <button class="pc-button pc-button-primary pc-launch" type="button" @click="requireClient('请在客户端中启动工作环境。')"><span aria-hidden="true">▷</span>启动工作环境</button>
        <article class="pc-card pc-log"><header><h4>日志</h4></header><div class="pc-empty">暂无日志</div></article>
      </section>

      <section v-show="activeTab === 'usage'" :id="`${componentId}-panel-usage`" class="pc-panel" role="tabpanel" :aria-labelledby="`${componentId}-tab-usage`" tabindex="0">
        <div class="pc-segmented pc-usage-view"><button v-for="view in ['我的用量', '用量排行榜']" :key="view" type="button" :class="{ 'is-active': usageView === view }" :aria-pressed="usageView === view" @click="usageView = view">{{ view }}</button></div>
        <div class="pc-metrics"><article v-for="metric in metrics" :key="metric" class="pc-card pc-metric"><span>{{ metric }}</span><strong>正在读取</strong><span class="pc-reading-line" aria-hidden="true" /></article></div>
        <article class="pc-card pc-chart-card"><header><h4>累计花费</h4><span>按天累计 · 分模型</span></header><div class="pc-chart-placeholder" role="img" aria-label="累计花费图表，正在读取用量"><span /><span /><span /><span /></div></article>
        <header class="pc-section-header pc-usage-header"><h4>用量</h4><div class="pc-segmented pc-date-ranges"><button v-for="range in dateRanges" :key="range" type="button" :class="{ 'is-active': dateRange === range }" :aria-pressed="dateRange === range" @click="dateRange = range">{{ range }}</button></div></header>
        <div v-if="dateRange === '自定义'" class="pc-custom-dates"><label :for="`${componentId}-start`">开始日期<input :id="`${componentId}-start`" v-model="startDate" type="date" class="pc-input" :max="endDate || undefined" /></label><label :for="`${componentId}-end`">结束日期<input :id="`${componentId}-end`" v-model="endDate" type="date" class="pc-input" :min="startDate || undefined" /></label></div>
        <div class="pc-table-wrap pc-usage-table"><table><thead><tr><th v-for="column in ['时间', '类型', '模型', 'Token', '费用']" :key="column" scope="col">{{ column }}</th></tr></thead><tbody><tr><td colspan="5" class="pc-loading-row">正在读取用量</td></tr></tbody></table></div>
      </section>

      <section v-show="activeTab === 'shop'" :id="`${componentId}-panel-shop`" class="pc-panel" role="tabpanel" :aria-labelledby="`${componentId}-tab-shop`" tabindex="0">
        <header class="pc-section-header"><div class="pc-segmented"><button v-for="view in ['权益包', '账号商品']" :key="view" type="button" :class="{ 'is-active': shopView === view }" :aria-pressed="shopView === view" @click="shopView = view">{{ view }}</button></div><div class="pc-wallet"><strong>钱包余额：$--</strong><router-link to="/recharge" class="pc-button">去充值</router-link></div></header>
        <article class="pc-card pc-products"><header><h4>{{ shopView === '权益包' ? '实时权益包' : '账号商品' }}</h4></header><div class="pc-empty"><span class="pc-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8ZM9 9V6a3 3 0 0 1 6 0v3" /></svg></span><p>登录客户端后加载实时商品</p></div></article>
        <article class="pc-card pc-pricing"><header><h4>模型计费说明</h4><span>当前公开模型 83 个</span></header><div class="pc-table-wrap"><table><thead><tr><th scope="col">模型</th><th scope="col">输入 / 百万</th><th scope="col">输出 / 百万</th></tr></thead><tbody><tr v-for="model in publicModels" :key="model.name"><td><strong>{{ model.name }}</strong><small>{{ model.provider }}</small></td><td>{{ model.input }}</td><td>{{ model.output }}</td></tr></tbody></table></div></article>
      </section>

      <section v-show="activeTab === 'settings'" :id="`${componentId}-panel-settings`" class="pc-panel" role="tabpanel" :aria-labelledby="`${componentId}-tab-settings`" tabindex="0">
        <header class="pc-section-header"><div><h3>设置</h3><p class="pc-subtitle">路径、外观与客户端行为</p></div></header>
        <div class="pc-settings-layout">
          <article class="pc-card pc-settings-path"><header><div><span class="pc-overline">Cursor 路径</span><h4>目标程序</h4></div><button class="pc-icon-button" type="button" aria-label="选择软件" @click="requireClient('请在客户端中选择目标程序。')"><span aria-hidden="true">↗</span></button></header>
            <label class="pc-field" :for="`${componentId}-cursor-path`"><span>Cursor.exe 路径</span><input :id="`${componentId}-cursor-path`" v-model="cursorPath" class="pc-input" type="text" placeholder="例如 C:\Users\you\AppData\Local\Programs\Cursor\Cursor.exe" /></label>
            <label class="pc-field" :for="`${componentId}-working-directory`"><span>工作目录（可留空）</span><input :id="`${componentId}-working-directory`" v-model="workingDirectory" class="pc-input" type="text" placeholder="留空则使用软件所在目录" /></label>
            <button class="pc-button pc-button-primary" type="button" @click="requireClient('请在客户端中保存 Cursor 路径。')">保存 Cursor 路径</button>
            <section class="pc-settings-row"><div><span class="pc-overline">网络代理</span><h4>企业网络</h4></div><button class="pc-button" type="button" @click="requireClient('请在客户端中设置代理。')">设置代理</button></section>
            <section class="pc-settings-row"><div><span class="pc-overline">版本更新</span><h4>PoloAi 客户端</h4><p>最新版本 <strong>3.0.6</strong></p></div><button class="pc-button" type="button" @click="requireClient('请在客户端中检查更新。')"><span aria-hidden="true">↻</span>检查更新</button></section>
          </article>
          <aside class="pc-settings-side">
            <section class="pc-card pc-settings-slab"><h4>界面缩放</h4><p>整体缩放界面大小，适配不同分辨率的屏幕。</p><div class="pc-segmented pc-scale-options"><button v-for="scale in ['80%', '90%', '100%', '110%', '120%']" :key="scale" type="button" :class="{ 'is-active': interfaceScale === scale }" :aria-pressed="interfaceScale === scale" @click="interfaceScale = scale">{{ scale }}</button></div></section>
            <section class="pc-card pc-settings-slab"><h4>性能模式</h4><p>在精美效果和更低资源占用之间切换。</p><div class="pc-segmented"><button v-for="mode in ['精美（默认）', '性能优先']" :key="mode" type="button" :class="{ 'is-active': performanceMode === mode }" :aria-pressed="performanceMode === mode" @click="performanceMode = mode">{{ mode }}</button></div></section>
            <section class="pc-card pc-settings-slab"><h4>客户端行为</h4><label class="pc-setting-toggle"><span><strong>关闭窗口时最小化到托盘</strong><small>关闭则直接退出客户端</small></span><input v-model="minimizeToTray" type="checkbox" role="switch" :aria-checked="minimizeToTray" /></label><label class="pc-setting-toggle"><span><strong>开机自启</strong><small>以当前用户身份随系统启动</small></span><input v-model="autoStart" type="checkbox" role="switch" :aria-checked="autoStart" /></label><label class="pc-field" :for="`${componentId}-log-lines`"><span>日志最大行数</span><input :id="`${componentId}-log-lines`" class="pc-input" type="text" placeholder="登录客户端后读取" readonly /></label></section>
            <section class="pc-card pc-settings-slab"><h4>账户</h4><p>登录客户端后可管理账户与退出登录。</p></section>
          </aside>
        </div>
      </section>
    </div>

    <div class="pc-caption"><span><i />交互式客户端演示</span><span>登录客户端后同步账号、用量与商城数据</span></div>
  </div>
</template>

<style scoped>
.polo-client { width: 100%; min-width: 0; overflow: hidden; border: 1px solid #e7e5e4; border-radius: 18px; background: #fafaf9; color: #44403c; font: inherit; font-size: 12px; line-height: 1.5; box-shadow: 0 1px 2px rgb(15 23 42 / 4%), 0 20px 55px -25px rgb(28 25 23 / 15%); }
.polo-client *, .polo-client *::before, .polo-client *::after { box-sizing: border-box; }
.polo-client button, .polo-client input, .polo-client a { font: inherit; }
.polo-client button { cursor: pointer; }
.polo-client button:disabled { cursor: default; opacity: .5; }
.polo-client :is(button, input, a, [role='tabpanel']):focus-visible { outline: 2px solid #059669; outline-offset: 3px; }
.polo-client svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.pc-topbar { display: flex; align-items: center; min-height: 66px; gap: 28px; padding: 0 24px; border-bottom: 1px solid #e7e5e4; background: #fff; }
.pc-brand { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; text-decoration: none; color: #292524; }
.pc-brand strong { font-size: 16px; letter-spacing: -.5px; font-weight: 650; }
.pc-logo { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; border-radius: 8px; color: #fff; background: #065f46; font-family: system-ui, sans-serif; font-size: 22px; font-weight: 800; line-height: 1; }
.pc-logo > span { margin: 0 0 -8px -2px; color: #86efac; font-size: 19px; }
.pc-tabs { display: flex; align-self: stretch; gap: 5px; min-width: 0; }
.pc-tab { display: flex; position: relative; align-items: center; justify-content: center; gap: 7px; padding: 0 20px; border: 0; color: #78716c; background: transparent; white-space: nowrap; transition: color .16s, background .16s; }
.pc-tab svg { width: 15px; height: 15px; }
.pc-tab:hover { color: #065f46; background: #fafaf9; }
.pc-tab.is-active { color: #047857; font-weight: 600; background: #f0fdf480; }
.pc-tab.is-active::after { content: ''; position: absolute; bottom: 0; left: 15px; right: 15px; height: 2px; border-radius: 3px 3px 0 0; background: #059669; }
.pc-window-controls { display: flex; gap: 22px; margin-left: auto; color: #a8a29e; font-size: 18px; }
.pc-content { height: 476px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #d6d3d1 transparent; padding: 24px; }
.pc-panel { min-width: 0; }
.pc-section-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; }
.pc-section-header h3 { margin: 0; color: #292524; font-size: 17px; font-weight: 600; }
.polo-client h4 { margin: 0; color: #44403c; font-size: 12px; font-weight: 600; }
.pc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pc-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 7px 11px; border: 1px solid #e7e5e4; border-radius: 8px; background: #fff; color: #57534e; text-decoration: none; white-space: nowrap; font-size: 11px !important; }
.pc-button:hover { color: #047857; border-color: #bbf7d0; background: #f0fdf4; }
.pc-button-primary { border-color: #059669; color: #fff; background: #059669; }
.pc-button-primary:hover { border-color: #047857; color: #fff; background: #047857; }
.pc-group-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.pc-group-tabs button { padding: 6px 12px; border: 1px solid #e7e5e4; border-radius: 7px; background: #fff; color: #78716c; font-size: 11px; }
.pc-group-tabs button.is-active { border-color: #bbf7d0; color: #047857; background: #f0fdf4; }
.pc-group-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-bottom: 15px; padding: 12px; border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; }
.pc-group-editor .pc-input { flex: 1; min-width: 120px; width: auto; }
.pc-table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; }
.pc-table-wrap table { width: 100%; border-collapse: collapse; text-align: left; font-size: 10px; }
.pc-table-wrap th { padding: 12px 14px; border-bottom: 1px solid #e7e5e4; color: #78716c; background: #f5f5f4; font-weight: 500; white-space: nowrap; }
.pc-table-wrap td { padding: 13px 14px; border-bottom: 1px solid #f5f5f4; color: #57534e; }
.pc-table-wrap tr:last-child td { border-bottom: 0; }
.pc-accounts-table table { min-width: 650px; }
.pc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 32px 12px; color: #a8a29e; text-align: center; }
.pc-empty-account { min-height: 267px; }
.pc-empty strong { color: #78716c; font-size: 12px; font-weight: 500; }
.pc-empty p { margin: 0; color: #a8a29e; font-size: 11px; line-height: 1.7; }
.pc-empty-icon { display: grid; place-items: center; width: 42px; height: 42px; margin-bottom: 4px; border: 1px solid #e7e5e4; border-radius: 12px; background: #fafaf9; color: #a8a29e; }
.pc-empty-icon svg { width: 22px; height: 22px; }
.pc-wallet { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: #a8a29e; font-size: 11px; }
.pc-wallet strong { color: #57534e; font-size: 12px; font-weight: 500; }
.pc-card { min-width: 0; border: 1px solid #e7e5e4; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgb(15 23 42 / 3%); }
.pc-environment-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
.pc-environment { display: flex; align-items: center; gap: 15px; padding: 27px 25px; }
.pc-environment-icon { display: grid; place-items: center; width: 43px; height: 43px; border-radius: 11px; color: #047857; background: #f0fdf4; }
.pc-environment-icon svg { width: 23px; height: 23px; }
.pc-environment h4 { font-size: 14px; }
.pc-running-state { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: #a8a29e; font-size: 11px; }
.pc-running-state i { width: 5px; height: 5px; border-radius: 50%; background: #d6d3d1; }
.pc-launch { display: flex; width: max-content; margin: 18px 0 24px auto; }
.pc-log header { padding: 14px 18px; border-bottom: 1px solid #f5f5f4; }
.pc-log .pc-empty { min-height: 142px; }
.pc-segmented { display: inline-flex; max-width: 100%; gap: 3px; padding: 3px; border: 1px solid #e7e5e4; border-radius: 8px; background: #f5f5f4; }
.pc-segmented button { min-width: 0; padding: 6px 12px; border: 0; border-radius: 5px; background: transparent; color: #78716c; font-size: 11px; white-space: nowrap; }
.pc-segmented button.is-active { color: #047857; background: #fff; font-weight: 600; box-shadow: 0 1px 3px rgb(28 25 23 / 7%); }
.pc-usage-view { margin-bottom: 17px; }
.pc-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 15px; }
.pc-metric { display: flex; flex-direction: column; gap: 8px; padding: 17px; }
.pc-metric > span:first-child { color: #78716c; font-size: 10px; }
.pc-metric strong { color: #a8a29e; font-size: 16px; font-weight: 500; }
.pc-reading-line { width: 42%; height: 4px; margin-top: 2px; border-radius: 5px; background: #f5f5f4; }
.pc-chart-card { padding: 15px 18px; margin-bottom: 18px; }
.pc-chart-card header, .pc-pricing > header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.pc-chart-card header span, .pc-pricing > header span { color: #a8a29e; font-size: 10px; }
.pc-chart-placeholder { display: flex; flex-direction: column; justify-content: space-around; min-height: 126px; margin-top: 11px; border-left: 1px solid #e7e5e4; border-bottom: 1px solid #e7e5e4; }
.pc-chart-placeholder span { display: block; width: 100%; border-top: 1px dashed #e7e5e4; }
.pc-usage-header { gap: 10px; margin-bottom: 11px; }
.pc-date-ranges button { padding: 4px 10px; font-size: 10px; }
.pc-loading-row { height: 65px; color: #a8a29e !important; text-align: center; }
.pc-custom-dates { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 12px; }
.pc-custom-dates label { flex: 1; min-width: 130px; color: #78716c; font-size: 10px; }
.pc-custom-dates input { margin-top: 5px; }
.pc-products { margin-bottom: 17px; }
.pc-products header { padding: 14px 18px; border-bottom: 1px solid #f5f5f4; }
.pc-products .pc-empty { min-height: 135px; padding: 20px; }
.pc-pricing { overflow: hidden; }
.pc-pricing > header { padding: 15px 18px; }
.pc-pricing .pc-table-wrap { border: 0; border-radius: 0; }
.pc-pricing table { min-width: 465px; }
.pc-pricing th, .pc-pricing td { padding: 10px 18px; }
.pc-pricing td strong, .pc-pricing td small { display: block; }
.pc-pricing td strong { color: #57534e; font-size: 11px; font-weight: 500; }
.pc-pricing td small { margin-top: 2px; color: #a8a29e; font-size: 9px; }
.pc-subtitle { margin: 4px 0 0; color: #a8a29e; font-size: 11px; }
.pc-settings-layout { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: start; gap: 18px; }
.pc-settings-path { padding: 19px; }
.pc-settings-path > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; }
.pc-overline { display: block; margin-bottom: 4px; color: #a8a29e; font-size: 10px; }
.pc-icon-button { width: 30px; height: 30px; padding: 0; border: 1px solid #e7e5e4; border-radius: 7px; color: #78716c; background: #fafaf9; font-size: 17px !important; }
.pc-field { display: block; margin: 0 0 17px; }
.pc-field > span { display: block; margin-bottom: 7px; color: #78716c; font-size: 11px; }
.pc-input { display: block; width: 100%; min-width: 0; min-height: 34px; padding: 8px 10px; border: 1px solid #e7e5e4; border-radius: 7px; color: #57534e; background: #fafaf9; font-size: 11px !important; }
.pc-input::placeholder { color: #a8a29e; }
.pc-input[readonly] { cursor: default; }
.pc-settings-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 21px 0 0; margin-top: 23px; border-top: 1px solid #e7e5e4; }
.pc-settings-row p { margin: 6px 0 0; color: #a8a29e; font-size: 10px; }
.pc-settings-row p strong { color: #78716c; font-weight: 500; }
.pc-settings-side { display: flex; flex-direction: column; gap: 13px; min-width: 0; }
.pc-settings-slab { padding: 17px 19px; }
.pc-settings-slab p { margin: 7px 0 12px; color: #a8a29e; font-size: 10px; line-height: 1.7; }
.pc-settings-slab:last-child p { margin-bottom: 0; }
.pc-scale-options { display: flex; }
.pc-scale-options button { flex: 1; padding: 6px 8px; font-size: 10px; }
.pc-setting-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; cursor: pointer; }
.pc-setting-toggle strong, .pc-setting-toggle small { display: block; }
.pc-setting-toggle strong { font-size: 11px; font-weight: 500; }
.pc-setting-toggle small { margin-top: 3px; color: #a8a29e; font-size: 9px; }
.pc-setting-toggle input { appearance: none; position: relative; flex: 0 0 auto; width: 33px; height: 19px; margin: 0; border: 1px solid #d6d3d1; border-radius: 20px; background: #e7e5e4; cursor: pointer; transition: background .16s; }
.pc-setting-toggle input::before { content: ''; position: absolute; left: 3px; top: 3px; width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 10%); transition: transform .16s; }
.pc-setting-toggle input:checked { border-color: #059669; background: #059669; }
.pc-setting-toggle input:checked::before { transform: translateX(14px); }
.pc-settings-slab .pc-field { margin: 18px 0 0; }
.pc-caption { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 9px; padding: 12px 24px; border-top: 1px solid #e7e5e4; background: #fff; color: #a8a29e; font-size: 10px; }
.pc-caption > span:first-child { display: flex; align-items: center; gap: 7px; color: #78716c; }
.pc-caption i { width: 5px; height: 5px; border-radius: 50%; background: #059669; }
.pc-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 15px; padding: 10px 12px; border: 1px solid #bbf7d0; border-radius: 8px; background: #f0fdf4; color: #047857; font-size: 11px; }
.pc-notice button { padding: 0 4px; border: 0; color: inherit; background: transparent; font-size: 17px; }
@media (max-width: 850px) {
  .pc-topbar { gap: 16px; padding-inline: 18px; }
  .pc-tab { padding-inline: 14px; }
  .pc-window-controls { gap: 14px; }
  .pc-content { padding: 20px; }
  .pc-settings-layout { gap: 13px; }
}
@media (max-width: 640px) {
  .polo-client { border-radius: 14px; }
  .pc-topbar { position: relative; flex-wrap: wrap; gap: 0; padding: 14px 14px 0; }
  .pc-brand strong { font-size: 15px; }
  .pc-window-controls { position: absolute; right: 18px; top: 17px; }
  .pc-tabs { order: 1; flex: 0 0 100%; max-width: 100%; min-height: 47px; overflow-x: auto; margin-top: 9px; scrollbar-width: none; }
  .pc-tabs::-webkit-scrollbar { display: none; }
  .pc-tab { flex: 1 0 auto; gap: 6px; padding-inline: 14px; font-size: 11px !important; }
  .pc-content { height: 490px; padding: 17px 14px; }
  .pc-section-header { gap: 12px; }
  .pc-section-header h3 { font-size: 15px; }
  .pc-actions { gap: 5px; }
  .pc-button { min-height: 31px; padding: 6px 9px; font-size: 10px !important; }
  .pc-accounts-table .pc-empty-account { min-height: 250px; align-items: flex-start; text-align: left; padding-left: 20px; }
  .pc-wallet { gap: 10px; }
  .pc-environment-grid { gap: 9px; }
  .pc-environment { gap: 9px; padding: 19px 12px; }
  .pc-environment-icon { width: 32px; height: 32px; flex-shrink: 0; }
  .pc-environment-icon svg { width: 19px; height: 19px; }
  .pc-environment h4 { font-size: 12px; }
  .pc-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .pc-metric { padding: 13px; }
  .pc-metric strong { font-size: 14px; }
  .pc-chart-card { padding: 13px; }
  .pc-chart-placeholder { min-height: 106px; }
  .pc-date-ranges button { padding-inline: 8px; }
  .pc-usage-table th, .pc-usage-table td { padding-inline: 11px; }
  .pc-settings-layout { grid-template-columns: 1fr; }
  .pc-settings-path, .pc-settings-slab { padding: 17px; }
  .pc-caption { gap: 5px; padding: 11px 14px; font-size: 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .pc-tab, .pc-setting-toggle input, .pc-setting-toggle input::before { transition: none; }
}
</style>
