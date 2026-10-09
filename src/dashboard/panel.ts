import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { FenorState } from '../state';
import { renderDashboardBody } from './render';

const RENDER_DEBOUNCE_MS = 150;

export class DashboardPanel implements vscode.Disposable {
  private static current: DashboardPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private renderTimer: NodeJS.Timeout | undefined;

  static show(state: FenorState): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel('fenor.dashboard', 'Fenor — Painel', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    DashboardPanel.current = new DashboardPanel(panel, state);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly state: FenorState) {
    this.render();
    this.disposables.push(
      state.onDidChange(() => this.scheduleRender()),
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg)),
    );
  }

  private scheduleRender(): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), RENDER_DEBOUNCE_MS);
  }

  dispose(): void {
    clearTimeout(this.renderTimer);
    DashboardPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  private async onMessage(msg: { action?: string; url?: string; index?: string }): Promise<void> {
    switch (msg.action) {
      case 'refresh':
        await Promise.all([this.state.refreshProjects(), this.state.refreshBoard()]);
        return;
      case 'ai-situacao':
        await vscode.commands.executeCommand('fenor.chat.open', '@fenor /situacao');
        return;
      case 'usage':
        await vscode.commands.executeCommand('fenor.usage.open');
        return;
      case 'report':
        await vscode.commands.executeCommand('fenor.report.situation');
        return;
      case 'connect':
        await vscode.commands.executeCommand('fenor.azure.connect');
        return;
      case 'open':
        // Só abre links do próprio Azure DevOps.
        if (msg.url && /^https:\/\/dev\.azure\.com\//.test(msg.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        return;
      case 'project': {
        const project = this.state.projects[Number(msg.index)];
        if (project) {
          await vscode.window.showTextDocument(vscode.Uri.file(path.join(project.path, project.buildFile)));
        }
        return;
      }
    }
  }

  private render(): void {
    const board = this.state.board;
    const body = renderDashboardBody({
      projects: this.state.projects,
      board: { status: board.status, sprintName: board.sprint?.name, items: board.items, error: board.error },
      staleDays: vscode.workspace.getConfiguration('fenor').get<number>('board.staleDays', 5),
      now: new Date(),
    });
    const nonce = crypto.randomBytes(16).toString('base64');
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${STYLES}</style></head>
<body>${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('[data-pct]').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    e.preventDefault();
    vscode.postMessage({ action: el.dataset.action, url: el.dataset.url, index: el.dataset.index });
  });
</script></body></html>`;
  }
}

const STYLES = `
:root {
  --accent: #e0702e;
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --warn: var(--vscode-editorWarning-foreground, #cca700);
  --line: var(--vscode-panel-border, rgba(128,128,128,.25));
  --surface: var(--vscode-sideBar-background, rgba(128,128,128,.06));
  --muted: var(--vscode-descriptionForeground);
}
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 28px 32px 48px; margin: 0; }
a { color: inherit; text-decoration: none; }
a:hover { color: var(--accent); }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid var(--accent); padding-bottom: 14px; margin-bottom: 24px; }
.eyebrow { margin: 0; letter-spacing: .18em; text-transform: uppercase; font-size: 11px; color: var(--accent); font-weight: 700; }
h1 { margin: 4px 0 0; font-size: 28px; font-weight: 600; letter-spacing: -.01em; }
h2 { margin: 0 0 14px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-weight: 600; }
h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; }
h3 span { color: var(--muted); font-weight: 400; }
button { font: inherit; padding: 6px 14px; border-radius: 3px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; transition: border-color .15s, background .15s; }
button:hover { border-color: var(--accent); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.actions { display: flex; gap: 8px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin-bottom: 24px; }
.kpi { background: var(--vscode-editor-background); padding: 16px 18px; display: flex; flex-direction: column; gap: 2px; }
.kpi-value { font-size: 34px; font-weight: 300; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi-label { font-weight: 600; font-size: 12px; }
.kpi-hint { color: var(--muted); font-size: 11px; }
.kpi.warn .kpi-value { color: var(--warn); }
.grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 20px; margin-bottom: 20px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.stack { display: flex; flex-direction: column; gap: 20px; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 18px; min-width: 0; }
.kanban { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.col { display: flex; flex-direction: column; gap: 8px; }
.card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 3px; background: var(--vscode-editor-background); border: 1px solid var(--line); border-left: 3px solid var(--line); transition: transform .15s, border-color .15s; }
.card:hover { transform: translateY(-1px); border-left-color: var(--accent); color: inherit; }
.card.flagged { border-left-color: var(--warn); }
.card-meta { font-size: 11px; color: var(--muted); }
.card-title { font-size: 13px; line-height: 1.35; }
.card-who { font-size: 11px; color: var(--muted); }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.list a { color: var(--accent); font-weight: 600; }
.commits li { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.commit-subject { font-size: 12px; }
small { display: block; color: var(--muted); font-size: 11px; }
.bars { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.bars li { display: grid; grid-template-columns: 1fr; gap: 3px; }
.bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); }
.bar-value { color: var(--muted); font-size: 11px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; font-weight: 600; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); font-size: 11px; }
td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
td a { font-weight: 600; }
.tag { display: inline-block; padding: 1px 7px; border-radius: 2px; font-size: 11px; font-weight: 600; background: var(--accent-soft); }
.tag.java { background: color-mix(in srgb, #e76f00 20%, transparent); }
.tag.react { background: color-mix(in srgb, #149eca 20%, transparent); }
.tag.php { background: color-mix(in srgb, #777bb4 25%, transparent); }
.tag.node { background: color-mix(in srgb, #5fa04e 22%, transparent); }
.tag.python { background: color-mix(in srgb, #3776ab 22%, transparent); }
.tag.outro { background: color-mix(in srgb, #8a8a8a 22%, transparent); }
.status { font-weight: 600; }
.status.ativo { color: var(--vscode-testing-iconPassed, #3fb950); }
.status.morno { color: var(--warn); }
.status.parado, .status.sem-dados { color: var(--muted); }
.warn-text { color: var(--warn); font-weight: 600; }
.empty { color: var(--muted); font-size: 12px; margin: 0; }
`;
