import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeSprint, bucketOf, StateBucket } from '../azure/analysis';
import { WorkItem } from '../azure/client';
import { Stack } from '../portfolio/scanner';
import { Activity, ACTIVITY_LABEL, idleLabel, situationOf } from '../portfolio/situation';
import { FenorState, ProjectWithGit } from '../state';

const STACK_LABEL: Record<Stack, string> = { java: 'Java', react: 'React' };
const STACK_ICON: Record<Stack, string> = { java: 'coffee', react: 'symbol-event' };
const ACTIVITY_ICON: Record<Activity, string> = { ativo: 'pass-filled', morno: 'clock', parado: 'debug-pause', 'sem-dados': 'question' };
const BUCKET_LABEL: Record<StateBucket, string> = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };

type PortfolioNode =
  | { kind: 'stack'; stack: Stack }
  | { kind: 'project'; project: ProjectWithGit }
  | { kind: 'info'; label: string; icon: string; description?: string; open?: string; children?: PortfolioNode[]; command?: string; project?: ProjectWithGit };

export class PortfolioTree implements vscode.TreeDataProvider<PortfolioNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly state: FenorState) {
    state.onDidChange(() => this.emitter.fire());
  }

  getChildren(node?: PortfolioNode): PortfolioNode[] {
    if (!node) {
      const stacks = [...new Set(this.state.projects.map((p) => p.stack))];
      return stacks.map((stack) => ({ kind: 'stack', stack }));
    }
    if (node.kind === 'stack') {
      return this.state.projects.filter((p) => p.stack === node.stack).map((project) => ({ kind: 'project', project }));
    }
    if (node.kind === 'project') {
      return projectDetails(node.project);
    }
    return node.children ?? [];
  }

  getTreeItem(node: PortfolioNode): vscode.TreeItem {
    if (node.kind === 'stack') {
      const count = this.state.projects.filter((p) => p.stack === node.stack).length;
      const item = new vscode.TreeItem(STACK_LABEL[node.stack], vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${count}`;
      item.iconPath = new vscode.ThemeIcon(STACK_ICON[node.stack]);
      return item;
    }
    if (node.kind === 'project') {
      const p = node.project;
      const item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.tooltip = [p.relPath, p.framework, p.runtime, p.version && `versão ${p.version}`, p.description ?? p.docs.summary].filter(Boolean).join('\n');
      const s = situationOf(p, new Date());
      item.description = `${ACTIVITY_LABEL[s.activity]} · ${idleLabel(s)}`;
      item.iconPath = new vscode.ThemeIcon(ACTIVITY_ICON[s.activity]);
      item.contextValue = 'fenorProject';
      item.command = { command: 'vscode.open', title: 'Abrir', arguments: [vscode.Uri.file(path.join(p.path, p.buildFile))] };
      return item;
    }
    const item = new vscode.TreeItem(node.label, node.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.tooltip = node.label;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.open) {
      item.command = { command: 'vscode.open', title: 'Abrir', arguments: [vscode.Uri.file(node.open)] };
    } else if (node.command) {
      item.command = { command: node.command, title: node.label, arguments: [node.project] };
    }
    return item;
  }
}

function projectDetails(p: ProjectWithGit): PortfolioNode[] {
  const s = situationOf(p, new Date());
  const last = p.git.commits[0];
  const nodes: PortfolioNode[] = [
    p.kit?.applied
      ? { kind: 'info', label: 'Kit Fenor', icon: 'verified', description: `aplicado em ${p.kit.appliedAt ?? '?'} · clique para abrir um modo`, command: 'fenor.mode.open', project: p }
      : { kind: 'info', label: 'Kit Fenor não aplicado', icon: 'circle-slash', description: 'clique para aplicar', command: 'fenor.kit.apply', project: p },
    { kind: 'info', label: [p.framework, p.runtime].filter(Boolean).join(' · ') || 'stack não identificada', icon: 'tools', description: p.relPath },
    { kind: 'info', label: p.git.branch ?? 'sem git', icon: 'git-branch', description: p.git.dirtyFiles ? `${p.git.dirtyFiles} sem commit` : undefined },
  ];
  nodes.push({ kind: 'info', label: `${p.testCount} arquivo(s) de teste`, icon: p.testCount ? 'beaker' : 'warning' });
  if (last) {
    nodes.push({ kind: 'info', label: last.subject, icon: 'git-commit', description: `${last.author} · ${last.date.slice(0, 10)}` });
  }
  if (s.progress !== undefined) {
    nodes.push({ kind: 'info', label: `Checklists: ${s.progress}%`, icon: 'checklist', description: `${p.docs.checklistOpen} abertos` });
  }
  if (p.docs.pending.length) {
    nodes.push({
      kind: 'info', label: 'Pendências', icon: 'tasklist', description: `${p.docs.pending.length}`,
      children: p.docs.pending.map((item) => ({ kind: 'info', label: item.text, icon: 'circle-small', description: item.file, open: path.join(p.path, item.file) })),
    });
  }
  if (p.docs.files.length) {
    nodes.push({
      kind: 'info', label: 'Documentos', icon: 'book', description: `${p.docs.files.length}`,
      children: p.docs.files.map((f) => ({ kind: 'info', label: f.relPath, icon: 'markdown', description: f.modified.slice(0, 10), open: path.join(p.path, f.relPath) })),
    });
  }
  return nodes;
}

type BoardNode =
  | { kind: 'bucket'; bucket: StateBucket; items: WorkItem[] }
  | { kind: 'item'; item: WorkItem; alerts: string[] }
  | { kind: 'message'; label: string; icon: string };

export class BoardTree implements vscode.TreeDataProvider<BoardNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly state: FenorState) {
    state.onDidChange(() => this.emitter.fire());
  }

  getChildren(node?: BoardNode): BoardNode[] {
    const board = this.state.board;
    if (!node) {
      if (board.status === 'desconectado') {
        return [];
      }
      if (board.status === 'carregando') {
        return [{ kind: 'message', label: 'Carregando sprint…', icon: 'loading~spin' }];
      }
      if (board.status === 'erro') {
        return [{ kind: 'message', label: board.error ?? 'Erro ao carregar', icon: 'error' }];
      }
      const buckets: StateBucket[] = ['doing', 'todo', 'done'];
      return buckets.map((bucket) => ({ kind: 'bucket', bucket, items: board.items.filter((w) => bucketOf(w.state) === bucket) }));
    }
    if (node.kind === 'bucket') {
      const staleDays = vscode.workspace.getConfiguration('fenor').get<number>('board.staleDays', 5);
      const alerts = analyzeSprint(node.items, new Date(), staleDays);
      return node.items.map((item) => ({
        kind: 'item',
        item,
        alerts: alerts.filter((a) => a.workItemId === item.id).map((a) => a.message),
      }));
    }
    return [];
  }

  getTreeItem(node: BoardNode): vscode.TreeItem {
    if (node.kind === 'bucket') {
      const item = new vscode.TreeItem(BUCKET_LABEL[node.bucket], node.bucket === 'done'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${node.items.length}`;
      return item;
    }
    if (node.kind === 'item') {
      const w = node.item;
      const item = new vscode.TreeItem(`${w.id} · ${w.title}`, vscode.TreeItemCollapsibleState.None);
      item.description = [w.assignedTo ?? 'sem responsável', w.state].join(' · ');
      item.tooltip = new vscode.MarkdownString().appendText([
        `${w.type} ${w.id} — ${w.title}`,
        `Estado: ${w.state} · Responsável: ${w.assignedTo ?? '—'}`,
        ...node.alerts.map((a) => `⚠ ${a}`),
      ].join('\n\n'));
      item.iconPath = new vscode.ThemeIcon(node.alerts.length ? 'warning' : 'circle-outline');
      item.command = { command: 'vscode.open', title: 'Abrir no Azure', arguments: [vscode.Uri.parse(w.url)] };
      return item;
    }
    const item = new vscode.TreeItem(node.label);
    item.iconPath = new vscode.ThemeIcon(node.icon);
    return item;
  }
}
