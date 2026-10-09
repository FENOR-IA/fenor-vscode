import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { ProjectFull } from '../src/portfolio/situation';
import { guessRole, normalizeSystems, resolveVaultPath, suggestSystems } from '../src/systems/model';
import { loadSystems, saveSystems } from '../src/systems/store';
import { buildVaultFiles, renderNote, writeVault } from '../src/systems/vault';

const p = (relPath: string, stack: ProjectFull['stack'], framework?: string) => ({ name: path.basename(relPath), relPath, stack, framework });

test('adivinha o papel pela stack e pelo nome', () => {
  assert.equal(guessRole(p('cartoes/web-cartoes', 'react', 'Vite 5')), 'front');
  assert.equal(guessRole(p('cartoes/api-cartoes', 'java', 'Spring Boot 3')), 'api');
  assert.equal(guessRole(p('pix/pix-service', 'java')), 'back');
  assert.equal(guessRole(p('cobranca-worker', 'java')), 'worker');
  assert.equal(guessRole(p('banco-ios', 'react')), 'mobile');
  assert.equal(guessRole(p('portal-docs', 'react')), 'docs');
});

test('sugere sistemas por pasta e prefixo, sem mexer nos já configurados', () => {
  const projects = [
    p('cartoes/api-cartoes', 'java'), p('cartoes/web-cartoes', 'react'),
    p('pix-api', 'java'), p('pix-web', 'react'),
    p('crm-parceira', 'java'), p('crm-remate', 'java'),
    p('cobranca', 'java'),
  ];
  const existing = normalizeSystems({ sistemas: [{ name: 'Cobrança', components: [{ project: 'cobranca', role: 'back' }] }] });

  const result = suggestSystems(projects, existing);
  const byName = Object.fromEntries(result.sistemas.map((s) => [s.name, s.components.map((c) => c.project)]));

  assert.deepEqual(byName, {
    'Cobrança': ['cobranca'], Cartoes: ['cartoes/api-cartoes', 'cartoes/web-cartoes'],
    'Crm Parceira': ['crm-parceira'], 'Crm Remate': ['crm-remate'], Pix: ['pix-api', 'pix-web'],
  });
  assert.equal(result.sistemas.find((s) => s.name === 'Pix')?.vault, 'pix-vault');
});

test('normaliza dados do painel: ids únicos, papéis válidos, sem caminhos com ..', () => {
  const data = normalizeSystems({ sistemas: [
    { name: 'Cartões', components: [{ project: 'a/', role: 'front' }, { project: 'a', role: 'x' }, { project: '../fora', role: 'back' }] },
    { name: 'Cartões', components: 'lixo' },
    { name: '  ' },
  ] });

  assert.deepEqual(data.sistemas.map((s) => s.id), ['cartoes', 'cartoes-2']);
  assert.deepEqual(data.sistemas[0].components, [{ project: 'a', role: 'front' }]);
  assert.deepEqual(data.sistemas[1].components, []);
  assert.equal(resolveVaultPath('/w', data.sistemas[0]), path.join('/w', 'cartoes-vault'));
});

test('salva e carrega .fenor/sistemas.json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-sys-'));

  await saveSystems(root, { versao: 1, sistemas: [{ id: 'x', name: 'Cartões', components: [{ project: 'api', role: 'api' }] }] });

  assert.deepEqual(await loadSystems(root), { versao: 1, sistemas: [{ id: 'x', name: 'Cartões', components: [{ project: 'api', role: 'api' }] }] });
  assert.deepEqual(await loadSystems(path.join(root, 'nao-existe')), { versao: 1, sistemas: [] });
});

function full(relPath: string, stack: ProjectFull['stack'], framework?: string): ProjectFull {
  return {
    ...p(relPath, stack, framework), path: `/w/${relPath}`, buildFile: 'x', testCount: 1, description: `Descrição de ${relPath}`,
    git: { branch: 'main', dirtyFiles: 0, commits: [{ hash: 'a', author: 'Ana', date: '2026-10-01T00:00:00Z', subject: 'feat: x', workItemIds: [] }] },
    docs: { files: [{ relPath: 'README.md', modified: '2026-10-01' }], checklistOpen: 1, checklistDone: 1, pending: [{ text: 'tela de extrato', file: 'memory/plan.md' }] },
  };
}

const SYSTEM = { id: 'cartoes', name: 'Cartões', description: 'Cartões PJ', components: [
  { project: 'cartoes/web', role: 'front' as const }, { project: 'cartoes/api', role: 'api' as const }, { project: 'sumiu', role: 'back' as const },
] };

test('vault tem nota do sistema com mapa e uma nota por componente com cabeçalho no topo', () => {
  const files = buildVaultFiles(SYSTEM, [
    { component: SYSTEM.components[0], project: full('cartoes/web', 'react', 'Vite 5') },
    { component: SYSTEM.components[1], project: full('cartoes/api', 'java', 'Spring Boot 3'), commands: { test: './mvnw test', run: './mvnw spring-boot:run', port: 8080 } },
    { component: SYSTEM.components[2] },
  ], new Date('2026-10-04T12:00:00Z'));
  const byPath = Object.fromEntries(files.map((f) => [f.relPath, f]));

  const sys = renderNote(undefined, byPath['Cartões.md']);
  const api = renderNote(undefined, byPath['Componentes/api.md']);

  assert.ok(sys.startsWith('---\ntipo: sistema\nsistema: Cartões\n'));
  assert.match(sys, /\| \[\[web\]\] \| Front-end \|/);
  assert.match(sys, /c\d --> c\d/);
  assert.ok(api.startsWith('---\ntipo: componente\n'));
  assert.match(api, /Parte de \[\[Cartões\]\] · \*\*API\*\*/);
  assert.match(api, /- Testes: `\.\/mvnw test`/);
  assert.match(api, /- \[ \] tela de extrato/);
  assert.match(api, /\[\[web\]\] \(Front-end\)/);
  assert.match(renderNote(undefined, byPath['Componentes/sumiu.md']), /Projeto não encontrado/);
});

test('regerar a nota mantém o texto escrito pelo time', () => {
  const file = { relPath: 'x.md', kind: 'note' as const, frontmatter: 'tipo: componente', content: '# x\n\nversão 1' };
  const first = renderNote(undefined, file);

  const edited = `${first}\n## Notas do time\nNão mexer no fuso.\n`;
  const second = renderNote(edited, { ...file, frontmatter: 'tipo: componente\nsituacao: ativo', content: '# x\n\nversão 2' });

  assert.ok(second.startsWith('---\ntipo: componente\nsituacao: ativo\n---\n\n<!-- fenor:inicio'));
  assert.ok(second.includes('versão 2') && !second.includes('versão 1'));
  assert.ok(second.includes('## Notas do time\nNão mexer no fuso.'));
});

test('grava o vault como repositório git próprio e não recria seeds', async () => {
  const vault = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-vault-')), 'cartoes-vault');
  const files = buildVaultFiles(SYSTEM, [{ component: SYSTEM.components[1], project: full('cartoes/api', 'java') }], new Date());

  const first = await writeVault(vault, SYSTEM, files);
  await fs.writeFile(path.join(vault, 'Glossário.md'), '# Meu glossário\n');
  const second = await writeVault(vault, SYSTEM, files);

  assert.equal(first.createdRepo, true);
  assert.equal(second.createdRepo, false);
  assert.equal(execFileSync('git', ['-C', vault, 'rev-parse', '--is-inside-work-tree']).toString().trim(), 'true');
  assert.equal(await fs.readFile(path.join(vault, 'Glossário.md'), 'utf8'), '# Meu glossário\n');
  assert.equal(JSON.parse(await fs.readFile(path.join(vault, 'sistema.json'), 'utf8')).sistema.name, 'Cartões');
  assert.equal(second.written, 0);
});
