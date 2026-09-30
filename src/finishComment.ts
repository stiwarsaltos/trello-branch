import * as fs from "fs/promises";
import * as path from "path";
import { getChangesSinceBase } from "./github";
import { resolveRepoSide } from "./projectManifest";
import { ActiveRepo } from "./taskState";

const COMMAND_NAME_PATTERNS = [
  /\$signature\s*=\s*['"]([^'"\s{]+)/,
  /\$defaultName\s*=\s*['"]([^'"]+)/,
  /#\[AsCommand\s*\([^[\]]*name:\s*['"]([^'"]+)/,
  /Artisan::command\(\s*['"]([^'"]+)/,
];

function isConsoleCommandPath(file: string) {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized.toLowerCase().endsWith(".php")) {
    return false;
  }
  return (
    /\/console\/commands\//i.test(normalized) ||
    /\/src\/commands?\//i.test(normalized)
  );
}

export function commandNamesFromText(text: string) {
  const names: string[] = [];
  for (const pattern of COMMAND_NAME_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(global)) {
      const name = match[1]?.trim();
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

function commandNamesFromDiff(diff: string) {
  const added = diff
    .split("\n")
    .filter(line => line.startsWith("+") && !line.startsWith("+++"))
    .map(line => line.slice(1))
    .join("\n");
  return commandNamesFromText(added);
}

export function buildCardMoveComment(front: boolean, back: boolean, commands: string[]) {
  if (!front && !back) {
    return undefined;
  }
  const pull =
    back && front ? "Pull en back y front" : back ? "Pull en back" : "Pull en front";
  const unique = [...new Set(commands.map(name => name.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return pull;
  }
  return `${pull}\nComando: ${unique.join(", ")}`;
}

async function commandNamesInRepo(repoPath: string, baseBranch: string) {
  const { added, diff } = await getChangesSinceBase(repoPath, baseBranch);
  const names = new Set(commandNamesFromDiff(diff));
  for (const file of added.filter(isConsoleCommandPath)) {
    try {
      const source = await fs.readFile(path.join(repoPath, file), "utf8");
      for (const name of commandNamesFromText(source)) {
        names.add(name);
      }
    } catch {
      // El archivo puede haberse movido; el diff ya cubre el caso típico.
    }
  }
  return [...names];
}

export async function buildFinishCardComment(
  repos: ActiveRepo[],
  baseBranch: string
) {
  const done = repos.filter(repo => repo.status === "done");
  let front = false;
  let back = false;
  const commands: string[] = [];

  for (const repo of done) {
    const side = await resolveRepoSide(repo.root);
    if (side === "front") {
      front = true;
    } else {
      back = true;
    }
    try {
      commands.push(...(await commandNamesInRepo(repo.root, baseBranch)));
    } catch {
      // Sin diff no se omite el Pull; solo el nombre del comando.
    }
  }

  return buildCardMoveComment(front, back, commands);
}
