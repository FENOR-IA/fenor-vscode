import * as vscode from 'vscode';
import { AzureDevOpsClient, Sprint, WorkItem } from './azure/client';
import { kitStatus } from './kit/apply';
import { collectDocs } from './portfolio/docs';
import { getGitInfo } from './portfolio/git';
import { scanRoot } from './portfolio/scanner';
import { ProjectFull } from './portfolio/situation';

export const PAT_SECRET_KEY = 'fenor.azure.pat';
const GIT_CONCURRENCY = 6;

export type ProjectWithGit = ProjectFull;

export interface BoardState {
  status: 'desconectado' | 'carregando' | 'ok' | 'erro';
  sprint?: Sprint | null;
  items: WorkItem[];
  error?: string;
  loadedAt?: Date;
}

/** Estado central da extensão: projetos do workspace + sprint do Azure DevOps. */
export class FenorState implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  projects: ProjectWithGit[] = [];
  scanning = false;
  board: BoardState = { status: 'desconectado', items: [] };
  // Contadores de geração: só o resultado da chamada mais recente é aplicado.
  private projectsGeneration = 0;
  private boardGeneration = 0;

  constructor(private readonly secrets: vscode.SecretStorage, private readonly output: vscode.OutputChannel) {}

  dispose(): void {
    this.emitter.dispose();
  }

  get roots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  async refreshProjects(): Promise<void> {
    const generation = ++this.projectsGeneration;
    this.scanning = true;
    this.emitter.fire();
    try {
      const maxDepth = vscode.workspace.getConfiguration('fenor').get<number>('scan.maxDepth', 4);
      const found = (await Promise.all(this.roots.map((root) => scanRoot(root, maxDepth)))).flat();
      const withGit = await mapWithLimit(found, GIT_CONCURRENCY, async (p) => {
        const [git, docs, kit] = await Promise.all([getGitInfo(p.path), collectDocs(p.path), kitStatus(p.path)]);
        return { ...p, git, docs, kit };
      });
      if (generation !== this.projectsGeneration) {
        return;
      }
      this.projects = withGit;
      this.output.appendLine(`[portfolio] ${this.projects.length} projeto(s) encontrados.`);
    } catch (err) {
      this.output.appendLine(`[portfolio] erro: ${errorMessage(err)}`);
      vscode.window.showErrorMessage(`Fenor: erro ao varrer projetos — ${errorMessage(err)}`);
    } finally {
      if (generation === this.projectsGeneration) {
        this.scanning = false;
        this.emitter.fire();
      }
    }
  }

  async getClient(): Promise<AzureDevOpsClient | undefined> {
    const cfg = vscode.workspace.getConfiguration('fenor.azure');
    const organization = cfg.get<string>('organization', '').trim();
    const project = cfg.get<string>('project', '').trim();
    const team = cfg.get<string>('team', '').trim() || undefined;
    const pat = await this.secrets.get(PAT_SECRET_KEY);
    if (!organization || !project || !pat) {
      return undefined;
    }
    return new AzureDevOpsClient({ organization, project, team, pat });
  }

  async refreshBoard(): Promise<void> {
    const generation = ++this.boardGeneration;
    const client = await this.getClient();
    if (generation !== this.boardGeneration) {
      return;
    }
    if (!client) {
      this.board = { status: 'desconectado', items: [] };
      this.emitter.fire();
      return;
    }
    this.board = { ...this.board, status: 'carregando' };
    this.emitter.fire();
    try {
      const sprint = await client.getCurrentSprint().catch((err) => {
        this.output.appendLine(`[azure] sem sprint atual (${errorMessage(err)}); usando itens abertos recentes.`);
        return null;
      });
      const items = await client.getSprintWorkItems(sprint);
      if (generation !== this.boardGeneration) {
        return;
      }
      this.board = { status: 'ok', sprint, items, loadedAt: new Date() };
      this.output.appendLine(`[azure] ${items.length} item(ns) carregados${sprint ? ` do sprint ${sprint.name}` : ''}.`);
    } catch (err) {
      if (generation !== this.boardGeneration) {
        return;
      }
      this.board = { status: 'erro', items: [], error: errorMessage(err) };
      this.output.appendLine(`[azure] erro: ${errorMessage(err)}`);
    } finally {
      this.emitter.fire();
    }
  }

  findWorkItem(id: number): WorkItem | undefined {
    return this.board.items.find((w) => w.id === id);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Promise.all com limite de concorrência, preservando a ordem. */
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
