import { execFile } from "child_process";
import { promisify } from "util";
import simpleGit from "simple-git";

const execFileAsync = promisify(execFile);

export type RepoBranches = {
  root: string;
  current: string;
  locals: string[];
  remotes: string[];
};

export type ChangeSummary = {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  diffStat: string;
  diffPreview: string;
  hasChanges: boolean;
};

export async function getRepoBranches(repoPath: string): Promise<RepoBranches> {
  const git = simpleGit(repoPath);

  if (!(await git.checkIsRepo())) {
    throw new Error(`La carpeta abierta no es un repositorio git: ${repoPath}`);
  }

  const root = (await git.revparse(["--show-toplevel"])).trim();
  const local = await git.branchLocal();
  const remote = await git.branch(["-r"]);

  return {
    root,
    current: local.current,
    locals: local.all,
    remotes: remote.all.filter(name => !name.includes("->")),
  };
}

export function hasBase(branches: RepoBranches, baseBranch: string) {
  return (
    branches.locals.includes(baseBranch) ||
    branches.remotes.includes(`origin/${baseBranch}`)
  );
}

export async function createLocalBranch(
  repoPath: string,
  branchName: string,
  baseBranch = "develop"
) {
  const git = simpleGit(repoPath);
  const branches = await getRepoBranches(repoPath);

  if (branches.locals.includes(branchName)) {
    throw new Error(`La rama "${branchName}" ya existe.`);
  }

  try {
    await git.fetch("origin", baseBranch);
  } catch {
    // Sin remoto, sin red o sin esa rama remota.
  }

  const remoteBase = `origin/${baseBranch}`;

  if (branches.locals.includes(baseBranch)) {
    await git.checkout(baseBranch);
    if (branches.remotes.includes(remoteBase)) {
      await git.merge([remoteBase, "--ff-only"]).catch(() => undefined);
    }
  } else if (branches.remotes.includes(remoteBase)) {
    await git.checkout(["-b", baseBranch, "--track", remoteBase]);
  } else {
    throw new Error(
      `No existe la rama base "${baseBranch}" en ${branches.root}. ` +
      `Ramas locales: ${branches.locals.join(", ") || "(ninguna)"}.`
    );
  }

  await git.checkoutLocalBranch(branchName);
}

export async function checkoutBranch(repoPath: string, branchName: string) {
  const git = simpleGit(repoPath);
  const branches = await getRepoBranches(repoPath);

  if (branches.locals.includes(branchName)) {
    await git.checkout(branchName);
    return;
  }

  const remoteBase = `origin/${branchName}`;
  if (branches.remotes.includes(remoteBase)) {
    await git.checkout(["-b", branchName, "--track", remoteBase]);
    return;
  }

  throw new Error(
    `No se pudo volver a "${branchName}" en ${branches.root}. ` +
    `Ramas locales: ${branches.locals.join(", ") || "(ninguna)"}.`
  );
}

export async function getChangeSummary(repoPath: string): Promise<ChangeSummary> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  const diffStat = (await git.diff(["--stat"])).trim();
  const stagedStat = (await git.diff(["--cached", "--stat"])).trim();
  const preview = (await git.diff(["--unified=3"])).trim();
  const stagedPreview = (await git.diff(["--cached", "--unified=3"])).trim();
  const combinedPreview = [stagedPreview, preview].filter(Boolean).join("\n\n");
  const combinedStat = [stagedStat, diffStat].filter(Boolean).join("\n");

  return {
    branch: status.current || "(sin rama)",
    staged: status.staged,
    unstaged: status.modified,
    untracked: status.not_added,
    diffStat: combinedStat || "(sin cambios en diff --stat)",
    diffPreview: combinedPreview.slice(0, 12000),
    hasChanges:
      status.files.length > 0 ||
      status.staged.length > 0 ||
      status.not_added.length > 0,
  };
}

export async function commitAllChanges(repoPath: string, message: string) {
  const git = simpleGit(repoPath);
  await git.add(["-A"]);
  const status = await git.status();
  if (status.files.length === 0 && status.staged.length === 0) {
    throw new Error("No hay cambios para hacer commit.");
  }
  await git.commit(message);
}

export async function pushBranch(repoPath: string, branchName: string) {
  const git = simpleGit(repoPath);
  await git.push(["-u", "origin", branchName]);
}

export async function createPullRequest(options: {
  repoPath: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}) {
  const { repoPath, baseBranch, headBranch, title, body } = options;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr", "create",
        "--base", baseBranch,
        "--head", headBranch,
        "--title", title,
        "--body", body,
      ],
      { cwd: repoPath }
    );
    return stdout.trim();
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new Error(
      err.stderr?.trim() ||
      err.message ||
      "No se pudo crear el pull request. ¿Está instalado y autenticado `gh`?"
    );
  }
}
