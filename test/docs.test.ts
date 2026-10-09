import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { collectDocs, firstParagraph, parseMarkdown } from '../src/portfolio/docs';
import { renderSituationReport } from '../src/portfolio/report';
import { ProjectFull, situationOf } from '../src/portfolio/situation';

test('lê checklists e itens sob títulos de pendência, ignorando blocos de código', () => {
  const md = [
    '# Plano',
    '- [x] login',
    '- [X] cadastro',
    '- [ ] **relatório** de vendas',
    '## Pendências',
    '- integrar com [Cora](http://x)',
    '1. revisar permissões',
    '## Feito',
    '- deploy',
    '```',
    '- [ ] dentro de código',
    '```',
  ].join('\n');

  const parsed = parseMarkdown(md);

  assert.deepEqual(parsed.open, ['relatório de vendas']);
  assert.equal(parsed.done, 2);
  assert.deepEqual(parsed.underPendingHeading, ['integrar com Cora', 'revisar permissões']);
});

test('resumo pula o cabeçalho padrão do CLAUDE.md', () => {
  const md = '# CLAUDE.md\n\nThis file provides guidance to Claude Code when working here.\n\nSistema de gestão de leilões rurais com lotes, lances e contratos.\n';

  assert.equal(firstParagraph(md), 'Sistema de gestão de leilões rurais com lotes, lances e contratos.');
});

test('coleta .md priorizando README/CLAUDE e ignorando sessões antigas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-docs-'));
  await fs.mkdir(path.join(root, 'memory', 'sessions'), { recursive: true });
  await fs.writeFile(path.join(root, 'memory', 'plan.md'), '- [ ] tela de extrato\n- [x] login\n');
  await fs.writeFile(path.join(root, 'memory', 'sessions', 's1.md'), '- [ ] item velho de sessão\n');
  await fs.writeFile(path.join(root, 'CLAUDE.md'), '# App\n\nCRM de parceiros com funil de vendas e agenda.\n');

  const docs = await collectDocs(root);

  assert.deepEqual(docs.files.map((f) => f.relPath), ['CLAUDE.md', 'memory/plan.md']);
  assert.equal(docs.summary, 'CRM de parceiros com funil de vendas e agenda.');
  assert.deepEqual([docs.checklistOpen, docs.checklistDone], [1, 1]);
  assert.deepEqual(docs.pending, [{ text: 'tela de extrato', file: 'memory/plan.md' }]);
  assert.ok(docs.lastUpdate);
});

function project(overrides: Partial<ProjectFull>): ProjectFull {
  return {
    name: 'crm', path: '/w/crm', relPath: 'crm', stack: 'java', buildFile: 'pom.xml', testCount: 0,
    git: { branch: 'main', dirtyFiles: 2, commits: [{ hash: 'a', author: 'Ana', date: '2026-09-30T10:00:00Z', subject: 'feat: agenda', workItemIds: [] }] },
    docs: { files: [{ relPath: 'memory/plan.md', modified: '2026-08-01T00:00:00Z' }], checklistOpen: 1, checklistDone: 3, pending: [{ text: 'relatório', file: 'memory/plan.md' }] },
    ...overrides,
  };
}

test('classifica atividade e sinaliza alertas', () => {
  const now = new Date('2026-10-03T12:00:00Z');

  const ativo = situationOf(project({}), now);
  const parado = situationOf(project({ git: { dirtyFiles: 0, commits: [] }, docs: { files: [{ relPath: 'a.md', modified: '2026-05-01T00:00:00Z' }], checklistOpen: 0, checklistDone: 0, pending: [], lastUpdate: '2026-05-01T00:00:00Z' } }), now);
  const semDados = situationOf(project({ git: { dirtyFiles: 0, commits: [] }, docs: { files: [], checklistOpen: 0, checklistDone: 0, pending: [] } }), now);

  assert.equal(ativo.activity, 'ativo');
  assert.equal(ativo.progress, 75);
  assert.deepEqual(ativo.flags, ['2 arquivo(s) sem commit', 'sem testes']);
  assert.equal(parado.activity, 'parado');
  assert.ok(parado.flags.includes('sem git'));
  assert.equal(semDados.activity, 'sem-dados');
  assert.ok(semDados.flags.includes('sem documentação'));
});

test('relatório lista resumo, tabela e pendências com link relativo', () => {
  const md = renderSituationReport([project({ description: 'CRM | parceiros' })], new Date('2026-10-03T12:00:00Z'), '/w/.fenor');

  assert.match(md, /\*\*1 ativos\*\*/);
  assert.match(md, /\| \[crm\]\(#crm\) \| Java \| Ativo \| há 3 dias \| 75% \(1 abertos\)/);
  assert.match(md, /> CRM \\\| parceiros/);
  assert.match(md, /- relatório — \[memory\/plan\.md\]\(\.\.\/crm\/memory\/plan\.md\)/);
});
