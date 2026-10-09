import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { clean, scanRoot } from '../src/portfolio/scanner';

const POM = `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.5</version></parent>
  <artifactId>api-cartoes</artifactId>
  <version>1.4.0</version>
  <properties><java.version>17</java.version></properties>
  <dependencies><dependency><artifactId>lombok</artifactId><version>9.9</version></dependency></dependencies>
</project>`;

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-scan-'));
  await write(root, 'cartoes/api/pom.xml', POM);
  await write(root, 'cartoes/api/src/test/java/CartaoServiceTest.java', 'class A {}');
  await write(root, 'cartoes/api/src/test/java/CartaoIT.java', 'class B {}');
  await write(root, 'cartoes/web/package.json', JSON.stringify({ name: 'web-cartoes', version: '0.3.0', dependencies: { react: '^18.2.0' }, devDependencies: { vite: '^5.1.0' } }));
  await write(root, 'cartoes/web/src/App.test.tsx', '');
  await write(root, 'cartoes/web/node_modules/lib/package.json', JSON.stringify({ dependencies: { react: '18' } }));
  await write(root, 'backoffice/composer.json', JSON.stringify({ name: 'banco/backoffice', require: { php: '>=8.2', 'symfony/framework-bundle': '6.4.*' } }));
  await write(root, 'backoffice/tests/ClienteTest.php', '<?php');
  await write(root, 'backoffice/vendor/x/composer.json', JSON.stringify({ require: { 'symfony/framework-bundle': '6' } }));
  await write(root, 'ferramenta/package.json', JSON.stringify({ name: 'cli', dependencies: { chalk: '5' } }));
  await write(root, 'docs-soltos/README.md', '# só um readme');
  return root;
}

test('encontra só projetos Java e React e ignora node_modules e outras stacks', async () => {
  const root = await makeWorkspace();

  const projects = await scanRoot(root);

  assert.deepEqual(projects.map((p) => [p.stack, p.name]), [
    ['java', 'api-cartoes'],
    ['react', 'web'],
  ]);
});

test('extrai versões do pom sem confundir com parent e dependências', async () => {
  const root = await makeWorkspace();

  const java = (await scanRoot(root)).find((p) => p.stack === 'java');

  assert.equal(java?.version, '1.4.0');
  assert.equal(java?.runtime, 'Java 17');
  assert.equal(java?.framework, 'Spring Boot 3.2.5');
  assert.equal(java?.relPath, path.join('cartoes', 'api'));
});

test('conta arquivos de teste por convenção de cada stack', async () => {
  const root = await makeWorkspace();

  const byStack = Object.fromEntries((await scanRoot(root)).map((p) => [p.stack, p]));

  assert.equal(byStack.java.testCount, 2);
  assert.equal(byStack.react.testCount, 1);

  assert.equal(byStack.react.framework, 'Vite 5.1.0');

});

test('respeita a profundidade máxima', async () => {
  const root = await makeWorkspace();

  const projects = await scanRoot(root, 1);

  assert.deepEqual(projects.map((p) => p.name), []);
  assert.deepEqual((await scanRoot(root, 2)).map((p) => p.name).sort(), ['api-cartoes', 'web']);
});

test('clean remove prefixos de semver', () => {
  assert.equal(clean('^18.2.0'), '18.2.0');
  assert.equal(clean('>=8.2'), '8.2');
  assert.equal(clean('~7.4 || ^8.0'), '7.4');
  assert.equal(clean(undefined), '');
});

test('multi-módulo Maven não conta os testes dos submódulos duas vezes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fenor-multi-'));
  await write(root, 'pom.xml', '<project><artifactId>pai</artifactId></project>');
  await write(root, 'modulo-a/pom.xml', '<project><artifactId>modulo-a</artifactId></project>');
  await write(root, 'modulo-a/src/test/java/ATest.java', '');
  await write(root, 'src/test/java/RaizTest.java', '');

  const counts = Object.fromEntries((await scanRoot(root)).map((p) => [p.name, p.testCount]));

  assert.deepEqual(counts, { pai: 1, 'modulo-a': 1 });
});

