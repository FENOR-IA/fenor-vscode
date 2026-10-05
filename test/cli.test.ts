import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { claudeArgs, codexArgs, findCli, parseClaudeLine, runCli } from '../src/ai/cli';

test('Claude Code roda em modo print, só leitura, com o contexto como system prompt', () => {
  const args = claudeArgs('regras do fenor');

  assert.deepEqual(args, ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', 'regras do fenor', '--allowedTools', 'Read', 'Grep', 'Glob']);
  assert.ok(!args.some((a) => /Bash|Edit|Write|dangerously/.test(a)));
});

test('Codex roda exec lendo o prompt do stdin, sem sandbox de escrita', () => {
  const args = codexArgs('/w');

  assert.deepEqual(args, ['exec', '--skip-git-repo-check', '--ephemeral', '-C', '/w', '-']);
  assert.ok(!args.some((a) => /write|danger|full-auto/.test(a)));
});

test('interpreta eventos do stream-json do Claude Code', () => {
  const text = parseClaudeLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }, { type: 'text', text: 'Olá' }, { type: 'text', text: ' mundo' }] } }));
  const error = parseClaudeLine(JSON.stringify({ type: 'result', is_error: true, result: 'Não autenticado' }));
  const ok = parseClaudeLine(JSON.stringify({ type: 'result', is_error: false, result: 'Olá mundo' }));

  assert.deepEqual(text, { text: 'Olá mundo' });
  assert.deepEqual(error, { error: 'Não autenticado' });
  assert.deepEqual(ok, {});
  assert.deepEqual(parseClaudeLine('lixo não json'), {});
});

async function fakeAgent(script: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-cli-'));
  const file = path.join(dir, 'agente');
  await fs.writeFile(file, `#!/usr/bin/env node\n${script}`);
  await fs.chmod(file, 0o755);
  return file;
}

test('encontra o CLI pelo caminho configurado e ignora caminho inexistente', async () => {
  const agent = await fakeAgent('');

  assert.equal(await findCli('claude', agent), agent);
  assert.notEqual(await findCli('codex', '/nao/existe/codex'), '/nao/existe/codex');
});

test('envia o prompt pelo stdin e entrega a saída linha a linha', async () => {
  const agent = await fakeAgent(`
let input = '';
process.stdin.on('data', (c) => input += c);
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'recebi: ' + input }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false }));
  process.stderr.write('progresso');
});`);
  const lines: string[] = [];

  const result = await runCli(agent, [], { cwd: os.tmpdir(), stdin: 'situação do crm', timeoutMs: 10000, onStdoutLine: (l) => lines.push(l) });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, 'progresso');
  assert.equal(lines.length, 2);
  assert.deepEqual(parseClaudeLine(lines[0]), { text: 'recebi: situação do crm' });
});

test('cancelamento encerra o processo', async () => {
  const agent = await fakeAgent('setInterval(() => process.stdout.write("."), 50);');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);

  const started = Date.now();
  const result = await runCli(agent, [], { cwd: os.tmpdir(), stdin: '', timeoutMs: 10000, signal: controller.signal });

  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 5000);
});
