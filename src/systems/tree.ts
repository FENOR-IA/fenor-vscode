import * as vscode from 'vscode';
import { FenorState } from '../state';
import { Role, ROLE_LABEL, SystemDef, SystemsFile } from './model';

const ROLE_ICON: Record<Role, string> = {
  front: 'browser', back: 'server', api: 'plug', fullstack: 'layers', worker: 'gear',
  mobile: 'device-mobile', lib: 'library', infra: 'cloud', docs: 'book', outro: 'circle-outline',
};

type Node = { kind: 'system'; system: SystemDef } | { kind: 'component'; system: SystemDef; index: number };

export class SystemsTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private data: SystemsFile = { versao: 1, sistemas: [] };

  constructor(private readonly state: FenorState) {
    state.onDidChange(() => this.emitter.fire());
  }

  update(data: SystemsFile): void {
    this.data = data;
    void vscode.commands.executeCommand('setContext', 'fenor.hasSystems', data.sistemas.length > 0);
    this.emitter.fire();
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.data.sistemas.map((system) => ({ kind: 'system', system }));
    }
    return node.kind === 'system' ? node.system.components.map((_, index) => ({ kind: 'component', system: node.system, index })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'system') {
      const item = new vscode.TreeItem(node.system.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${node.system.components.length} componente(s)`;
      item.tooltip = node.system.description;
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      item.contextValue = 'fenorSystem';
      return item;
    }
    const c = node.system.components[node.index];
    const project = this.state.projects.find((p) => p.relPath === c.project);
    const item = new vscode.TreeItem(project?.name ?? c.project, vscode.TreeItemCollapsibleState.None);
    item.description = `${ROLE_LABEL[c.role]}${c.note ? ` · ${c.note}` : ''}`;
    item.tooltip = c.project;
    item.iconPath = new vscode.ThemeIcon(project ? ROLE_ICON[c.role] : 'warning');
    if (project) {
      item.contextValue = 'fenorProject';
      item.command = { command: 'revealInExplorer', title: 'Mostrar', arguments: [vscode.Uri.file(project.path)] };
    }
    return item;
  }
}
