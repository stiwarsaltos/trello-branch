import * as fs from "fs/promises";
import * as path from "path";

export type ProjectManifest = {
  kind: "node" | "php";
  fileName: "package.json" | "composer.json";
  filePath: string;
};

/** Busca package.json; si no existe, composer.json. */
export async function detectProjectManifest(
  repoPath: string
): Promise<ProjectManifest | undefined> {
  const packageJson = path.join(repoPath, "package.json");
  if (await fileExists(packageJson)) {
    return { kind: "node", fileName: "package.json", filePath: packageJson };
  }

  const composerJson = path.join(repoPath, "composer.json");
  if (await fileExists(composerJson)) {
    return { kind: "php", fileName: "composer.json", filePath: composerJson };
  }

  return undefined;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
