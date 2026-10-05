import * as vscode from 'vscode';
import { detectCommands } from '../kit/commands';
import { errorMessage, FenorState } from '../state';
import { resolveVaultPath, SystemDef } from './model';
import { loadSystems } from './store';
import { buildVaultFiles, writeVault } from './vault';

/** Gera ou atualiza o vault (repositório próprio) de um sistema. */
export async function generateVaultCommand(state: FenorState, arg?: string | { system?: SystemDef }): Promise<void> {
  const root = state.roots[0];
  if (!root) {
    vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
    return;
  }
  const data = await loadSystems(root);
  if (!data.sistemas.length) {
    const go = await vscode.window.showInformationMessage('Fenor: nenhum sistema configurado ainda.', 'Configurar sistemas');
    if (go) {
      await vscode.commands.executeCommand('fenor.systems.configure');
    }
    return;
  }
  const wanted = typeof arg === 'string' ? arg : arg?.system?.id;
  const system = data.sistemas.find((s) => s.id === wanted) ?? (await vscode.window.showQuickPick(
    data.sistemas.map((s) => ({ label: s.name, description: `${s.components.length} componente(s)`, system: s })),
    { title: 'Gerar o vault de qual sistema?' },
  ))?.system;
  if (!system) {
    return;
  }
  try {
    if (!state.projects.length) {
      await state.refreshProjects();
    }
    const comps = await Promise.all(system.components.map(async (component) => {
      const project = state.projects.find((p) => p.relPath === component.project);
      return { component, project, commands: project ? await detectCommands(project) : undefined };
    }));
    const vaultPath = resolveVaultPath(root, system);
    const result = await writeVault(vaultPath, system, buildVaultFiles(system, comps, new Date()));
    const choice = await vscode.window.showInformationMessage(
      `Fenor: vault de ${system.name} ${result.written ? `atualizado (${result.written} nota(s))` : 'já estava em dia'}${result.createdRepo ? ' — repositório git criado' : ''}.`,
      'Abrir nota do sistema', 'Abrir pasta em nova janela',
    );
    if (choice === 'Abrir nota do sistema') {
      await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(vscode.Uri.file(vaultPath), `${system.name}.md`));
    } else if (choice === 'Abrir pasta em nova janela') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(vaultPath), { forceNewWindow: true });
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao gerar o vault — ${errorMessage(err)}`);
  }
}
