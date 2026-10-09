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

const DEFAULT_PORT: Record<string, number> = { java: 8080, react: 5173 };

export async function detectCommands(project: Pick<Project, 'path' | 'stack' | 'framework'>): Promise<ProjectCommands> {
  const has = (f: string) => exists(path.join(project.path, f));
  return project.stack === 'java' ? javaCommands(has) : nodeCommands(project, has);
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
    port: isVite ? 5173 : /next/i.test(project.framework ?? '') || /react-scripts/.test(scripts.start ?? '') ? 3000 : DEFAULT_PORT[project.stack],
  };
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
