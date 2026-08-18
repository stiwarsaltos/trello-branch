import * as fs from "fs/promises";
import * as path from "path";

export type CodeReviewRunner = {
  kind: "node" | "php";
  manifest: "package.json" | "composer.json";
  /** Comando a ejecutar en shell (ya listo para la terminal). */
  shellCommand: string;
  label: string;
};

type JsonWithScripts = {
  scripts?: Record<string, unknown>;
};

/**
 * Front: script `code-review` en package.json → `npm run code-review`.
 * API: si no hay ese script en package.json, usa composer.json → `composer code-review`.
 *
 * (La API suele tener package.json sin code-review y composer.json con el script.)
 */
export async function resolveCodeReviewRunner(
  repoPath: string
): Promise<CodeReviewRunner | undefined> {
  const packageJsonPath = path.join(repoPath, "package.json");
  if (await hasScript(packageJsonPath, "code-review")) {
    return {
      kind: "node",
      manifest: "package.json",
      shellCommand: "npm run code-review",
      label: "Front (package.json)",
    };
  }

  const composerJsonPath = path.join(repoPath, "composer.json");
  if (await hasScript(composerJsonPath, "code-review")) {
    return {
      kind: "php",
      manifest: "composer.json",
      shellCommand: "composer code-review",
      label: "API (composer.json)",
    };
  }

  return undefined;
}

async function hasScript(filePath: string, scriptName: string) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw) as JsonWithScripts;
    return typeof json.scripts?.[scriptName] === "string";
  } catch {
    return false;
  }
}
