import { promises as fs } from 'fs';
import * as path from 'path';

export type Stack = 'java' | 'react' | 'node' | 'php' | 'python' | 'outro';

export interface Project {
  name: string;
  path: string;
  relPath: string;
  stack: Stack;
  buildFile: string;
  version?: string;
  runtime?: string;
  framework?: string;
  description?: string;
  testCount: number;
}

const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', 'target', 'build', 'dist', 'out', '.git', '.idea',
  '.vscode', '.gradle', '.next', 'coverage', 'var', '.fenor',
  // Bibliotecas de terceiros copiadas para dentro do projeto.
  'assets', 'static', 'lib', 'libs', 'plugins', 'bower_components', 'third_party',
]);

const TEST_PATTERNS: Record<Stack, RegExp> = {
  java: /(Test|Tests|IT)\.(java|kt)$/,
  react: /\.(test|spec)\.(t|j)sx?$/,
  node: /\.(test|spec)\.(t|j)sx?$/,
  php: /Test\.php$/,
  python: /^test_.*\.py$|_test\.py$/,
  outro: /^$/,
};

/** Arquivos que marcam um projeto sem stack reconhecida (repositório, app Fenor, instruções de IA). */
const PROJECT_MARKERS = ['CLAUDE.md', 'AGENTS.md', 'fenor.json'];

const MAX_FILES_COUNTED = 20000;

export async function scanRoot(root: string, maxDepth = 4): Promise<Project[]> {
  const found: Project[] = [];
  await walk(root, root, 0, maxDepth, found);
  return found.sort((a, b) => a.stack.localeCompare(b.stack) || a.name.localeCompare(b.name));
}

async function walk(root: string, dir: string, depth: number, maxDepth: number, found: Project[], insideProject = false): Promise<void> {
  const entries = await readDirSafe(dir);
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const hasGit = entries.some((e) => e.name === '.git');
  // Dentro de um projeto, subpasta só vira projeto próprio com manifesto forte (não basta um index.php).
  const projects = await detectProjects(root, dir, names, hasGit, insideProject);
  found.push(...projects);

  if (depth >= maxDepth) {
    return;
  }
  const subdirs = entries.filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));
  const nowInside = insideProject || projects.length > 0;
  await Promise.all(subdirs.map((d) => walk(root, path.join(dir, d.name), depth + 1, maxDepth, found, nowInside)));
}

export async function detectProjects(root: string, dir: string, files: Set<string>, hasGit = false, strongOnly = false): Promise<Project[]> {
  const isMarked = hasGit || PROJECT_MARKERS.some((m) => files.has(m));
  const detectors = [detectJava, detectReact, detectPhp, detectPython, detectNode];
  const results = await Promise.all(detectors.map((detect) => detect(dir, files, strongOnly && !isMarked)));
  let projects = results.filter((p): p is NonNullable<Detected> => p !== null);
  // package.json num projeto Java/PHP costuma ser só ferramenta de build do front.
  if (projects.some((p) => p.stack === 'java' || p.stack === 'php')) {
    projects = projects.filter((p) => p.stack !== 'node');
  }
  if (!projects.length && isMarked && (dir !== root || hasGit)) {
    projects = [{ name: path.basename(dir), path: dir, stack: 'outro', buildFile: markerFile(files) }];
  }
  return Promise.all(projects.map(async (p) => ({
    ...p,
    relPath: path.relative(root, dir) || '.',
    testCount: await countTests(dir, p.stack),
  })));
}

type Detected = Omit<Project, 'testCount' | 'relPath'> | null;

async function detectJava(dir: string, files: Set<string>): Promise<Detected> {
  const buildFile = ['pom.xml', 'build.gradle.kts', 'build.gradle'].find((f) => files.has(f));
  if (!buildFile) {
    return null;
  }
  const content = await readSafe(path.join(dir, buildFile));
  if (buildFile === 'pom.xml') {
    return {
      name: projectTag(content, /<artifactId>([^<]+)<\/artifactId>/) ?? path.basename(dir),
      path: dir,
      stack: 'java',
      buildFile,
      version: projectTag(content, /<version>([^<]+)<\/version>/),
      runtime: javaVersionFromPom(content),
      framework: springBootVersion(content),
    };
  }
  const bootVersion = /org\.springframework\.boot['"]?\)?\s*version\s*['"]([^'"]+)['"]/.exec(content)?.[1];
  const javaVersion = /JavaVersion\.VERSION_(\d+)/.exec(content)?.[1]
    ?? /languageVersion\s*(?:=|\.set\()\s*JavaLanguageVersion\.of\((\d+)\)/.exec(content)?.[1];
  return {
    name: path.basename(dir),
    path: dir,
    stack: 'java',
    buildFile,
    runtime: javaVersion ? `Java ${javaVersion}` : undefined,
    framework: bootVersion ? `Spring Boot ${bootVersion}` : undefined,
  };
}

function javaVersionFromPom(content: string): string | undefined {
  const v = /<java\.version>([^<]+)</.exec(content)?.[1]
    ?? /<maven\.compiler\.(?:release|source)>([^<]+)</.exec(content)?.[1];
  return v ? `Java ${v}` : undefined;
}

function springBootVersion(content: string): string | undefined {
  const parent = /<parent>[\s\S]*?<\/parent>/.exec(content)?.[0] ?? '';
  if (parent.includes('spring-boot-starter-parent')) {
    const v = /<version>([^<]+)<\/version>/.exec(parent)?.[1];
    return v ? `Spring Boot ${v}` : 'Spring Boot';
  }
  return content.includes('spring-boot') ? 'Spring Boot' : undefined;
}

async function detectReact(dir: string, files: Set<string>): Promise<Detected> {
  if (!files.has('package.json')) {
    return null;
  }
  const pkg = parseJson(await readSafe(path.join(dir, 'package.json')));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  if (!deps.react) {
    return null;
  }
  const framework = deps.next ? `Next ${clean(deps.next)}`
    : deps.vite ? `Vite ${clean(deps.vite)}`
    : deps['react-scripts'] ? 'Create React App'
    : undefined;
  return {
    name: path.basename(dir),
    path: dir,
    stack: 'react',
    description: str(pkg?.description),
    buildFile: 'package.json',
    version: typeof pkg?.version === 'string' ? pkg.version : undefined,
    runtime: `React ${clean(deps.react)}`,
    framework,
  };
}

const PHP_FRAMEWORKS: Array<[string, string]> = [
  ['symfony/framework-bundle', 'Symfony'],
  ['symfony/http-kernel', 'Symfony'],
  ['laravel/framework', 'Laravel'],
  ['slim/slim', 'Slim'],
  ['codeigniter4/framework', 'CodeIgniter'],
];

async function detectPhp(dir: string, files: Set<string>, strongOnly = false): Promise<Detected> {
  const hasComposer = files.has('composer.json');
  const hasFenor = files.has('fenor.json');
  const weakOnly = !hasComposer && !hasFenor;
  if (weakOnly && (strongOnly || (!files.has('index.php') && !files.has('artisan')))) {
    return null;
  }
  const composer = hasComposer ? parseJson(await readSafe(path.join(dir, 'composer.json'))) : null;
  if (strongOnly && !hasFenor && composer?.type === 'library') {
    return null; // biblioteca copiada para dentro de outro projeto
  }
  const fenor = hasFenor ? parseJson(await readSafe(path.join(dir, 'fenor.json'))) : null;
  const req = { ...(composer?.require ?? {}), ...(composer?.['require-dev'] ?? {}) } as Record<string, string>;
  const fw = PHP_FRAMEWORKS.find(([pkg]) => req[pkg]);
  // Nome da pasta: o "name" de fenor.json/composer.json costuma vir do template (ex.: "crm").
  return {
    name: path.basename(dir),
    path: dir,
    stack: 'php',
    buildFile: hasComposer ? 'composer.json' : hasFenor ? 'fenor.json' : files.has('index.php') ? 'index.php' : 'artisan',
    version: str(fenor?.version) ?? str(composer?.version),
    runtime: req.php ? `PHP ${clean(req.php)}` : 'PHP',
    framework: fw ? `${fw[1]} ${clean(req[fw[0]])}` : hasFenor ? 'App Fenor' : undefined,
    description: str(fenor?.description) ?? str(composer?.description),
  };
}

async function detectNode(dir: string, files: Set<string>, strongOnly = false): Promise<Detected> {
  // Dentro de outro projeto, package.json sem react costuma ser script/ferramenta, não projeto.
  if (!files.has('package.json') || strongOnly) {
    return null;
  }
  const pkg = parseJson(await readSafe(path.join(dir, 'package.json')));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  if (deps.react) {
    return null;
  }
  const fw = ['@nestjs/core', 'express', 'fastify', 'vue', '@angular/core', 'svelte'].find((d) => deps[d]);
  return {
    name: path.basename(dir),
    path: dir,
    stack: 'node',
    buildFile: 'package.json',
    version: str(pkg?.version),
    runtime: 'Node',
    framework: fw ? `${fw.replace('@', '').replace('/core', '')} ${clean(deps[fw])}` : undefined,
    description: str(pkg?.description),
  };
}

async function detectPython(dir: string, files: Set<string>): Promise<Detected> {
  const buildFile = ['pyproject.toml', 'requirements.txt', 'manage.py', 'setup.py'].find((f) => files.has(f));
  if (!buildFile) {
    return null;
  }
  const content = await readSafe(path.join(dir, buildFile));
  const fw = /django/i.test(content) || files.has('manage.py') ? 'Django' : /fastapi/i.test(content) ? 'FastAPI' : /flask/i.test(content) ? 'Flask' : undefined;
  return { name: path.basename(dir), path: dir, stack: 'python', buildFile, runtime: 'Python', framework: fw };
}

function markerFile(files: Set<string>): string {
  return [...PROJECT_MARKERS, 'README.md'].find((m) => files.has(m)) ?? '.';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const BUILD_FILES: Record<Stack, string[]> = {
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  react: ['package.json'],
  node: ['package.json'],
  php: ['composer.json', 'fenor.json'],
  python: ['pyproject.toml', 'requirements.txt'],
  outro: [],
};

/** Conta arquivos de teste do projeto, sem entrar em submódulos que têm build próprio (contados à parte). */
export async function countTests(dir: string, stack: Stack): Promise<number> {
  const pattern = TEST_PATTERNS[stack];
  if (stack === 'outro') {
    return 0;
  }
  let count = 0;
  let visited = 0;
  const pending = [dir];
  while (pending.length > 0 && visited < MAX_FILES_COUNTED) {
    const current = pending.pop() as string;
    const entries = await readDirSafe(current);
    if (current !== dir && entries.some((e) => e.isFile() && BUILD_FILES[stack].includes(e.name))) {
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          pending.push(path.join(current, entry.name));
        }
      } else if (pattern.test(entry.name)) {
        count++;
      }
    }
  }
  return count;
}

/** Remove prefixos de semver (^, ~, >=) para exibição. */
export function clean(version: string | undefined): string {
  return (version ?? '').replace(/^[\^~>=<\s]+/, '').split(/\s|\|/)[0];
}

/** Tag do próprio projeto no pom.xml, ignorando <parent>, dependências, build e profiles. */
function projectTag(content: string, re: RegExp): string | undefined {
  const stripped = content
    .replace(/<parent>[\s\S]*?<\/parent>/g, '')
    .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
    .replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '')
    .replace(/<build>[\s\S]*?<\/build>/g, '')
    .replace(/<profiles>[\s\S]*?<\/profiles>/g, '');
  return re.exec(stripped)?.[1];
}

async function readDirSafe(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readSafe(file: string): Promise<string> {
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
