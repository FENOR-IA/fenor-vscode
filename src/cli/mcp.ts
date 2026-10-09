import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { detectCommands } from '../kit/commands';
import { buildProjectContext, saveSession, SessionInput } from '../kit/memoryFiles';
import { formatVerification, runVerification, VerifyStep } from '../kit/verify';
import { renderSituationReport } from '../portfolio/report';
import { ACTIVITY_LABEL, idleLabel, situationOf } from '../portfolio/situation';
import { ProjectFull } from '../portfolio/situation';
import { appendEvent, UsageEvent } from '../usage/log';
import { loadProjects, resolveProject } from './projects';

/**
 * Servidor MCP do Fenor (stdio, JSON-RPC 2.0 delimitado por linha), sem dependências.
 * Dá ao Copilot do IntelliJ (e de qualquer cliente MCP) as mesmas ferramentas da extensão do VS Code.
 */

export const USAGE_DIR = path.join(os.homedir(), '.fenor');
const PROTOCOL_VERSION = '2025-06-18';
const CACHE_MS = 30_000;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

type Args = Record<string, unknown>;

const PROJECT_PROP = { projeto: { type: 'string', description: 'Nome, caminho relativo à raiz ou caminho absoluto do projeto. Opcional se houver um só.' } };

export const TOOLS = [
  {
    name: 'fenor_projetos',
    description: 'Lists the Java and React projects in the workspace with stack, activity status and whether the Fenor kit is applied.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fenor_contexto',
    description: 'Returns the Fenor project memory: last saved session, next step, blockers, plan, known pitfalls (gotchas) and business rules. Call this at the START of every task in a project.',
    inputSchema: { type: 'object', properties: PROJECT_PROP },
  },
  {
    name: 'fenor_verificar',
    description: "Runs the project's own detected verification commands (tests, build, lint) and returns pass/fail with output. You MUST call this before declaring any code change complete; if it fails, fix and call again.",
    inputSchema: { type: 'object', properties: { ...PROJECT_PROP, etapas: { type: 'array', items: { type: 'string', enum: ['test', 'build', 'lint'] } } } },
  },
  {
    name: 'fenor_salvar_sessao',
    description: 'Saves the work session into the project memory (memory/sessions, next step, done, new gotchas). Call at the END of a work session.',
    inputSchema: {
      type: 'object',
      required: ['assunto', 'feito', 'proximo'],
      properties: {
        ...PROJECT_PROP,
        assunto: { type: 'string' },
        feito: { type: 'array', items: { type: 'string' } },
        pendente: { type: 'array', items: { type: 'string' } },
        proximo: { type: 'string' },
        decisoes: { type: 'array', items: { type: 'string' } },
        aprendizados: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'fenor_situacao',
    description: 'Situation report of one project (or all): activity, last commit, open checklist items and pending items found in the .md docs.',
    inputSchema: { type: 'object', properties: PROJECT_PROP },
  },
];

export class FenorMcpServer {
  private root: string;
  private cache: { at: number; projects: ProjectFull[] } | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, (msg: JsonRpcMessage) => void>();

  constructor(
    private readonly send: (msg: JsonRpcMessage) => void,
    defaultRoot: string,
    private readonly version: string,
    private readonly usageDir = USAGE_DIR,
  ) {
    this.root = defaultRoot;
  }

  async handle(msg: JsonRpcMessage): Promise<void> {
    if (msg.method === undefined) {
      if (typeof msg.id === 'number') {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
      return;
    }
    try {
      const result = await this.dispatch(msg);
      if (msg.id !== undefined && result !== undefined) {
        this.send({ jsonrpc: '2.0', id: msg.id, result });
      }
    } catch (err) {
      if (msg.id !== undefined) {
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: (err as { code?: number }).code ?? -32603, message: err instanceof Error ? err.message : String(err) } });
      }
    }
  }

  private async dispatch(msg: JsonRpcMessage): Promise<unknown> {
    switch (msg.method) {
      case 'initialize': {
        const requested = String(msg.params?.protocolVersion ?? PROTOCOL_VERSION);
        const caps = (msg.params?.capabilities ?? {}) as { roots?: unknown };
        this.wantsRoots = Boolean(caps.roots);
        return { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: { name: 'fenor', version: this.version } };
      }
      case 'notifications/initialized':
      case 'notifications/roots/list_changed':
        if (this.wantsRoots) {
          void this.askRoots();
        }
        return undefined;
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.callTool(String(msg.params?.name), (msg.params?.arguments ?? {}) as Args);
      default:
        if (msg.method?.startsWith('notifications/')) {
          return undefined;
        }
        throw Object.assign(new Error(`Método não suportado: ${msg.method}`), { code: -32601 });
    }
  }

  private wantsRoots = false;

  /** Usa a pasta aberta na IDE (MCP roots), quando o cliente informa. */
  private async askRoots(): Promise<void> {
    const id = this.nextId++;
    const reply = await new Promise<JsonRpcMessage>((resolve) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: '2.0', id, method: 'roots/list' });
      setTimeout(() => resolve({ jsonrpc: '2.0' }), 5000);
    });
    const roots = (reply.result as { roots?: Array<{ uri: string }> } | undefined)?.roots ?? [];
    const first = roots.find((r) => r.uri.startsWith('file:'));
    if (first) {
      this.root = fileURLToPath(first.uri);
      this.cache = undefined;
    }
  }

  private async projects(): Promise<ProjectFull[]> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      this.cache = { at: Date.now(), projects: await loadProjects(this.root) };
    }
    return this.cache.projects;
  }

  async callTool(name: string, args: Args): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const started = Date.now();
    try {
      const text = await this.run(name, args);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      this.track({ tipo: 'ferramenta', comando: name, ok: false, duracaoMs: Date.now() - started, detalhe: err instanceof Error ? err.message : String(err) });
      return { content: [{ type: 'text', text: `Erro: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }

  private async run(name: string, args: Args): Promise<string> {
    const projects = await this.projects();
    const pick = () => resolveProject(projects, typeof args.projeto === 'string' ? args.projeto : undefined, this.root);
    switch (name) {
      case 'fenor_projetos': {
        this.track({ tipo: 'ferramenta', comando: name, ok: true });
        if (!projects.length) {
          return `Nenhum projeto Java ou React em ${this.root}.`;
        }
        return projects.map((p) => {
          const s = situationOf(p, new Date());
          return `- ${p.relPath} (${p.stack}${p.framework ? `, ${p.framework}` : ''}) — ${ACTIVITY_LABEL[s.activity]}, ${idleLabel(s)} — kit Fenor: ${p.kit?.applied ? 'sim' : 'não'}`;
        }).join('\n');
      }
      case 'fenor_contexto': {
        const p = pick();
        this.track({ tipo: 'ferramenta', comando: name, projeto: p.relPath, ok: true });
        return buildProjectContext(p.path, p.name);
      }
      case 'fenor_verificar': {
        const p = pick();
        const steps = Array.isArray(args.etapas) ? (args.etapas as string[]).filter((s): s is VerifyStep => ['test', 'build', 'lint'].includes(s)) : [];
        const started = Date.now();
        const results = await runVerification(p.path, await detectCommands(p), steps.length ? steps : ['test', 'build', 'lint']);
        const ran = results.filter((r) => !r.skipped);
        this.track({ tipo: 'verificacao', comando: name, projeto: p.relPath, ok: ran.length ? ran.every((r) => r.ok) : undefined, duracaoMs: Date.now() - started, detalhe: ran.map((r) => `${r.step}:${r.ok ? 'ok' : 'falhou'}`).join(' ') });
        return formatVerification(p.name, results);
      }
      case 'fenor_salvar_sessao': {
        const p = pick();
        const input = args as unknown as SessionInput;
        if (!input.assunto || !Array.isArray(input.feito) || !input.proximo) {
          throw new Error('Informe assunto, feito (lista) e proximo.');
        }
        const written = await saveSession(p.path, input, new Date());
        this.cache = undefined;
        this.track({ tipo: 'ferramenta', comando: name, projeto: p.relPath, ok: true, detalhe: input.assunto });
        return `Sessão salva em ${p.name}: ${written.join(', ')}.`;
      }
      case 'fenor_situacao': {
        const selected = typeof args.projeto === 'string' ? [pick()] : projects;
        this.track({ tipo: 'ferramenta', comando: name, ok: true });
        return renderSituationReport(selected, new Date(), this.root);
      }
      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  }

  private track(event: Omit<UsageEvent, 'ts'>): void {
    void appendEvent(this.usageDir, { ts: new Date().toISOString(), ...event, detalhe: [event.detalhe, 'mcp'].filter(Boolean).join(' · ') }).catch(() => undefined);
  }
}

/** Liga o servidor ao stdin/stdout do processo. */
export function serveStdio(root: string, version: string): void {
  const server = new FenorMcpServer((msg) => process.stdout.write(`${JSON.stringify(msg)}\n`), root, version);
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      try {
        void server.handle(JSON.parse(line) as JsonRpcMessage);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } })}\n`);
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
