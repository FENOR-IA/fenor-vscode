import { promises as fs } from 'fs';
import * as path from 'path';

export type Stack = 'java' | 'react';

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
};

const MAX_FILES_COUNTED = 20000;

export async function scanRoot(root: string, maxDepth = 4): Promise<Project[]> {
  const found: Project[] = [];
  await walk(root, root, 0, maxDepth, found);
  return found.sort((a, b) => a.stack.localeCompare(b.stack) || a.name.localeCompare(b.name));
}

async function walk(root: string, dir: string, depth: number, maxDepth: number, found: Project[]): Promise<void> {
  const entries = await readDirSafe(dir);
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const projects = await detectProjects(root, dir, names);
  found.push(...projects);

  if (depth >= maxDepth) {
    return;
  }
  const subdirs = entries.filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));
  await Promise.all(subdirs.map((d) => walk(root, path.join(dir, d.name), depth + 1, maxDepth, found)));
}

export async function detectProjects(root: string, dir: string, files: Set<string>): Promise<Project[]> {
  const results = await Promise.all([detectJava(dir, files), detectReact(dir, files)]);
  const projects = results.filter((p): p is NonNullable<Detected> => p !== null);
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const BUILD_FILES: Record<Stack, string[]> = {
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  react: ['package.json'],
};

/** Conta arquivos de teste do projeto, sem entrar em submódulos que têm build próprio (contados à parte). */
export async function countTests(dir: string, stack: Stack): Promise<number> {
  const pattern = TEST_PATTERNS[stack];
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
