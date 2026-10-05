import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { renderSituationReport } from './portfolio/report';
import { errorMessage, FenorState } from './state';

/** Gera .fenor/situacao.md na raiz do workspace e abre a pré-visualização. */
export async function writeSituationReport(state: FenorState): Promise<void> {
  const root = state.roots[0];
  if (!root) {
    vscode.window.showWarningMessage('Fenor: abra uma pasta primeiro.');
    return;
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Fenor: lendo projetos e documentos…' },
      () => state.refreshProjects(),
    );
    const dir = path.join(root, '.fenor');
    const file = path.join(dir, 'situacao.md');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, renderSituationReport(state.projects, new Date(), dir), 'utf8');
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
  } catch (err) {
    vscode.window.showErrorMessage(`Fenor: erro ao gerar o relatório — ${errorMessage(err)}`);
  }
}
