import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { errorMessage, FenorState } from '../state';
import { guessRole, normalizeSystems, ROLE_LABEL, ROLES, suggestSystems, SystemsFile } from './model';
import { loadSystems, saveSystems } from './store';
import { SYSTEMS_STYLES, SYSTEMS_SCRIPT } from './panelAssets';

/** Painel de configuração dos sistemas: componentes (front, back…) e pasta do vault. */
export class SystemsPanel implements vscode.Disposable {
  private static current: SystemsPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(state: FenorState, onSaved: () => void): void {
    if (SystemsPanel.current) {
      SystemsPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel('fenor.systems', 'Fenor — Sistemas', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    SystemsPanel.current = new SystemsPanel(panel, state, onSaved);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly state: FenorState, private readonly onSaved: () => void) {
    const nonce = crypto.randomBytes(16).toString('base64');
    panel.webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${SYSTEMS_STYLES}</style></head>
<body><div id="app"><p class="muted">Carregando…</p></div>
<script nonce="${nonce}">${SYSTEMS_SCRIPT}</script></body></html>`;
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg)),
      state.onDidChange(() => void this.sendInit()),
    );
  }

  dispose(): void {
    SystemsPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  private get root(): string | undefined {
    return this.state.roots[0];
  }

  private async sendInit(data?: SystemsFile): Promise<void> {
    const root = this.root;
    if (!root) {
      return;
    }
    const systems = data ?? await loadSystems(root);
    await this.panel.webview.postMessage({
      type: 'init',
      systems,
      roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] })),
      projects: this.state.projects.map((p) => ({
        relPath: p.relPath, name: p.name, stack: p.stack, framework: p.framework ?? '', role: guessRole(p),
      })),
    });
  }

  private async onMessage(msg: { type?: string; systems?: unknown; index?: number; id?: string }): Promise<void> {
    const root = this.root;
    if (!root) {
      vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
      return;
    }
    try {
      switch (msg.type) {
        case 'ready':
          await this.sendInit();
          return;
        case 'save': {
          const saved = await saveSystems(root, normalizeSystems({ sistemas: msg.systems }));
          await this.sendInit(saved);
          this.onSaved();
          vscode.window.setStatusBarMessage('Fenor: sistemas salvos', 3000);
          return;
        }
        case 'suggest': {
          const current = normalizeSystems({ sistemas: msg.systems });
          await this.panel.webview.postMessage({ type: 'suggested', systems: suggestSystems(this.state.projects, current) });
          return;
        }
        case 'pickVault': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            defaultUri: vscode.Uri.file(root), openLabel: 'Usar como pasta do vault',
          });
          if (picked?.[0]) {
            await this.panel.webview.postMessage({ type: 'vaultPicked', index: msg.index, path: picked[0].fsPath });
          }
          return;
        }
        case 'generate': {
          const saved = await saveSystems(root, normalizeSystems({ sistemas: msg.systems }));
          await this.sendInit(saved);
          this.onSaved();
          await vscode.commands.executeCommand('fenor.vault.generate', msg.id);
          return;
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Fenor: ${errorMessage(err)}`);
    }
  }
}
