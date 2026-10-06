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

const ACTIVE_TASKS_KEY = "trelloBranch.activeTasks";
const LEGACY_ACTIVE_TASK_KEY = "trelloBranch.activeTask";

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

function isActiveTask(value: unknown): value is ActiveTask {
  if (!value || typeof value !== "object") {
    return false;
  }
  const task = value as ActiveTask;
  return Boolean(task.cardId) && Array.isArray(task.repos);
}

function fromLegacyWorkspace(legacy: LegacyActiveTask): ActiveTask {
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

export function uniqueBranchName(desired: string, tasks: ActiveTask[], cardId?: string) {
  const taken = new Set(
    tasks
      .filter(task => task.cardId !== cardId)
      .map(task => task.branchName)
  );
  if (!taken.has(desired)) {
    return desired;
  }
  let index = 2;
  while (taken.has(`${desired}-${index}`)) {
    index += 1;
  }
  return `${desired}-${index}`;
}

export function getActiveTasks(
  globalState: vscode.Memento,
  workspaceState?: vscode.Memento
): ActiveTask[] {
  const listed = globalState.get<ActiveTask[]>(ACTIVE_TASKS_KEY);
  if (Array.isArray(listed)) {
    return listed.filter(isActiveTask);
  }

  const current = globalState.get<ActiveTask>(LEGACY_ACTIVE_TASK_KEY);
  if (isActiveTask(current)) {
    return [current];
  }

  const legacy = workspaceState?.get<LegacyActiveTask>(LEGACY_ACTIVE_TASK_KEY);
  if (!legacy?.repoRoot) {
    return [];
  }
  return [fromLegacyWorkspace(legacy)];
}

export function findActiveTask(
  globalState: vscode.Memento,
  workspaceState: vscode.Memento | undefined,
  cardId: string
) {
  return getActiveTasks(globalState, workspaceState).find(task => task.cardId === cardId);
}

/** Una sola tarea, o la indicada por cardId. Si hay varias y no hay cardId, undefined. */
export function getActiveTask(
  globalState: vscode.Memento,
  workspaceState?: vscode.Memento,
  cardId?: string
): ActiveTask | undefined {
  const tasks = getActiveTasks(globalState, workspaceState);
  if (cardId) {
    return tasks.find(task => task.cardId === cardId);
  }
  if (tasks.length === 1) {
    return tasks[0];
  }
  return undefined;
}

export async function saveActiveTask(
  globalState: vscode.Memento,
  task: ActiveTask,
  workspaceState?: vscode.Memento
) {
  const tasks = getActiveTasks(globalState, workspaceState);
  const index = tasks.findIndex(item => item.cardId === task.cardId);
  const next =
    index >= 0
      ? tasks.map((item, i) => (i === index ? task : item))
      : [...tasks, task];
  await persistTasks(globalState, workspaceState, next);
}

async function persistTasks(
  globalState: vscode.Memento,
  workspaceState: vscode.Memento | undefined,
  tasks: ActiveTask[]
) {
  await globalState.update(ACTIVE_TASKS_KEY, tasks);
  await globalState.update(LEGACY_ACTIVE_TASK_KEY, undefined);
  if (workspaceState) {
    await workspaceState.update(LEGACY_ACTIVE_TASK_KEY, undefined);
  }
}

export async function removeActiveTask(
  globalState: vscode.Memento,
  workspaceState: vscode.Memento | undefined,
  cardId: string
) {
  const next = getActiveTasks(globalState, workspaceState).filter(
    task => task.cardId !== cardId
  );
  await persistTasks(globalState, workspaceState, next);
}

export async function clearActiveTask(
  globalState: vscode.Memento,
  workspaceState?: vscode.Memento
) {
  await persistTasks(globalState, workspaceState, []);
}

export async function updateActiveRepo(
  globalState: vscode.Memento,
  task: ActiveTask,
  repoRoot: string,
  patch: Partial<Pick<ActiveRepo, "status" | "prUrl">>,
  workspaceState?: vscode.Memento
) {
  const repos = task.repos.map(r =>
    sameRepoRoot(r.root, repoRoot) ? { ...r, ...patch } : r
  );
  const next = { ...task, repos };
  await saveActiveTask(globalState, next, workspaceState);
  return next;
}
