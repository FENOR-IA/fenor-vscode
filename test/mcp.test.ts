import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { parseArgs } from '../src/cli/main';
import { FenorMcpServer, TOOLS } from '../src/cli/mcp';
import { resolveProject } from '../src/cli/projects';
import { ProjectFull } from '../src/portfolio/situation';

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-mcp-'));
  const write = async (rel: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  await write('api/pom.xml', '<project><artifactId>api</artifactId></project>');
  await write('api/memory/kb/gotchas.md', '# Armadilhas\n\n- datas em UTC\n');
  await write('web/package.json', JSON.stringify({ name: 'web', dependencies: { react: '18' }, scripts: { test: 'echo ok' } }));
  return root;
}

function server(root: string, usageDir: string) {
  const sent: Array<Record<string, unknown>> = [];
  return { sent, s: new FenorMcpServer((m) => sent.push(m as unknown as Record<string, unknown>), root, '9.9.9', usageDir) };
}

test('handshake MCP, lista de ferramentas e erro para método desconhecido', async () => {
  const root = await workspace();
  const { sent, s } = server(root, await fs.mkdtemp(path.join(os.tmpdir(), 'uso-')));

  await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } });
  await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await s.handle({ jsonrpc: '2.0', id: 3, method: 'x/y' });

  assert.deepEqual(sent[0], { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fenor', version: '9.9.9' } } });
  assert.equal(sent.length, 3, 'notificação não recebe resposta');
  assert.deepEqual((sent[1].result as { tools: Array<{ name: string }> }).tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal((sent[2].error as { code: number }).code, -32601);
});

test('ferramentas: contexto, verificação real, erro de projeto e registro de uso', async () => {
  const root = await workspace();
  const usage = await fs.mkdtemp(path.join(os.tmpdir(), 'uso-'));
  const { s } = server(root, usage);

  const ctx = await s.callTool('fenor_contexto', { projeto: 'api' });
  const verif = await s.callTool('fenor_verificar', { projeto: 'web', etapas: ['test'] });
  const missing = await s.callTool('fenor_contexto', {});
  await new Promise((r) => setTimeout(r, 50));

  assert.match(ctx.content[0].text, /datas em UTC/);
  assert.match(verif.content[0].text, /verificação OK \(test\)/);
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Informe o projeto\. Projetos: (api, web|web, api)/);
  const log = await fs.readFile(path.join(usage, 'uso.jsonl'), 'utf8');
  assert.match(log, /"tipo":"verificacao".*"ok":true/);
});

test('salvar sessão pelo MCP grava na memória do projeto', async () => {
  const root = await workspace();
  const { s } = server(root, await fs.mkdtemp(path.join(os.tmpdir(), 'uso-')));

  const r = await s.callTool('fenor_salvar_sessao', { projeto: 'api', assunto: 'Limite', feito: ['endpoint'], proximo: 'testes' });

  assert.match(r.content[0].text, /Sessão salva em api/);
  assert.match(await fs.readFile(path.join(root, 'api/memory/progress/next.md'), 'utf8'), /testes/);
});

test('argumentos do comando fenor', () => {
  assert.deepEqual(parseArgs(['kit', 'api', '--aplicar', '--root', 'x'], '/w'), { command: 'kit', positional: ['api'], root: path.resolve('/w', 'x'), aplicar: true, dias: 30 });
  assert.equal(parseArgs(['uso', '--dias', '7'], '/w').dias, 7);
  assert.equal(parseArgs([], '/w').command, 'ajuda');
});

test('resolve projeto por nome, caminho relativo e absoluto', () => {
  const projects = [{ name: 'api', relPath: 'cartoes/api', path: '/w/cartoes/api' }, { name: 'web', relPath: 'cartoes/web', path: '/w/cartoes/web' }] as ProjectFull[];

  assert.equal(resolveProject(projects, 'api', '/w').relPath, 'cartoes/api');
  assert.equal(resolveProject(projects, 'cartoes/web', '/w').name, 'web');
  assert.equal(resolveProject(projects, '/w/cartoes/api/', '/w').name, 'api');
  assert.throws(() => resolveProject(projects, 'nada', '/w'), /não encontrado/);
});
