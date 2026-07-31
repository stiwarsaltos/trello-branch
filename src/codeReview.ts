import * as vscode from "vscode";
import { ChangeSummary } from "./github";
import { parseCardMeta } from "./cardMeta";
import { ProjectManifest } from "./projectManifest";

export async function openCodeReview(options: {
  cardName: string;
  branchName: string;
  baseBranch: string;
  cardDesc: string;
  summary: ChangeSummary;
  manifest: ProjectManifest;
}) {
  const { cardName, branchName, baseBranch, cardDesc, summary, manifest } = options;
  const meta = parseCardMeta(cardDesc);
  const stackLabel = manifest.kind === "node" ? "Node (package.json)" : "PHP (composer.json)";
  const files = [
    ...summary.staged.map(f => `- (staged) ${f}`),
    ...summary.unstaged.map(f => `- (modificado) ${f}`),
    ...summary.untracked.map(f => `- (nuevo) ${f}`),
  ];

  const markdown = [
    `# Code review — ${cardName}`,
    "",
    `- **Rama:** \`${branchName}\``,
    `- **Base del PR:** \`${baseBranch}\``,
    `- **Proyecto:** ${stackLabel}`,
    meta.modulo && meta.submodulo
      ? `- **Módulo:** ${meta.modulo} → ${meta.submodulo}`
      : "",
    "",
    "## Resumen de archivos",
    "",
    files.length ? files.join("\n") : "_Sin archivos listados_",
    "",
    "## Diff --stat",
    "",
    "```",
    summary.diffStat || "(vacío)",
    "```",
    "",
    "## Diff (vista previa)",
    "",
    "```diff",
    summary.diffPreview || "(sin diff)",
    "```",
    "",
    "---",
    "",
    "Si el review te parece bien, confirma en el diálogo para hacer **commit + push + PR**.",
  ]
    .filter(line => line !== "")
    .join("\n");

  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown,
  });
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}
