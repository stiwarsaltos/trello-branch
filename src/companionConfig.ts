import * as path from "path";
import * as vscode from "vscode";

const COMPANION_BY_REPO_KEY = "trelloBranch.companionByRepo";

type CompanionMap = Record<string, string>;

function normalizeRoot(repoRoot: string) {
  return path.resolve(repoRoot);
}

function readMap(globalState: vscode.Memento): CompanionMap {
  return globalState.get<CompanionMap>(COMPANION_BY_REPO_KEY) ?? {};
}

/** Ruta del companion configurada para este repo (solo en esta máquina). */
export function getCompanionPath(
  globalState: vscode.Memento,
  currentRepoRoot: string
): string | undefined {
  const map = readMap(globalState);
  const pathForRepo = map[normalizeRoot(currentRepoRoot)];
  return pathForRepo?.trim() || undefined;
}

export async function setCompanionPath(
  globalState: vscode.Memento,
  currentRepoRoot: string,
  companionPath: string
) {
  const map = readMap(globalState);
  map[normalizeRoot(currentRepoRoot)] = path.resolve(companionPath);
  await globalState.update(COMPANION_BY_REPO_KEY, map);
}

export async function clearCompanionPath(
  globalState: vscode.Memento,
  currentRepoRoot: string
) {
  const map = readMap(globalState);
  delete map[normalizeRoot(currentRepoRoot)];
  await globalState.update(COMPANION_BY_REPO_KEY, map);
}

/** Elige carpeta del otro repo y la asocia al repo abierto en esta ventana. */
export async function pickAndSaveCompanionPath(
  globalState: vscode.Memento,
  currentRepoRoot: string
): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Elegir repo companion",
    title: "Ruta del otro repo (API o cliente)",
  });
  if (!picked?.[0]) {
    return undefined;
  }

  const companionPath = picked[0].fsPath;
  if (path.resolve(companionPath) === path.resolve(currentRepoRoot)) {
    vscode.window.showErrorMessage(
      "El companion no puede ser el mismo repo que esta ventana."
    );
    return undefined;
  }

  await setCompanionPath(globalState, currentRepoRoot, companionPath);
  return companionPath;
}
