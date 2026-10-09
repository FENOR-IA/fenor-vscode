import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { applyKit, existingGithubFiles, kitStatus, planKit, previewReport, summarize } from '../src/kit/apply';
import { BLOCK_END, BLOCK_START, buildKitFiles, kitManifest, mergeBlock } from '../src/kit/build';
import { detectCommands } from '../src/kit/commands';
import { MODES } from '../src/kit/modes';
import { RULE_APPLY_TO, rulesFor } from '../src/kit/rules';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fenor-kit-'));
}

async function write(root: string, rel: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
}

const JAVA = { name: 'api-cartoes', stack: 'java' as const, framework: 'Spring Boot 3.2.5', runtime: 'Java 17', description: 'API de cartões' };

test('regras: comuns sempre, mais a da stack, aplicadas pelo tipo de arquivo', () => {
  assert.deepEqual(rulesFor({ stack: 'java' }), ['comum', 'seguranca', 'testes', 'java']);
  assert.deepEqual(rulesFor({ stack: 'react' }), ['comum', 'seguranca', 'testes', 'react']);
  assert.equal(RULE_APPLY_TO.java, '**/*.java');
});

test('kit no formato nativo do Copilot, sem arquivos de outras IAs', () => {
  const files = buildKitFiles(JAVA, { test: './mvnw test', build: './mvnw -q verify', run: './mvnw spring-boot:run', port: 8080 }, '2026-10-04');
  const byPath = Object.fromEntries(files.map((f) => [f.relPath, f]));

  assert.equal(byPath['.github/copilot-instructions.md'].kind, 'block');
  assert.match(byPath['.github/copilot-instructions.md'].content, /- Testes: `\.\/mvnw test`/);
  assert.match(byPath['.github/instructions/fenor-java.instructions.md'].content, /^---\napplyTo: '\*\*\/\*\.java'\n---/);
  assert.match(byPath['.github/prompts/fenor-executar.prompt.md'].content, /^---\nmode: agent/);
  assert.match(byPath['.github/prompts/fenor-revisar.prompt.md'].content, /^---\nmode: ask/);
  assert.equal(byPath['memory/kb/gotchas.md'].kind, 'seed');
  assert.ok(!files.some((f) => /^(CLAUDE|AGENTS)\.md$|^\.claude\//.test(f.relPath)));
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

test('aplicar o kit preserva o que o time já tem e é idempotente', async () => {
  const root = await tmp();
  await write(root, '.github/copilot-instructions.md', '# Instruções do time\nUse JUnit 4.\n');
  await write(root, 'memory/kb/gotchas.md', '# Já tenho gotchas\n- não mexer no fuso\n');
  const files = buildKitFiles(JAVA, { test: 'mvn test' }, '2026-10-04');
  const manifest = kitManifest(JAVA, '2026-10-04');

  const first = await planKit(root, files, manifest);
  await applyKit(root, first);
  const second = summarize(await planKit(root, files, manifest));

  assert.equal(first.find((s) => s.file.relPath === 'memory/kb/gotchas.md')?.action, 'manter');
  assert.equal(first.find((s) => s.file.relPath === '.github/copilot-instructions.md')?.action, 'atualizar');
  assert.equal(await fs.readFile(path.join(root, 'memory/kb/gotchas.md'), 'utf8'), '# Já tenho gotchas\n- não mexer no fuso\n');
  assert.match(await fs.readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8'), /^# Instruções do time\nUse JUnit 4\.\n\n<!-- fenor:inicio/);
  assert.deepEqual([second.criar, second.atualizar, second.conflito], [0, 0, 0]);
  assert.equal((await kitStatus(root)).appliedAt, '2026-10-04');
});

test('arquivo do time com o mesmo nome vira conflito e nunca é sobrescrito', async () => {
  const root = await tmp();
  await write(root, '.github/agents/code-reviewer.agent.md', '# revisor do time');
  const files = [{ relPath: '.github/agents/code-reviewer.agent.md', kind: 'generated' as const, content: '# revisor do ECC' }];

  const steps = await planKit(root, files, kitManifest(JAVA, '2026-10-04'));
  await applyKit(root, steps);

  assert.equal(steps[0].action, 'conflito');
  assert.equal(await fs.readFile(path.join(root, '.github/agents/code-reviewer.agent.md'), 'utf8'), '# revisor do time');
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.fenor/kit.json'), 'utf8'));
  assert.deepEqual(manifest.arquivos, []);
});

test('arquivo gerado pelo Fenor em aplicação anterior é atualizado normalmente', async () => {
  const root = await tmp();
  const manifest = kitManifest(JAVA, '2026-10-04');
  await applyKit(root, await planKit(root, [{ relPath: '.github/prompts/fenor-x.prompt.md', kind: 'generated', content: 'v1' }], manifest));

  const steps = await planKit(root, [{ relPath: '.github/prompts/fenor-x.prompt.md', kind: 'generated', content: 'v2' }], manifest);

  assert.equal(steps[0].action, 'atualizar');
});

test('pré-visualização lista conflitos e arquivos do time que continuam valendo', async () => {
  const root = await tmp();
  await write(root, '.github/instructions/time.instructions.md', 'x');
  await write(root, '.github/agents/code-reviewer.agent.md', 'x');
  const steps = await planKit(root, [{ relPath: '.github/agents/code-reviewer.agent.md', kind: 'generated', content: 'y' }], kitManifest(JAVA, '2026-10-04'));

  const report = previewReport([{ name: 'api', relPath: 'api', steps, teamFiles: await existingGithubFiles(root) }]);

  assert.match(report, /\*\*1 conflito\(s\)\*\*/);
  assert.match(report, /CONFLITO — já existe arquivo do time/);
  assert.match(report, /- `\.github\/instructions\/time\.instructions\.md`/);
});

test('recusa escrever fora do projeto', async () => {
  const root = await tmp();

  await assert.rejects(applyKit(root, [{ file: { relPath: '../fora.md', kind: 'generated', content: 'x' }, action: 'criar', next: 'x' }]), /fora do projeto/);
});

test('detecta comandos de verificação e execução de Java e React', async () => {
  const java = await tmp();
  await write(java, 'pom.xml', '<project/>');
  await write(java, 'mvnw', '');
  const react = await tmp();
  await write(react, 'package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build', test: 'vitest', lint: 'eslint .' } }));

  assert.deepEqual(await detectCommands({ path: java, stack: 'java' }), { run: './mvnw spring-boot:run', test: './mvnw test', build: './mvnw -q verify', port: 8080 });
  assert.deepEqual(await detectCommands({ path: react, stack: 'react', framework: 'Vite 5' }), { run: 'npm run dev', test: 'npm test -- --run', build: 'npm run build', lint: 'npm run lint', port: 5173 });
});
