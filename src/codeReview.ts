import * as vscode from "vscode";
import {
  CodeReviewRunner,
  resolveCodeReviewRunner,
} from "./projectManifest";

export type CodeReviewResult = {
  runner: CodeReviewRunner;
  exitCode: number | undefined;
  ok: boolean;
};

/** Ejecuta el code-review del proyecto en la terminal integrada. */
export async function runProjectCodeReview(
  repoPath: string
): Promise<CodeReviewResult> {
  const runner = await resolveCodeReviewRunner(repoPath);
  if (!runner) {
    throw new Error(
      'No se encontró el script "code-review" en package.json ni en composer.json.'
    );
  }

  let result = await executeReviewTask(repoPath, runner);

  // Fallos transitorios de la API (p. ej. Premature close de Anthropic).
  if (!result.ok) {
    const retry = await vscode.window.showWarningMessage(
      `Code review falló (${runner.label}, exit ${result.exitCode ?? "?"}). ` +
        `Si ves "Premature close" u otro error de red/API, suele ser temporal.`,
      "Reintentar",
      "Cancelar"
    );
    if (retry === "Reintentar") {
      result = await executeReviewTask(repoPath, runner);
    }
  }

  return result;
}

async function executeReviewTask(
  repoPath: string,
  runner: CodeReviewRunner
): Promise<CodeReviewResult> {
  const task = new vscode.Task(
    { type: "trelloBranch", task: "code-review" },
    vscode.TaskScope.Workspace,
    `Code review — ${runner.label}`,
    "Trello Branch",
    new vscode.ShellExecution(runner.shellCommand, { cwd: repoPath })
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    focus: true,
    clear: true,
  };

  const execution = await vscode.tasks.executeTask(task);
  const exitCode = await waitForTaskExit(execution);

  return {
    runner,
    exitCode,
    ok: exitCode === 0,
  };
}

function waitForTaskExit(
  execution: vscode.TaskExecution
): Promise<number | undefined> {
  return new Promise(resolve => {
    const sub = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution !== execution) {
        return;
      }
      sub.dispose();
      resolve(event.exitCode);
    });
  });
}
