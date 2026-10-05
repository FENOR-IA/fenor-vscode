import { promises as fs } from 'fs';
import * as path from 'path';
import { Project } from '../portfolio/scanner';

/** Comandos reais de cada projeto — usados no kit (verificação) e para rodar localmente. */
export interface ProjectCommands {
  run?: string;
  test?: string;
  build?: string;
  lint?: string;
  /** Porta padrão em que o sistema sobe localmente, quando conhecida. */
  port?: number;
}

const DEFAULT_PORT: Record<string, number> = { java: 8080, react: 5173, node: 3000, php: 8000, python: 8000 };

export async function detectCommands(project: Pick<Project, 'path' | 'stack' | 'framework'>): Promise<ProjectCommands> {
  const has = (f: string) => exists(path.join(project.path, f));
  switch (project.stack) {
    case 'java':
      return javaCommands(has);
    case 'react':
    case 'node':
      return nodeCommands(project, has);
    case 'php':
      return phpCommands(project, has);
    case 'python':
      return pythonCommands(has);
    default:
      return (await has('docker-compose.yml')) || (await has('compose.yaml')) ? { run: 'docker compose up' } : {};
  }
}

async function javaCommands(has: (f: string) => Promise<boolean>): Promise<ProjectCommands> {
  if (await has('pom.xml')) {
    const mvn = (await has('mvnw')) ? './mvnw' : 'mvn';
    return { run: `${mvn} spring-boot:run`, test: `${mvn} test`, build: `${mvn} -q verify`, port: DEFAULT_PORT.java };
  }
  const gradle = (await has('gradlew')) ? './gradlew' : 'gradle';
  return { run: `${gradle} bootRun`, test: `${gradle} test`, build: `${gradle} build`, port: DEFAULT_PORT.java };
}

async function nodeCommands(project: Pick<Project, 'path' | 'stack' | 'framework'>, has: (f: string) => Promise<boolean>): Promise<ProjectCommands> {
  const pkg = parseJson(await read(path.join(project.path, 'package.json')));
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const pm = (await has('pnpm-lock.yaml')) ? 'pnpm' : (await has('yarn.lock')) ? 'yarn' : 'npm';
  const script = (name: string) => (scripts[name] ? (pm === 'npm' && !['test', 'start'].includes(name) ? `npm run ${name}` : `${pm} ${name}`) : undefined);
  const isVite = /vite/i.test(project.framework ?? '') || /vite/.test(scripts.dev ?? '');
  const test = scripts.test && !/no test specified/.test(scripts.test)
    ? (/vitest/.test(scripts.test) && !/run/.test(scripts.test) ? `${script('test')} -- --run` : script('test'))
    : undefined;
  return {
    run: script('dev') ?? script('start') ?? script('serve'),
    test,
    build: script('build'),
    lint: script('lint'),
    port: isVite ? 5173 : /next/i.test(project.framework ?? '') ? 3000 : DEFAULT_PORT[project.stack],
  };
}

async function phpCommands(project: Pick<Project, 'path' | 'stack' | 'framework'>, has: (f: string) => Promise<boolean>): Promise<ProjectCommands> {
  const fw = project.framework ?? '';
  const port = DEFAULT_PORT.php;
  const phpunit = (await has('bin/phpunit')) ? 'php bin/phpunit' : (await has('vendor/bin/phpunit')) || (await has('phpunit.xml')) || (await has('phpunit.xml.dist')) ? 'vendor/bin/phpunit' : undefined;
  const lint = 'find . -name "*.php" -not -path "./vendor/*" -print0 | xargs -0 -n1 php -l';
  if (/Symfony/.test(fw)) {
    return { run: `php -S localhost:${port} -t public`, test: phpunit, lint: 'php bin/console lint:container', port };
  }
  if (/Laravel/.test(fw)) {
    return { run: `php artisan serve --port=${port}`, test: 'php artisan test', lint, port };
  }
  if (/App Fenor/.test(fw) || (await has('front/index.php'))) {
    return { run: `php -S localhost:${port} -t front front/index.php`, test: phpunit, lint, port };
  }
  const docroot = (await has('public/index.php')) ? 'public' : '.';
  return { run: `php -S localhost:${port} -t ${docroot}`, test: phpunit, lint, port };
}

async function pythonCommands(has: (f: string) => Promise<boolean>): Promise<ProjectCommands> {
  if (await has('manage.py')) {
    return { run: 'python manage.py runserver', test: 'python manage.py test', port: 8000 };
  }
  return { test: 'pytest', port: DEFAULT_PORT.python };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function read(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
