import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { applyKit, existingGithubFiles, planKit, previewReport, summarize } from '../kit/apply';
import { buildKitFiles, kitManifest } from '../kit/build';
import { detectCommands } from '../kit/commands';
import { eccKitFiles, eccSelection } from '../kit/ecc';
import { renderSituationReport } from '../portfolio/report';
import { ProjectFull } from '../portfolio/situation';
import { projectActivity } from '../usage/activity';
import { readEvents, summarizeUsage } from '../usage/log';
import { renderUsageReport } from '../usage/report';
import { serveStdio, USAGE_DIR } from './mcp';
import { loadProjects, resolveProject } from './projects';

declare const FENOR_VERSION: string | undefined;
const VERSION = typeof FENOR_VERSION === 'string' ? FENOR_VERSION : 'dev';

const HELP = `Fenor ${VERSION} — método Fenor para o GitHub Copilot (Java e React)

Uso: fenor <comando> [opções]

  projetos                 lista os projetos Java e React da pasta
  kit [projeto]            mostra o que o kit Fenor faria (pré-visualização)
  kit [projeto] --aplicar  aplica o kit (nunca sobrescreve arquivos do time)
  situacao                 gera .fenor/situacao.md com a situação dos projetos
  uso [--dias 30]          gera relatório de uso e do que você fez em .fenor/relatorios/
  mcp                      inicia o servidor MCP (para o Copilot do IntelliJ ou do VS Code)
  intellij                 mostra a configuração MCP para colar no Copilot do IntelliJ

Opções: --root <pasta> (padrão: pasta atual)`;

interface Options {
  command: string;
  positional: string[];
  root: string;
  aplicar: boolean;
  dias: number;
}

export function parseArgs(argv: string[], cwd: string): Options {
  const positional: string[] = [];
  let root = cwd;
  let aplicar = false;
  let dias = 30;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      root = path.resolve(cwd, argv[++i] ?? '.');
    } else if (a === '--aplicar') {
      aplicar = true;
    } else if (a === '--dias') {
      dias = Math.max(1, Number(argv[++i]) || 30);
    } else {
      positional.push(a);
    }
  }
  return { command: positional.shift() ?? 'ajuda', positional, root, aplicar, dias };
}

/** Pasta do ECC: ao lado do fenor.js (pacote) ou na raiz do repositório (desenvolvimento). */
function eccRoot(): string | undefined {
  return [path.join(__dirname, 'ecc'), path.join(__dirname, '..', '..', '..', 'ecc')].find((d) => existsSync(path.join(d, 'LICENSE')));
}

async function kitCommand(o: Options, projects: ProjectFull[]): Promise<void> {
  const targets = o.positional[0] ? [resolveProject(projects, o.positional[0], o.root)] : projects;
  if (!targets.length) {
    console.log('Nenhum projeto Java ou React encontrado.');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const ecc = eccRoot();
  const plans = [];
  for (const p of targets) {
    const files = [...buildKitFiles(p, await detectCommands(p), today), ...(ecc ? await eccKitFiles(ecc, eccSelection(p)) : [])];
    plans.push({ project: p, steps: await planKit(p.path, files, kitManifest(p, today)), teamFiles: await existingGithubFiles(p.path) });
  }
  if (!o.aplicar) {
    const apply = `fenor kit${o.positional[0] ? ` ${o.positional[0]}` : ''} --aplicar`;
    console.log(previewReport(plans.map((p) => ({ name: p.project.name, relPath: p.project.relPath, steps: p.steps, teamFiles: p.teamFiles })), `Para aplicar, rode: \`${apply}\``));
    return;
  }
  for (const { project, steps } of plans) {
    const n = await applyKit(project.path, steps);
    const s = summarize(steps);
    console.log(`${project.relPath}: ${n} arquivo(s) gravado(s)${s.conflito ? `, ${s.conflito} conflito(s) ignorado(s)` : ''}`);
  }
  console.log('Revise o diff e faça o commit.');
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

export async function main(argv: string[]): Promise<number> {
  const o = parseArgs(argv, process.cwd());
  switch (o.command) {
    case 'mcp':
      serveStdio(o.root, VERSION);
      return -1; // continua rodando
    case 'intellij': {
      const script = path.resolve(__filename);
      console.log(`Cole em Settings → Tools → GitHub Copilot → Model Context Protocol (MCP) → Configure:\n`);
      console.log(JSON.stringify({ servers: { fenor: { type: 'stdio', command: process.execPath, args: [script, 'mcp'] } } }, null, 2));
      console.log('\nO Fenor usa a pasta aberta no IntelliJ. Se ela não for detectada, acrescente "--root", "<pasta>" em args.');
      return 0;
    }
    case 'projetos': {
      const projects = await loadProjects(o.root);
      console.log(projects.length ? projects.map((p) => `${p.relPath}\t${p.stack}\t${p.framework ?? ''}\tkit: ${p.kit?.applied ? 'sim' : 'não'}`).join('\n') : 'Nenhum projeto Java ou React encontrado.');
      return 0;
    }
    case 'kit':
      await kitCommand(o, await loadProjects(o.root));
      return 0;
    case 'situacao': {
      const dir = path.join(o.root, '.fenor');
      const file = path.join(dir, 'situacao.md');
      await writeFile(file, renderSituationReport(await loadProjects(o.root), new Date(), dir));
      console.log(`Relatório gravado em ${file}`);
      return 0;
    }
    case 'uso': {
      const to = new Date();
      const from = new Date(to.getTime() - (o.dias - 1) * 24 * 60 * 60 * 1000);
      from.setHours(0, 0, 0, 0);
      const projects = await loadProjects(o.root);
      const activity = [];
      for (const p of projects) {
        activity.push(await projectActivity(p.path, p.name, from, to));
      }
      const usage = summarizeUsage(await readEvents(USAGE_DIR, from, to), from, to);
      const file = path.join(o.root, '.fenor', 'relatorios', `uso-${from.toISOString().slice(0, 10)}-a-${to.toISOString().slice(0, 10)}.md`);
      await writeFile(file, renderUsageReport({ from, to }, usage, activity));
      console.log(`Relatório gravado em ${file}`);
      return 0;
    }
    case '--versao':
    case '--version':
      console.log(VERSION);
      return 0;
    default:
      console.log(HELP);
      return o.command === 'ajuda' || o.command === '--help' ? 0 : 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    if (code >= 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
