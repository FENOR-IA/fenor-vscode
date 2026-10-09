import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { projectActivity } from '../src/usage/activity';
import { appendEvent, days, eventsToCsv, readEvents, summarizeUsage, UsageEvent } from '../src/usage/log';
import { renderUsageBody } from '../src/usage/render';
import { renderUsageReport } from '../src/usage/report';

const FROM = new Date('2026-10-01T00:00:00Z');
const TO = new Date('2026-10-03T23:59:59Z');

const EVENTS: UsageEvent[] = [
  { ts: '2026-10-01T10:00:00Z', tipo: 'chat', comando: 'situacao', projeto: 'api', modelo: 'GPT-5', tokensEntrada: 1000, tokensSaida: 200 },
  { ts: '2026-10-02T10:00:00Z', tipo: 'chat', comando: 'board', modelo: 'Claude Sonnet', tokensEntrada: 3000, tokensSaida: 500 },
  { ts: '2026-10-02T11:00:00Z', tipo: 'verificacao', comando: 'fenor_verificar', projeto: 'api', ok: false },
  { ts: '2026-10-03T11:00:00Z', tipo: 'verificacao', comando: 'fenor_verificar', projeto: 'api', ok: true },
  { ts: '2026-10-03T12:00:00Z', tipo: 'ferramenta', comando: 'fenor_contexto', projeto: 'web' },
];

test('grava e lê eventos só do período, ignorando linhas corrompidas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-uso-'));
  await appendEvent(dir, { ts: '2026-09-20T00:00:00Z', tipo: 'chat' });
  await appendEvent(dir, EVENTS[0]);
  await fs.appendFile(path.join(dir, 'uso.jsonl'), 'lixo\n');

  const events = await readEvents(dir, FROM, TO);

  assert.deepEqual(events, [EVENTS[0]]);
  assert.deepEqual(await readEvents(path.join(dir, 'nao-existe'), FROM, TO), []);
});

test('resume tokens, verificações e onde o consumo foi', () => {
  const s = summarizeUsage(EVENTS, FROM, TO);

  assert.equal(s.pedidosChat, 2);
  assert.deepEqual([s.tokensEntrada, s.tokensSaida], [4000, 700]);
  assert.equal(s.chamadasFerramentas, 3);
  assert.deepEqual(s.verificacoes, { ok: 1, falha: 1 });
  assert.deepEqual(s.porDia.map((d) => [d.dia, d.tokens]), [['2026-10-01', 1200], ['2026-10-02', 3500], ['2026-10-03', 0]]);
  assert.deepEqual(s.porModelo.map((m) => m.chave), ['Claude Sonnet', 'GPT-5']);
  assert.equal(s.porProjeto[0].chave, '(sem projeto)');
  assert.equal(s.porProjeto.find((p) => p.chave === 'api')?.eventos, 3);
});

test('dias do período e CSV com escape', () => {
  assert.deepEqual(days(FROM, TO), ['2026-10-01', '2026-10-02', '2026-10-03']);
  const csv = eventsToCsv([{ ts: 't', tipo: 'chat', detalhe: 'a, "b"' }]);
  assert.equal(csv, 'ts,tipo,projeto,comando,modelo,tokensEntrada,tokensSaida,duracaoMs,ok,detalhe\nt,chat,,,,,,,,"a, ""b"""\n');
});

test('meus commits e sessões do período, com work items citados', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-act-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q');
  run('config', 'user.email', 'eu@banco.com');
  run('config', 'user.name', 'Eu');
  await fs.writeFile(path.join(repo, 'a.txt'), '1');
  run('add', '.');
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'feat: limite AB#12'], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-02T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T10:00:00Z' } });
  await fs.writeFile(path.join(repo, 'a.txt'), '2');
  run('add', '.');
  execFileSync('git', ['-C', repo, '-c', 'user.email=outro@banco.com', 'commit', '-qm', 'fix: de outra pessoa'], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-02T11:00:00Z', GIT_COMMITTER_DATE: '2026-10-02T11:00:00Z' } });
  await fs.mkdir(path.join(repo, 'memory/sessions'), { recursive: true });
  await fs.writeFile(path.join(repo, 'memory/sessions/2026-10-02-limite.md'), '');
  await fs.writeFile(path.join(repo, 'memory/sessions/2026-09-01-velha.md'), '');

  const a = await projectActivity(repo, 'api', FROM, TO);

  assert.deepEqual(a.commits.map((c) => c.assunto), ['feat: limite AB#12']);
  assert.deepEqual(a.sessoes, ['2026-10-02-limite']);
  assert.deepEqual(a.workItems, [12]);
});

test('painel e relatório mostram consumo, o que fiz e o aviso sobre o Copilot', () => {
  const usage = summarizeUsage(EVENTS, FROM, TO);
  const activity = [{ projeto: 'api', commits: [{ hash: 'a1', data: '2026-10-02', assunto: 'feat: <b>x</b> AB#12' }], sessoes: [], workItems: [12] }];

  const html = renderUsageBody({ periodDays: 7, from: FROM, to: TO, usage, activity });
  const md = renderUsageReport({ from: FROM, to: TO }, usage, activity);

  assert.match(html, /4\.700/);
  assert.match(html, /data-pct="100"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /premium requests/);
  assert.match(md, /\| Tokens estimados \(entrada \/ saída\) \| 4\.000 \/ 700 \|/);
  assert.match(md, /\| Verificações \(aprovadas \/ reprovadas\) \| 1 \/ 1 \(50% aprovadas\) \|/);
  assert.match(md, /- `a1` 2026-10-02 — feat: <b>x<\/b> AB#12/);
});
