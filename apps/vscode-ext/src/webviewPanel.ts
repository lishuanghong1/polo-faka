import * as vscode from 'vscode';
import { ApiClient, MyAccount } from './apiClient';
import { writeAccountToCursor } from './cursorWriter';

let panel: vscode.WebviewPanel | undefined;

export function getPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (panel) {
    panel.reveal();
    return panel;
  }

  panel = vscode.window.createWebviewPanel(
    'poloCursorAccount',
    'Polo 账号',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  panel.webview.html = getHtml();

  panel.webview.onDidReceiveMessage(async (msg) => {
    const cfg = vscode.workspace.getConfiguration('poloCursor');
    const baseUrl: string = cfg.get('apiUrl') || '';
    const jwt: string = cfg.get('jwt') || '';

    if (!baseUrl || !jwt) {
      panel?.webview.postMessage({ type: 'error', text: '请先在设置中配置 poloCursor.apiUrl 和 poloCursor.jwt' });
      return;
    }

    const client = new ApiClient(baseUrl, jwt);

    if (msg.type === 'redeem') {
      try {
        const result = await client.redeem();
        writeAccountToCursor({ email: result.email, accessToken: result.token });
        panel?.webview.postMessage({ type: 'redeemOk', email: result.email });
      } catch (e: any) {
        panel?.webview.postMessage({ type: 'error', text: e.message });
      }
    }

    if (msg.type === 'loadMine') {
      try {
        const accounts: MyAccount[] = await client.myAccounts();
        panel?.webview.postMessage({ type: 'mine', accounts });
      } catch (e: any) {
        panel?.webview.postMessage({ type: 'error', text: e.message });
      }
    }
  }, undefined, context.subscriptions);

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  return panel;
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
  button { padding: 8px 16px; margin: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .error { color: var(--vscode-errorForeground); margin-top: 8px; }
  .success { color: var(--vscode-terminal-ansiGreen); margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  td, th { padding: 6px 8px; border: 1px solid var(--vscode-panel-border); font-size: 12px; }
  th { background: var(--vscode-editor-lineHighlightBackground); }
</style>
</head>
<body>
<h2>Polo Cursor 账号</h2>
<p>消耗 <b>1 积分</b>兑换一个 Cursor 账号并自动写入登录状态。</p>
<button id="btnRedeem">兑换账号（-1 积分）</button>
<button id="btnLoad">查看我的账号</button>
<div id="msg"></div>
<div id="table"></div>
<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('btnRedeem').onclick = () => {
    setMsg('');
    vscode.postMessage({ type: 'redeem' });
  };
  document.getElementById('btnLoad').onclick = () => {
    setMsg('');
    vscode.postMessage({ type: 'loadMine' });
  };
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'error') setMsg(m.text, true);
    if (m.type === 'redeemOk') setMsg('✅ 兑换成功：' + m.email + '，请重启 Cursor 生效');
    if (m.type === 'mine') renderTable(m.accounts);
  });
  function setMsg(text, isErr) {
    const el = document.getElementById('msg');
    el.className = isErr ? 'error' : 'success';
    el.textContent = text;
  }
  function renderTable(accounts) {
    if (!accounts.length) { document.getElementById('table').innerHTML = '<p>暂无兑换记录</p>'; return; }
    const rows = accounts.map(a =>
      '<tr><td>' + a.email + '</td><td style="word-break:break-all;max-width:300px">' + a.token.slice(0,40) + '…</td><td>' + new Date(a.soldAt).toLocaleString() + '</td></tr>'
    ).join('');
    document.getElementById('table').innerHTML =
      '<table><tr><th>邮箱</th><th>Token（前40位）</th><th>兑换时间</th></tr>' + rows + '</table>';
  }
</script>
</body>
</html>`;
}
