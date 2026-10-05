import { strict as assert } from 'assert';
import { test } from 'node:test';
import { analyzeSprint, bucketOf, countByBucket, loadByMember } from '../src/azure/analysis';
import { escapeWiql, parseAzureInput, stripHtml, WorkItem } from '../src/azure/client';
import { extractWorkItemIds, parseLog } from '../src/portfolio/git';

const NOW = new Date('2026-10-03T12:00:00Z');

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 1, project: 'p', title: 'Item', type: 'Task', state: 'Active', assignedTo: 'Ana',
    changedDate: '2026-10-02T12:00:00Z', tags: [], url: 'https://dev.azure.com/o/p/_workitems/edit/1',
    ...overrides,
  };
}

test('classifica estados em português e inglês', () => {
  assert.equal(bucketOf('New'), 'todo');
  assert.equal(bucketOf('A Fazer'), 'todo');
  assert.equal(bucketOf('Active'), 'doing');
  assert.equal(bucketOf('Concluído'), 'done');
  assert.equal(bucketOf('Closed'), 'done');
});

test('gera alertas de critério, responsável, item parado e item grande', () => {
  const items = [
    item({ id: 10, type: 'User Story', acceptanceCriteria: undefined }),
    item({ id: 11, assignedTo: undefined }),
    item({ id: 12, changedDate: '2026-09-20T12:00:00Z' }),
    item({ id: 13, storyPoints: 13 }),
    item({ id: 14, state: 'Done', assignedTo: undefined }),
    item({ id: 15, type: 'User Story', acceptanceCriteria: 'Dado que...' }),
  ];

  const alerts = analyzeSprint(items, NOW, 5);

  assert.deepEqual(alerts.map((a) => [a.workItemId, a.kind]), [
    [10, 'sem-criterio'],
    [11, 'sem-responsavel'],
    [12, 'parado'],
    [13, 'grande'],
  ]);
  assert.match(alerts[2].message, /13 dias/);
});

test('soma carga por pessoa só com itens abertos', () => {
  const items = [
    item({ id: 1, assignedTo: 'Ana', remainingWork: 4 }),
    item({ id: 2, assignedTo: 'Ana', remainingWork: 6, storyPoints: 3 }),
    item({ id: 3, assignedTo: 'Bruno' }),
    item({ id: 4, assignedTo: 'Bruno', state: 'Closed' }),
    item({ id: 5, assignedTo: undefined }),
  ];

  const load = loadByMember(items);

  assert.deepEqual(load[0], { member: 'Ana', open: 2, remainingWork: 10, points: 3 });
  assert.equal(load.find((m) => m.member === 'Bruno')?.open, 1);
  assert.ok(load.some((m) => m.member === '(sem responsável)'));
  assert.deepEqual(countByBucket(items), { todo: 0, doing: 4, done: 1 });
});

test('extrai referências AB# dos commits', () => {
  assert.deepEqual(extractWorkItemIds('fix: limite do cartão AB#123 e ab#45, AB#123'), [123, 45]);
  const commits = parseLog('abc1\x1fAna\x1f2026-10-01T10:00:00-03:00\x1ffeat: novo extrato AB#77\n');
  assert.deepEqual(commits[0], { hash: 'abc1', author: 'Ana', date: '2026-10-01T10:00:00-03:00', subject: 'feat: novo extrato AB#77', workItemIds: [77] });
});

test('interpreta organização e projeto a partir da URL', () => {
  assert.deepEqual(parseAzureInput('https://dev.azure.com/banco-x/Cartoes%20PJ/_boards'), { organization: 'banco-x', project: 'Cartoes PJ' });
  assert.deepEqual(parseAzureInput('banco-x'), { organization: 'banco-x' });
  assert.deepEqual(parseAzureInput('https://bancox.visualstudio.com/Cartoes'), { organization: 'bancox', project: 'Cartoes' });
});

test('limpa HTML dos campos e escapa aspas no WIQL', () => {
  assert.equal(stripHtml('<div>Dado que<br>o cliente &amp; o cartão</div><ul><li>A</li></ul>'), 'Dado que\no cliente & o cartão\n- A');
  assert.equal(stripHtml('<p> </p>'), undefined);
  assert.equal(escapeWiql("Sprint 'X'"), "Sprint ''X''");
});
