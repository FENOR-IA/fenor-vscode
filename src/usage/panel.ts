import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { errorMessage, FenorState, mapWithLimit } from '../state';
import { projectActivity } from './activity';
import { eventsToCsv, readEvents, summarizeUsage } from './log';
import { renderUsageBody, UsageView } from './render';
import { renderUsageReport } from './report';
import { getUsageDir, track } from './tracker';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Painel de uso: consumo de tokens pelo Fenor, onde foi gasto, o que fiz e relatórios. */
export class UsagePanel implements vscode.Disposable {
  private static current: UsagePanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private periodDays = 30;
  private view: UsageView | undefined;

  static show(state: FenorState): void {
    if (UsagePanel.current) {
      UsagePanel.current.panel.reveal(vscode.ViewColumn.One);
      void UsagePanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel('fenor.usage', 'Fenor — Uso', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    UsagePanel.current = new UsagePanel(panel, state);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly state: FenorState) {
    this.disposables.push(panel.onDidDispose(() => this.dispose()), panel.webview.onDidReceiveMessage((m) => this.onMessage(m)));
    void this.refresh();
  }

  dispose(): void {
    UsagePanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  /** Monta os dados do período (usado também pelo comando de relatório). */
  static async load(state: FenorState, periodDays: number): Promise<UsageView> {
    const to = new Date();
    const from = new Date(to.getTime() - (periodDays - 1) * DAY_MS);
    from.setHours(0, 0, 0, 0);
    const dir = getUsageDir();
    const events = dir ? await readEvents(dir, from, to) : [];
    if (!state.projects.length) {
      await state.refreshProjects();
    }
    const activity = await mapWithLimit(state.projects, 6, (p) => projectActivity(p.path, p.name, from, to));
    return { periodDays, from, to, usage: summarizeUsage(events, from, to), activity };
  }

  private async refresh(): Promise<void> {
    this.panel.webview.html = this.html('<p class="empty">Carregando…</p>');
    try {
      this.view = await UsagePanel.load(this.state, this.periodDays);
      this.panel.webview.html = this.html(renderUsageBody(this.view));
    } catch (err) {
      this.panel.webview.html = this.html(`<p class="empty">Erro: ${errorMessage(err).replace(/</g, '&lt;')}</p>`);
    }
  }

  private async onMessage(msg: { action?: string; days?: string }): Promise<void> {
    switch (msg.action) {
      case 'period':
        this.periodDays = Number(msg.days) || 30;
        await this.refresh();
        return;
      case 'report':
        await writeUsageReport(this.state, this.periodDays);
        return;
      case 'csv':
        await exportCsv(this.periodDays);
        return;
      case 'billing':
        await vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/billing'));
        return;
    }
  }

  private html(body: string): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><style nonce="${nonce}">${STYLES}</style></head>
<body>${body}<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.querySelectorAll('[data-pct]').forEach((el) => { el.style.setProperty('--pct', el.dataset.pct + '%'); });
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return; e.preventDefault();
  vscode.postMessage({ action: el.dataset.action, days: el.dataset.days });
});
</script></body></html>`;
  }
}

/** Gera .fenor/relatorios/uso-AAAA-MM-DD-a-AAAA-MM-DD.md na raiz e abre a pré-visualização. */
export async function writeUsageReport(state: FenorState, periodDays = 30): Promise<void> {
  const root = state.roots[0];
  if (!root) {
    vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
    return;
  }
  const days = periodDays || Number(await vscode.window.showQuickPick(['7', '30', '90'], { title: 'Relatório de quantos dias?' })) || 30;
  try {
    const view = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Fenor: montando o relatório de uso…' }, () => UsagePanel.load(state, days));
    const name = `uso-${view.from.toISOString().slice(0, 10)}-a-${view.to.toISOString().slice(0, 10)}.md`;
    const file = path.join(root, '.fenor', 'relatorios', name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderUsageReport(view, view.usage, view.activity), 'utf8');
    track({ tipo: 'relatorio', comando: 'uso', detalhe: name });
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao gerar o relatório — ${errorMessage(err)}`);
  }
}

async function exportCsv(periodDays: number): Promise<void> {
  const dir = getUsageDir();
  const to = new Date();
  const from = new Date(to.getTime() - (periodDays - 1) * DAY_MS);
  const events = dir ? await readEvents(dir, from, to) : [];
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`fenor-uso-${to.toISOString().slice(0, 10)}.csv`), filters: { CSV: ['csv'] } });
  if (!target) {
    return;
  }
  await fs.writeFile(target.fsPath, eventsToCsv(events), 'utf8');
  vscode.window.showInformationMessage(`Fenor: ${events.length} evento(s) exportado(s).`);
}

const STYLES = `
:root { --accent: #e0702e; --line: var(--vscode-panel-border, rgba(128,128,128,.25)); --surface: var(--vscode-sideBar-background, rgba(128,128,128,.06)); --muted: var(--vscode-descriptionForeground); --warn: var(--vscode-editorWarning-foreground, #cca700); }
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 28px 32px 48px; margin: 0; }
a { color: var(--accent); }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid var(--accent); padding-bottom: 14px; margin-bottom: 24px; }
.eyebrow { margin: 0; letter-spacing: .18em; text-transform: uppercase; font-size: 11px; color: var(--accent); font-weight: 700; }
h1 { margin: 4px 0 0; font-size: 28px; font-weight: 600; }
.sub { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
h2 { margin: 0 0 14px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-weight: 600; }
h3 { margin: 0 0 6px; font-size: 13px; } h3 small { color: var(--muted); font-weight: 400; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
button { font: inherit; padding: 6px 14px; border-radius: 3px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
button:hover { border-color: var(--accent); } button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; } .seg button.on { background: color-mix(in srgb, var(--accent) 18%, transparent); font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin-bottom: 24px; }
.kpi { background: var(--vscode-editor-background); padding: 16px 18px; display: flex; flex-direction: column; gap: 2px; }
.kpi-value { font-size: 32px; font-weight: 300; font-variant-numeric: tabular-nums; } .kpi-label { font-weight: 600; font-size: 12px; } .kpi-hint { color: var(--muted); font-size: 11px; }
.kpi.warn .kpi-value { color: var(--warn); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 18px; margin-bottom: 20px; min-width: 0; }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; } .grid3 .panel { margin-bottom: 0; } .grid3 { margin-bottom: 20px; }
.chart { display: flex; align-items: flex-end; gap: 2px; height: 160px; border-bottom: 1px solid var(--line); }
.col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; position: relative; }
.col:hover .bar { background: color-mix(in srgb, var(--accent) 80%, white); }
.bar { width: 100%; max-width: 22px; height: var(--pct, 0%); background: var(--accent); border-radius: 4px 4px 0 0; min-height: 0; }
.tick { position: absolute; bottom: -18px; font-size: 10px; color: var(--muted); white-space: nowrap; }
.axis { margin: 24px 0 0; font-size: 11px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--line); }
td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; } .num { text-align: right; font-variant-numeric: tabular-nums; }
.hbar { display: block; height: 4px; margin-top: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.hbar span { display: block; height: 100%; width: var(--pct, 0%); background: var(--accent); border-radius: 2px; }
.act { padding: 10px 0; border-bottom: 1px solid var(--line); } .act:last-child { border-bottom: 0; }
.act ul { margin: 6px 0 0; padding-left: 18px; font-size: 12px; } .act li { margin: 3px 0; }
code { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--muted); }
.empty { color: var(--muted); font-size: 12px; margin: 0; }
.note { color: var(--muted); font-size: 11px; line-height: 1.5; max-width: 860px; }
`;
