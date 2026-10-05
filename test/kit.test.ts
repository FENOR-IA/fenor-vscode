import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { applyKit, kitStatus, planKit, summarize } from '../src/kit/apply';
import { BLOCK_END, BLOCK_START, buildKitFiles, mergeBlock } from '../src/kit/build';
import { detectCommands } from '../src/kit/commands';
import { MODES } from '../src/kit/modes';
import { rulesFor } from '../src/kit/rules';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fenor-kit-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
}

const JAVA = { name: 'api-cartoes', stack: 'java' as const, framework: 'Spring Boot 3.2.5', runtime: 'Java 17', description: 'API de cartões' };

test('regras por stack incluem as comuns e as do framework', () => {
  assert.deepEqual(rulesFor({ stack: 'java', framework: 'Spring Boot 3' }), ['comum', 'seguranca', 'testes', 'java']);
  assert.deepEqual(rulesFor({ stack: 'php', framework: 'Symfony 6.4' }), ['comum', 'seguranca', 'testes', 'php', 'symfony']);
  assert.deepEqual(rulesFor({ stack: 'php', framework: 'App Fenor' }), ['comum', 'seguranca', 'testes', 'php', 'fenor-php74']);
  assert.deepEqual(rulesFor({ stack: 'react', framework: 'Vite 5' }), ['comum', 'seguranca', 'testes', 'react', 'node']);
});

test('kit gera modos e instruções para Claude Code, Copilot e Codex', () => {
  const files = buildKitFiles(JAVA, { test: './mvnw test', build: './mvnw -q verify', run: './mvnw spring-boot:run', port: 8080 }, '2026-10-04');
  const byPath = Object.fromEntries(files.map((f) => [f.relPath, f]));

  assert.equal(byPath['.claude/commands/fenor-planejar.md'].kind, 'generated');
  assert.match(byPath['.claude/commands/fenor-corrigir.md'].content, /\$ARGUMENTS/);
  assert.match(byPath['.github/prompts/fenor-executar.prompt.md'].content, /^---\nmode: agent/);
  assert.match(byPath['.github/prompts/fenor-executar.prompt.md'].content, /\$\{input:pedido/);
  assert.equal(byPath['.fenor/modos/revisar.md'].content, `${MODES.revisar.body}\n`);
  assert.equal(byPath['AGENTS.md'].kind, 'block');
  assert.match(byPath['AGENTS.md'].content, /- Testes: `\.\/mvnw test`/);
  assert.match(byPath['AGENTS.md'].content, /`\.fenor\/regras\/java\.md`/);
  assert.match(byPath['CLAUDE.md'].content, /@AGENTS\.md/);
  assert.equal(byPath['memory/kb/gotchas.md'].kind, 'seed');
  assert.ok(byPath['.fenor/regras/java.md']);
  assert.ok(!byPath['.fenor/regras/react.md']);
});

test('modos de leitura proíbem editar código; corrigir exige teste vermelho', () => {
  assert.equal(MODES.planejar.readOnly, true);
  assert.match(MODES.planejar.body, /NÃO edite código/);
  assert.match(MODES.revisar.body, /NÃO edite código/);
  assert.match(MODES.corrigir.body, /sem teste vermelho, não há correção/);
  assert.match(MODES.executar.body, /Nunca declare\npronto com teste/);
});

test('bloco do Fenor é inserido, substituído e preserva o resto do arquivo', () => {
  const original = '# Projeto do time\n\nRegras do time.\n';

  const first = mergeBlock(original, 'versão 1');
  const second = mergeBlock(`${first}\nRodapé do time\n`, 'versão 2');

  assert.ok(first.startsWith('# Projeto do time\n\nRegras do time.\n\n' + BLOCK_START));
  assert.ok(second.includes('versão 2') && !second.includes('versão 1'));
  assert.ok(second.endsWith(`${BLOCK_END}\n\nRodapé do time\n`));
  assert.equal(mergeBlock(undefined, 'x'), `${BLOCK_START}\nx\n${BLOCK_END}\n`);
});

test('aplicar o kit cria arquivos, mantém memória existente e é idempotente', async () => {
  const root = await tmp();
  await write(root, 'CLAUDE.md', '# Instruções do time\n');
  await write(root, 'memory/kb/gotchas.md', '# Já tenho gotchas\n- não mexer no fuso\n');
  const files = buildKitFiles(JAVA, { test: 'mvn test' }, '2026-10-04');

  const first = await planKit(root, files);
  await applyKit(root, first);
  const second = summarize(await planKit(root, files));

  assert.equal(first.find((s) => s.file.relPath === 'memory/kb/gotchas.md')?.action, 'manter');
  assert.equal(first.find((s) => s.file.relPath === 'CLAUDE.md')?.action, 'atualizar');
  assert.equal(await fs.readFile(path.join(root, 'memory/kb/gotchas.md'), 'utf8'), '# Já tenho gotchas\n- não mexer no fuso\n');
  assert.match(await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /^# Instruções do time\n\n<!-- fenor:inicio/);
  assert.deepEqual([second.criar, second.atualizar], [0, 0]);
  assert.deepEqual(await kitStatus(root), { applied: true, version: '1', appliedAt: '2026-10-04' });
});

test('recusa escrever fora do projeto', async () => {
  const root = await tmp();

  await assert.rejects(applyKit(root, [{ file: { relPath: '../fora.md', kind: 'generated', content: 'x' }, action: 'criar', next: 'x' }]), /fora do projeto/);
});

test('detecta comandos de verificação e execução por stack', async () => {
  const java = await tmp();
  await write(java, 'pom.xml', '<project/>');
  await write(java, 'mvnw', '');
  const react = await tmp();
  await write(react, 'package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build', test: 'vitest', lint: 'eslint .' } }));
  const fenor = await tmp();
  await write(fenor, 'front/index.php', '<?php');
  const symfony = await tmp();
  await write(symfony, 'bin/phpunit', '');

  assert.deepEqual(await detectCommands({ path: java, stack: 'java' }), { run: './mvnw spring-boot:run', test: './mvnw test', build: './mvnw -q verify', port: 8080 });
  assert.deepEqual(await detectCommands({ path: react, stack: 'react', framework: 'Vite 5' }), { run: 'npm run dev', test: 'npm test -- --run', build: 'npm run build', lint: 'npm run lint', port: 5173 });
  assert.equal((await detectCommands({ path: fenor, stack: 'php', framework: 'App Fenor' })).run, 'php -S localhost:8000 -t front front/index.php');
  assert.equal((await detectCommands({ path: symfony, stack: 'php', framework: 'Symfony 6.4' })).test, 'php bin/phpunit');
});
