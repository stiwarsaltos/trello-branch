import * as path from "path";
import * as vscode from "vscode";

export type ActiveRepoStatus = "pending" | "done" | "skipped";

export type ActiveRepo = {
  root: string;
  label: string;
  status: ActiveRepoStatus;
  prUrl?: string;
};

export type ActiveTask = {
  cardId: string;
  cardName: string;
  cardDesc: string;
  branchName: string;
  originListId?: string;
  cardRuc?: string;
  repos: ActiveRepo[];
  startedAt: string;
};

/** Shape antiguo (un solo repo en workspaceState). */
type LegacyActiveTask = {
  cardId: string;
  cardName: string;
  cardDesc: string;
  branchName: string;
  repoRoot: string;
  startedAt: string;
};

const ACTIVE_TASK_KEY = "trelloBranch.activeTask";

export function repoLabel(repoRoot: string) {
  return path.basename(repoRoot);
}

export function sameRepoRoot(a: string, b: string) {
  return path.resolve(a) === path.resolve(b);
}

export function findActiveRepo(task: ActiveTask, repoRoot: string) {
  return task.repos.find(r => sameRepoRoot(r.root, repoRoot));
}

export function allReposClosed(task: ActiveTask) {
  return task.repos.every(r => r.status === "done" || r.status === "skipped");
}

export function pendingRepoLabels(task: ActiveTask) {
  return task.repos
    .filter(r => r.status === "pending")
    .map(r => r.label);
}

export async function saveActiveTask(
  globalState: vscode.Memento,
  task: ActiveTask
) {
  await globalState.update(ACTIVE_TASK_KEY, task);
}

export function getActiveTask(
  globalState: vscode.Memento,
  workspaceState?: vscode.Memento
): ActiveTask | undefined {
  const current = globalState.get<ActiveTask>(ACTIVE_TASK_KEY);
  if (current?.cardId && Array.isArray(current.repos)) {
    return current;
  }

  const legacy = workspaceState?.get<LegacyActiveTask>(ACTIVE_TASK_KEY);
  if (!legacy?.repoRoot) {
    return undefined;
  }

  return {
    cardId: legacy.cardId,
    cardName: legacy.cardName,
    cardDesc: legacy.cardDesc,
    branchName: legacy.branchName,
    startedAt: legacy.startedAt,
    repos: [
      {
        root: legacy.repoRoot,
        label: repoLabel(legacy.repoRoot),
        status: "pending",
      },
    ],
  };
}

export async function clearActiveTask(
  globalState: vscode.Memento,
  workspaceState?: vscode.Memento
) {
  await globalState.update(ACTIVE_TASK_KEY, undefined);
  if (workspaceState) {
    await workspaceState.update(ACTIVE_TASK_KEY, undefined);
  }
}

export async function updateActiveRepo(
  globalState: vscode.Memento,
  task: ActiveTask,
  repoRoot: string,
  patch: Partial<Pick<ActiveRepo, "status" | "prUrl">>
) {
  const repos = task.repos.map(r =>
    sameRepoRoot(r.root, repoRoot) ? { ...r, ...patch } : r
  );
  const next = { ...task, repos };
  await saveActiveTask(globalState, next);
  return next;
}
