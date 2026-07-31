import * as vscode from "vscode";

export type ActiveTask = {
  cardId: string;
  cardName: string;
  cardDesc: string;
  branchName: string;
  repoRoot: string;
  startedAt: string;
};

const ACTIVE_TASK_KEY = "trelloBranch.activeTask";

export async function saveActiveTask(
  state: vscode.Memento,
  task: ActiveTask
) {
  await state.update(ACTIVE_TASK_KEY, task);
}

export function getActiveTask(state: vscode.Memento) {
  return state.get<ActiveTask>(ACTIVE_TASK_KEY);
}

export async function clearActiveTask(state: vscode.Memento) {
  await state.update(ACTIVE_TASK_KEY, undefined);
}
