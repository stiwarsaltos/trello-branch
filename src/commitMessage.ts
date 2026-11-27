import * as fs from "fs/promises";
import * as path from "path";
import axios from "axios";
import * as vscode from "vscode";
import { toEnglish, toEnglishKebab } from "./englishCommit";

const MAX_DIFF_CHARS = 50000;
const LM_TIMEOUT_MS = 25000;
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_MODEL_FALLBACK = "claude-3-5-sonnet-latest";

const COMMIT_HEADER =
  /^(feat|fix|refactor|style|chore|test|docs|perf|ci|build)(?:\([^)]+\))?: .+/m;

const NOISE_IDENTS = new Set([
  "constructor",
  "prototype",
  "exports",
  "module",
  "require",
  "define",
  "angular",
  "function",
  "return",
  "class",
  "init",
  "render",
  "length",
  "push",
  "then",
  "catch",
  "success",
  "error",
  "data",
  "item",
  "index",
  "true",
  "false",
  "null",
  "undefined",
  "view",
  "compact",
  "response",
  "request",
  "redirect",
  "abort",
  "collect",
  "json",
  "where",
  "with",
  "load",
  "first",
  "find",
  "save",
  "create",
  "update",
  "delete",
  "log",
  "map",
  "filter",
  "foreach",
  "trim",
  "split",
  "join",
  "replace",
]);

type CommitType =
  | "feat"
  | "fix"
  | "refactor"
  | "style"
  | "chore"
  | "test"
  | "docs"
  | "perf";

export type StagedChangeSet = {
  files: string[];
  added: string[];
  deleted: string[];
  diff: string;
};

type FileChange = {
  file: string;
  status: "added" | "deleted" | "modified";
  addedNames: string[];
  removedNames: string[];
  hunks: string[];
  addedCount: number;
  removedCount: number;
};

type DiffInsights = {
  files: FileChange[];
  newNames: string[];
  goneNames: string[];
  hunks: string[];
  addedCount: number;
  removedCount: number;
  looksFix: boolean;
  looksRefactor: boolean;
};

function posix(file: string) {
  return file.replace(/\\/g, "/");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export type CommitContext = {
  module?: string;
  submodule?: string;
};

/** Carpetas técnicas. No son el módulo del producto. */
const GENERIC_SCOPE = new Set([
  "app",
  "src",
  "http",
  "https",
  "api",
  "controllers",
  "controller",
  "views",
  "view",
  "services",
  "service",
  "models",
  "model",
  "routes",
  "route",
  "resources",
  "resource",
  "components",
  "component",
  "pages",
  "page",
  "modules",
  "module",
  "features",
  "feature",
  "shared",
  "common",
  "core",
  "lib",
  "utils",
  "helpers",
  "domain",
  "requests",
  "middleware",
  "database",
  "migrations",
  "migration",
  "config",
  "public",
  "assets",
  "js",
  "ts",
  "php",
  "css",
  "scss",
  "html",
  "blade",
  "tests",
  "test",
  "spec",
  "specs",
  "e2e",
  "ci",
  "scripts",
  "livewire",
  "partials",
  "layouts",
  "includes",
]);

const SUBJECT_FILLER = new Set([
  "add",
  "update",
  "remove",
  "fix",
  "change",
  "and",
  "in",
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "with",
]);

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function joinModuleScope(moduleScope: string, submoduleScope: string) {
  if (!moduleScope) {
    return submoduleScope;
  }
  if (!submoduleScope) {
    return moduleScope;
  }
  if (
    submoduleScope === moduleScope ||
    submoduleScope.startsWith(`${moduleScope}-`)
  ) {
    return submoduleScope;
  }
  if (
    moduleScope.startsWith(`${submoduleScope}-`) ||
    moduleScope.endsWith(`-${submoduleScope}`)
  ) {
    return moduleScope;
  }
  const moduleParts = new Set(moduleScope.split("-"));
  const extra = submoduleScope
    .split("-")
    .filter(part => !moduleParts.has(part));
  return extra.length ? `${moduleScope}-${extra.join("-")}` : moduleScope;
}

/** Scope del módulo de la tarjeta (Modulo / Submodulo), en inglés. */
export function scopeFromModule(context?: CommitContext) {
  const moduleScope = context?.module ? toEnglishKebab(context.module) : "";
  const submoduleScope = context?.submodule
    ? toEnglishKebab(context.submodule)
    : "";
  const scope = joinModuleScope(moduleScope, submoduleScope)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!scope || GENERIC_SCOPE.has(scope)) {
    return undefined;
  }
  return scope;
}

function meaningfulDirs(file: string) {
  return posix(file)
    .split("/")
    .slice(0, -1)
    .map(dir => toEnglishKebab(dir))
    .filter(dir => dir && !GENERIC_SCOPE.has(dir) && dir.length > 1);
}

function inferScope(files: string[]) {
  const paths = files.map(posix);
  const every = (re: RegExp) => paths.length > 0 && paths.every(file => re.test(file));
  if (every(/(^|\/)e2e\//i)) {
    return "e2e";
  }
  if (every(/(^|\/)\.github\//) || every(/(^|\/)scripts\//)) {
    return "ci";
  }
  if (every(/(^|\/)migrations?\//i)) {
    return "migrations";
  }

  const dirLists = paths.map(meaningfulDirs).filter(dirs => dirs.length > 0);
  if (!dirLists.length) {
    if (every(/(^|\/)(tests?|specs?)\//i) || every(/\.(spec|test)\./i)) {
      return "test";
    }
    return "app";
  }
  return mostCommon(dirLists.map(dirs => dirs[0])) || "app";
}

function commitScope(files: string[], context?: CommitContext) {
  return scopeFromModule(context) || inferScope(files);
}

function inferType(files: string[], insights: DiffInsights): CommitType {
  const paths = files.map(posix);
  const every = (re: RegExp) => paths.length > 0 && paths.every(file => re.test(file));
  if (every(/\.(md|txt|rst)$/i)) {
    return "docs";
  }
  if (every(/(^|\/)(e2e|tests?|specs?)\//i) || every(/\.(spec|test)\./i)) {
    return "test";
  }
  if (every(/\.(css|scss|less|sass)$/i)) {
    return "style";
  }
  if (every(/(package-lock|composer\.lock|\.ya?ml$|Dockerfile)/i)) {
    return "chore";
  }
  if (insights.looksFix) {
    return "fix";
  }
  if (insights.looksRefactor) {
    return "refactor";
  }
  return "feat";
}

function splitIdent(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function englishIdent(name: string) {
  const split = splitIdent(name);
  return toEnglish(split) || split;
}

function isUsefulIdent(name: string) {
  if (!name || name.length < 3 || NOISE_IDENTS.has(name.toLowerCase())) {
    return false;
  }
  return /[a-z]/i.test(name);
}

function namesFromLine(line: string) {
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=>/g,
    /(\w+)\s*:\s*(?:async\s*)?function\s*\(/g,
    /(?:public|private|protected|static)\s+function\s+(\w+)/g,
    /->(\w+)\s*\(/g,
    /(?:class|interface|trait|enum)\s+(\w+)/g,
    /\$scope\.(\w+)/g,
    /(?:ng-model|ng-click|ng-change|ng-if)="([^"(]+)/g,
    /^\s*(?:async\s+)?(?!if|for|while|switch|catch|function)(\w+)\s*\([^)]*\)\s*\{/g,
  ];
  const names: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) {
      const raw = match[1]?.trim().split(/[\s.]+/)[0] ?? "";
      if (isUsefulIdent(raw)) {
        names.push(raw);
      }
    }
  }
  return names;
}

function minus(left: string[], right: string[]) {
  const skip = new Set(right);
  return left.filter(name => !skip.has(name));
}

function parseFileChanges(diff: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | undefined;

  for (const line of diff.split("\n")) {
    const gitHeader = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitHeader) {
      current = {
        file: gitHeader[2],
        status: "modified",
        addedNames: [],
        removedNames: [],
        hunks: [],
        addedCount: 0,
        removedCount: 0,
      };
      files.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("@@")) {
      const ctx = line.replace(/^@@ .* @@\s*/, "").trim();
      const fromCtx =
        ctx.match(/(?:function|class|def|public|private|protected)\s+(\w+)/i) ||
        ctx.match(/^(\w+)\s*\(/);
      if (fromCtx && isUsefulIdent(fromCtx[1])) {
        current.hunks.push(fromCtx[1]);
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedCount += 1;
      current.addedNames.push(...namesFromLine(line.slice(1)));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removedCount += 1;
      current.removedNames.push(...namesFromLine(line.slice(1)));
    }
  }

  return files.map(file => ({
    ...file,
    addedNames: unique(file.addedNames),
    removedNames: unique(file.removedNames),
    hunks: unique(file.hunks),
  }));
}

function parseDiffInsights(diff: string): DiffInsights {
  const files = parseFileChanges(diff);
  const newNames = unique(files.flatMap(file => minus(file.addedNames, file.removedNames)));
  const goneNames = unique(files.flatMap(file => minus(file.removedNames, file.addedNames)));
  const addedCount = files.reduce((sum, file) => sum + file.addedCount, 0);
  const removedCount = files.reduce((sum, file) => sum + file.removedCount, 0);
  const plusText = diff
    .split("\n")
    .filter(line => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n")
    .toLowerCase();

  return {
    files,
    newNames,
    goneNames,
    hunks: unique(files.flatMap(file => file.hunks)),
    addedCount,
    removedCount,
    looksFix: /\b(fix|bug|hotfix|error|corrige|corregir|throw|exception)\b/.test(
      plusText
    ),
    looksRefactor:
      newNames.length === 0 &&
      goneNames.length === 0 &&
      addedCount > 12 &&
      removedCount > 12,
  };
}

function changeInventory(insights: DiffInsights) {
  return insights.files.map(file => {
    const newNames = minus(file.addedNames, file.removedNames);
    const goneNames = minus(file.removedNames, file.addedNames);
    const bits = [`${file.status} ${file.file}`];
    if (file.hunks.length) {
      bits.push(`in ${file.hunks.join(", ")}`);
    }
    if (newNames.length) {
      bits.push(`added ${newNames.join(", ")}`);
    }
    if (goneNames.length) {
      bits.push(`removed ${goneNames.join(", ")}`);
    }
    if (!newNames.length && !goneNames.length) {
      bits.push(`+${file.addedCount}/-${file.removedCount} lines`);
    }
    return `- ${bits.join("; ")}`;
  });
}

function clipSubject(prefix: string, subject: string) {
  const maxSubject = Math.max(24, 72 - prefix.length);
  if (subject.length <= maxSubject) {
    return subject;
  }
  return `${subject.slice(0, maxSubject - 3).trimEnd()}...`;
}

function listEnglish(names: string[], limit = 2) {
  return names.slice(0, limit).map(englishIdent).filter(Boolean);
}

function subjectFromInsights(insights: DiffInsights, staged: StagedChangeSet) {
  const newNames = listEnglish(insights.newNames);
  const goneNames = listEnglish(insights.goneNames);
  const hunks = listEnglish(insights.hunks);
  const onlyAdded =
    staged.added.length === staged.files.length && staged.files.length > 0;
  const onlyDeleted =
    staged.deleted.length === staged.files.length && staged.files.length > 0;

  if (onlyDeleted) {
    const names = staged.deleted.slice(0, 2).map(file => englishIdent(path.basename(file)));
    return `remove ${names.join(" and ")}`;
  }
  if (onlyAdded && newNames.length) {
    return `add ${newNames.join(" and ")}`;
  }
  if (onlyAdded) {
    const names = staged.added.slice(0, 2).map(file => englishIdent(path.basename(file)));
    return `add ${names.join(" and ")}`;
  }
  if (newNames.length && hunks.length && !hunks.includes(newNames[0])) {
    return `add ${newNames.join(" and ")} in ${hunks[0]}`;
  }
  if (newNames.length) {
    return `add ${newNames.join(" and ")}`;
  }
  if (goneNames.length) {
    return `remove ${goneNames.join(" and ")}`;
  }
  if (hunks.length) {
    return `update ${hunks.join(" and ")}`;
  }
  const files = staged.files.slice(0, 2).map(file => englishIdent(path.basename(file)));
  return `update ${files.join(" and ")}`;
}

function bodyFromInsights(insights: DiffInsights) {
  const lines = insights.files.slice(0, 8).map(file => {
    const newNames = minus(file.addedNames, file.removedNames).slice(0, 4);
    const goneNames = minus(file.removedNames, file.addedNames).slice(0, 4);
    const short = posix(file.file);
    const label = short.length > 56 ? path.posix.basename(short) : short;
    if (file.status === "added") {
      const extra = newNames.length ? ` (${newNames.join(", ")})` : "";
      return `- Add ${label}${extra}`;
    }
    if (file.status === "deleted") {
      return `- Remove ${label}`;
    }
    const parts: string[] = [];
    if (newNames.length) {
      parts.push(`add ${newNames.join(", ")}`);
    }
    if (goneNames.length) {
      parts.push(`remove ${goneNames.join(", ")}`);
    }
    if (!parts.length && file.hunks.length) {
      parts.push(`edit ${file.hunks.join(", ")}`);
    }
    if (!parts.length) {
      parts.push(`adjust +${file.addedCount}/-${file.removedCount} lines`);
    }
    return `- ${label}: ${parts.join("; ")}`;
  });
  return lines.join("\n");
}

const GENERIC_SUBJECT =
  /\b(update|improve|implement)\s+(project\s+)?(files?|behavior|code|module|controllers?|views?)\b/i;

const GENERIC_SUBJECT_WORDS = new Set([
  ...GENERIC_SCOPE,
  "behavior",
  "code",
  "class",
  "classes",
  "function",
  "functions",
  "method",
  "methods",
  "index",
]);

function isGenericSubject(subject: string) {
  if (GENERIC_SUBJECT.test(subject)) {
    return true;
  }
  const words = subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word && !SUBJECT_FILLER.has(word));
  return words.length > 0 && words.every(word => GENERIC_SUBJECT_WORDS.has(word));
}

function subjectOf(header: string) {
  return header.replace(
    /^(?:feat|fix|refactor|style|chore|test|docs|perf|ci|build)(?:\([^)]*\))?:\s*/,
    ""
  );
}

function specificSubject(subject: string, scope: string) {
  if (!isGenericSubject(subject)) {
    return subject;
  }
  const area = scope.replace(/-/g, " ").trim();
  if (!area || area === "app" || isGenericSubject(`update ${area}`)) {
    return subject;
  }
  const verb =
    subject.match(/^(add|remove|fix|update)\b/i)?.[1]?.toLowerCase() ?? "update";
  return `${verb} ${area}`;
}

export function fallbackCommitMessage(
  staged: StagedChangeSet,
  context?: CommitContext
) {
  const insights = parseDiffInsights(staged.diff);
  const type = inferType(staged.files, insights);
  const scope = commitScope(staged.files, context);
  const prefix = `${type}(${scope}): `;
  const subject = specificSubject(subjectFromInsights(insights, staged), scope);
  const header = `${prefix}${clipSubject(prefix, subject)}`;
  const body = bodyFromInsights(insights);
  return body ? `${header}\n\n${body}` : header;
}

function commitPrompt(
  files: string[],
  diff: string,
  inventory: string[],
  scope: string
) {
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... [diff truncated]`
      : diff;
  return [
    "Write a git commit message that describes ONLY the staged diff.",
    "Return ONLY a Conventional Commit in English. No markdown fences. No commentary.",
    "",
    "Format:",
    "type(scope): imperative subject (max 72 chars)",
    "",
    "Then a blank line and a body listing the actual changes (one bullet per file or symbol).",
    "",
    "Rules:",
    "- Types: feat, fix, refactor, style, chore, test, docs, perf",
    `- Scope MUST be exactly: ${scope}`,
    "- That scope is the product module. Do not replace it with a technical folder (controllers, views, services, models, components, app, src)",
    "- The subject MUST summarize the inventory below (added/removed symbols and edited functions)",
    "- Do not invent filters, fields, endpoints, or features that are not in the inventory or diff",
    "- Do not use the Trello card/task title as the subject",
    "- Do not write generic subjects like \"update files\", \"update controllers\", \"update module\", or \"improve behavior\"",
    "- Imperative mood: add/fix/update/remove",
    "",
    "Change inventory (source of truth):",
    ...inventory,
    "",
    "Changed files:",
    ...files.map(file => `- ${file}`),
    "",
    "Staged diff:",
    "```diff",
    truncated,
    "```",
  ].join("\n");
}

function cleanCommitMessage(text: string) {
  return text
    .replace(/^```(?:\w+)?\n?/, "")
    .replace(/\n```$/, "")
    .trim();
}

function tokensFromInsights(insights: DiffInsights, files: string[]) {
  return unique([
    ...insights.newNames,
    ...insights.goneNames,
    ...insights.hunks,
    ...files.map(file => path.basename(file).replace(/\.[a-z0-9]+$/i, "")),
  ])
    .flatMap(name => [name.toLowerCase(), englishIdent(name)])
    .map(token => token.toLowerCase())
    .filter(token => token.length >= 4 && !isGenericSubject(`update ${token}`));
}

function messageMatchesDiff(
  text: string,
  insights: DiffInsights,
  files: string[]
) {
  const header = text.split("\n")[0] ?? "";
  if (!COMMIT_HEADER.test(text) || isGenericSubject(subjectOf(header))) {
    return false;
  }
  const tokens = tokensFromInsights(insights, files);
  if (!tokens.length) {
    return true;
  }
  const haystack = text.toLowerCase();
  return tokens.some(token => haystack.includes(token));
}

function enforceScope(message: string, scope: string) {
  const [header, ...rest] = message.split("\n");
  const next = header.replace(
    /^(feat|fix|refactor|style|chore|test|docs|perf|ci|build)(?:\([^)]*\))?:/,
    `$1(${scope}):`
  );
  return [next, ...rest].join("\n");
}

async function readAnthropicKey(repoPath: string) {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }
  for (const fileName of [".env.local", ".env"]) {
    try {
      const raw = await fs.readFile(path.join(repoPath, fileName), "utf8");
      const match = raw.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/m);
      const value = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
      if (value) {
        return value;
      }
    } catch {
      // Missing env file in this repo.
    }
  }
  return undefined;
}

async function generateWithAnthropic(
  repoPath: string,
  files: string[],
  diff: string,
  insights: DiffInsights,
  scope: string
) {
  const apiKey = await readAnthropicKey(repoPath);
  if (!apiKey) {
    return undefined;
  }
  const prompt = commitPrompt(files, diff, changeInventory(insights), scope);
  const models = [ANTHROPIC_MODEL, ANTHROPIC_MODEL_FALLBACK];
  for (const model of models) {
    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model,
          max_tokens: 512,
          temperature: 0,
          messages: [{ role: "user", content: prompt }],
        },
        {
          timeout: LM_TIMEOUT_MS,
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
        }
      );
      const text = (response.data?.content ?? [])
        .filter((block: { type?: string }) => block.type === "text")
        .map((block: { text?: string }) => block.text ?? "")
        .join("\n");
      const cleaned = enforceScope(cleanCommitMessage(text), scope);
      if (messageMatchesDiff(cleaned, insights, files)) {
        return cleaned;
      }
    } catch {
      // Try the next model or give up.
    }
  }
  return undefined;
}

function pickChatModel(models: vscode.LanguageModelChat[]) {
  const score = (model: vscode.LanguageModelChat) => {
    const id = `${model.family} ${model.name} ${model.id}`.toLowerCase();
    if (/(opus|sonnet|gpt-4|gpt-5)/.test(id)) {
      return 3;
    }
    if (/(gpt|claude|gemini)/.test(id)) {
      return 2;
    }
    return 1;
  };
  return [...models].sort((a, b) => score(b) - score(a))[0];
}

async function generateWithLanguageModel(
  files: string[],
  diff: string,
  insights: DiffInsights,
  scope: string
) {
  if (!vscode.lm?.selectChatModels) {
    return undefined;
  }
  const models = await vscode.lm.selectChatModels();
  if (!models.length) {
    return undefined;
  }
  const model = pickChatModel(models);
  const cts = new vscode.CancellationTokenSource();
  const timer = setTimeout(() => cts.cancel(), LM_TIMEOUT_MS);
  try {
    const response = await model.sendRequest(
      [
        vscode.LanguageModelChatMessage.User(
          commitPrompt(files, diff, changeInventory(insights), scope)
        ),
      ],
      {},
      cts.token
    );
    let text = "";
    for await (const chunk of response.text) {
      text += chunk;
    }
    const cleaned = enforceScope(cleanCommitMessage(text), scope);
    return messageMatchesDiff(cleaned, insights, files) ? cleaned : undefined;
  } finally {
    clearTimeout(timer);
    cts.dispose();
  }
}

/** Conventional Commit en inglés. El scope es el módulo de la tarjeta; el asunto sale del diff. */
export async function buildCommitFromDiff(
  staged: StagedChangeSet,
  repoPath?: string,
  context?: CommitContext
) {
  const fallback = fallbackCommitMessage(staged, context);
  const insights = parseDiffInsights(staged.diff);
  const scope = commitScope(staged.files, context);
  try {
    if (repoPath) {
      const fromAnthropic = await generateWithAnthropic(
        repoPath,
        staged.files,
        staged.diff,
        insights,
        scope
      );
      if (fromAnthropic) {
        return fromAnthropic;
      }
    }
    const fromLm = await generateWithLanguageModel(
      staged.files,
      staged.diff,
      insights,
      scope
    );
    return fromLm || fallback;
  } catch {
    return fallback;
  }
}
