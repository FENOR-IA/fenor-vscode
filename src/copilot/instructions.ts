import { promises as fs } from 'fs';
import * as path from 'path';
import { slug } from '../systems/model';

/**
 * O Copilot só lê instruções da raiz do workspace. Com a pasta-mãe aberta (vários repositórios),
 * o .github/copilot-instructions.md de cada projeto é ignorado. Por isso o Fenor gera, na raiz,
 * um .github/instructions/fenor-<projeto>.instructions.md com applyTo no caminho do projeto:
 * ao editar qualquer arquivo daquele projeto, o Copilot aplica as regras dele.
 */

export const TOOLS_SECTION = `### Ferramentas do Fenor (Copilot, modo agente)
- Ao começar qualquer tarefa: chame **#fenor_contexto** (memória do projeto: sessão anterior, próximo passo, armadilhas, regras de negócio).
- Antes de dizer que terminou: chame **#fenor_verificar**. Se falhar, corrija e chame de novo. Nunca conclua com falha.
- Ao encerrar: chame **#fenor_salvar_sessao** com o que foi feito, o próximo passo e os aprendizados.
`;

export function rootInstructionFile(relPath: string, name: string, agentsBlock: string): { relPath: string; content: string } {
  const isRoot = relPath === '.' || relPath === '';
  const applyTo = isRoot ? '**' : `${relPath.split(path.sep).join('/')}/**`;
  const note = isRoot ? '' : `> Projeto em \`${relPath}/\` — todos os caminhos abaixo são relativos a essa pasta. Ao chamar as ferramentas do Fenor, use \`projeto: "${relPath}"\`.\n\n`;
  return {
    relPath: `.github/instructions/fenor-${slug(isRoot ? name : relPath) || 'projeto'}.instructions.md`,
    content: `---\napplyTo: '${applyTo}'\ndescription: 'Método Fenor — ${name.replace(/'/g, "''")}'\n---\n\n${note}${agentsBlock.trim()}\n`,
  };
}

/** Grava (ou atualiza) as instruções na raiz do workspace. Retorna quantos arquivos mudaram. */
export async function writeRootInstructions(root: string, files: ReadonlyArray<{ relPath: string; content: string }>): Promise<number> {
  let changed = 0;
  for (const f of files) {
    const target = path.join(root, f.relPath);
    const current = await fs.readFile(target, 'utf8').catch(() => undefined);
    if (current !== f.content) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, f.content, 'utf8');
      changed++;
    }
  }
  return changed;
}
