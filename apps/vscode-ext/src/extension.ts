import * as vscode from 'vscode';
import { getPanel } from './webviewPanel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('polo.openPanel', () => {
      getPanel(context);
    }),
  );
}

export function deactivate() {}
