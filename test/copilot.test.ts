import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { rootInstructionFile, writeRootInstructions } from '../src/copilot/instructions';
import { buildKitFiles, copilotInstructions } from '../src/kit/build';
import { buildProjectContext, saveSession } from '../src/kit/memoryFiles';
import { formatVerification, runVerification } from '../src/kit/verify';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fenor-cop-'));
}

test('verificação roda os comandos do projeto e reprova quando um falha', async () => {
  const dir = await tmp();

  const results = await runVerification(dir, { test: 'echo testes ok', build: 'echo quebrou >&2; exit 3' }, ['test', 'build', 'lint']);
  const report = formatVerification('api', results);

  assert.deepEqual(results.map((r) => [r.step, r.ok, r.skipped]), [['test', true, false], ['build', false, false], ['lint', true, true]]);
  assert.equal(results[1].code, 3);
  assert.match(results[1].output, /quebrou/);
  assert.match(report, /VERIFICAÇÃO FALHOU em build\. Não declare a tarefa concluída/);
});

test('sem comandos detectados, avisa em vez de aprovar', () => {
  assert.match(formatVerification('docs', [{ step: 'test', ok: true, skipped: true, output: '', durationMs: 0 }]), /nenhum comando de verificação detectado/);
});

test('contexto traz a sessão mais recente e ignora memória vazia', async () => {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, 'memory/sessions'), { recursive: true });
  await fs.mkdir(path.join(dir, 'memory/kb'), { recursive: true });
  await fs.writeFile(path.join(dir, 'memory/sessions/2026-09-01-a.md'), 'velha');
  await fs.writeFile(path.join(dir, 'memory/sessions/2026-10-01-b.md'), 'sessão nova');
  await fs.writeFile(path.join(dir, 'memory/kb/gotchas.md'), '# Armadilhas\n\n- datas sempre em UTC\n');
  await fs.writeFile(path.join(dir, 'memory/kb/domain.md'), '# Regras de negócio\n\n');

  const ctx = await buildProjectContext(dir, 'api');

  assert.match(ctx, /## memory\/sessions\/2026-10-01-b\.md\n\nsessão nova/);
  assert.doesNotMatch(ctx, /velha/);
  assert.match(ctx, /datas sempre em UTC/);
  assert.doesNotMatch(ctx, /memory\/kb\/domain\.md/);
});

test('salvar sessão grava a sessão, o próximo passo, o feito e os aprendizados', async () => {
  const dir = await tmp();

  const written = await saveSession(dir, { assunto: 'Limite do cartão', feito: ['endpoint GET /limite'], proximo: 'tratar cartão adicional', aprendizados: ['BigDecimal no limite — double arredondava'] }, new Date('2026-10-04T12:00:00Z'));

  assert.deepEqual(written, ['memory/sessions/2026-10-04-limite-do-cartao.md', 'memory/progress/next.md', 'memory/progress/done.md', 'memory/kb/gotchas.md']);
  assert.match(await fs.readFile(path.join(dir, 'memory/progress/next.md'), 'utf8'), /tratar cartão adicional/);
  assert.match(await fs.readFile(path.join(dir, 'memory/kb/gotchas.md'), 'utf8'), /- BigDecimal no limite — double arredondava _\(2026-10-04\)_/);
});

test('instruções na raiz aplicam o método só aos arquivos do projeto', async () => {
  const agents = copilotInstructions({ name: 'api-cartoes', stack: 'java' }, { test: 'mvn test' });
  const file = rootInstructionFile('cartoes/api-cartoes', 'api-cartoes', agents);
  const root = await tmp();

  assert.equal(file.relPath, '.github/instructions/fenor-cartoes-api-cartoes.instructions.md');
  assert.match(file.content, /^---\napplyTo: 'cartoes\/api-cartoes\/\*\*'\n/);
  assert.match(file.content, /projeto: "cartoes\/api-cartoes"/);
  assert.match(file.content, /#fenor_verificar/);
  assert.equal(await writeRootInstructions(root, [file]), 1);
  assert.equal(await writeRootInstructions(root, [file]), 0);
});

test('prompts do Copilot mandam usar as ferramentas do Fenor', () => {
  const files = buildKitFiles({ name: 'api', stack: 'java' }, {}, '2026-10-04');

  assert.match(files.find((f) => f.relPath === '.github/prompts/fenor-executar.prompt.md')?.content ?? '', /#fenor_contexto[\s\S]*#fenor_verificar[\s\S]*#fenor_salvar_sessao/);
  assert.doesNotMatch(files.find((f) => f.relPath === '.github/prompts/fenor-revisar.prompt.md')?.content ?? '', /fenor_salvar_sessao/);
});
