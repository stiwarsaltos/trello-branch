import axios from "axios";
import simpleGit from "simple-git";

const GITHUB_API = "https://api.github.com";

export class GithubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAuthError";
  }
}

export type GithubUser = {
  login: string;
  name: string;
};

export type GithubRepoRef = {
  owner: string;
  repo: string;
};

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "trello-branch",
  };
}

function githubApiError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as
      | { message?: string; errors?: { message?: string }[] }
      | undefined;
    if (status === 401) {
      throw new GithubAuthError("El token de GitHub no es válido o expiró.");
    }
    const blob = JSON.stringify(data ?? "");
    if (status === 403 && /sso/i.test(blob)) {
      throw new Error(
        "El token no está autorizado para esta organización (SSO). Autoriza el token en GitHub."
      );
    }
    const extra = data?.errors?.map(item => item.message).filter(Boolean).join("; ");
    throw new Error(
      data?.message ? `${data.message}${extra ? `: ${extra}` : ""}` : fallback
    );
  }
  throw error instanceof Error ? error : new Error(fallback);
}

export function parseGithubRemote(url: string): GithubRepoRef | undefined {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const ssh = cleaned.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2].split("/")[0] };
  }
  const sshProto = cleaned.match(/^ssh:\/\/(?:git@)?github\.com\/([^/]+)\/(.+)$/i);
  if (sshProto) {
    return { owner: sshProto[1], repo: sshProto[2].split("/")[0] };
  }
  const http = cleaned.match(
    /^(?:https?:\/\/|git:\/\/)(?:www\.)?github\.com\/([^/]+)\/(.+)$/i
  );
  if (http) {
    return { owner: http[1], repo: http[2].split("/")[0] };
  }
  return undefined;
}

export async function resolveGithubRepo(repoPath: string): Promise<GithubRepoRef> {
  const git = simpleGit(repoPath);
  const remotes = await git.getRemotes(true);
  const origin =
    remotes.find(remote => remote.name === "origin") ?? remotes[0];
  const url = origin?.refs.fetch || origin?.refs.push;
  if (!url) {
    throw new Error(`El repositorio ${repoPath} no tiene remote origin.`);
  }
  const ref = parseGithubRemote(url);
  if (!ref) {
    throw new Error(
      `El remote "${url}" no es un repositorio de GitHub. ` +
        `Los PR se crean contra github.com.`
    );
  }
  return ref;
}

export async function getGithubUser(token: string): Promise<GithubUser> {
  try {
    const { data } = await axios.get<{ login: string; name?: string | null }>(
      `${GITHUB_API}/user`,
      { headers: githubHeaders(token) }
    );
    return { login: data.login, name: data.name?.trim() || data.login };
  } catch (error) {
    githubApiError(error, "No se pudo validar el token de GitHub.");
  }
}

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

export function branchExists(branches: RepoBranches, name: string) {
  return (
    branches.locals.includes(name) ||
    branches.remotes.includes(`origin/${name}`)
  );
}

export async function createLocalBranch(
  repoPath: string,
  branchName: string,
  baseBranch = "develop"
) {
  const git = simpleGit(repoPath);
  const branches = await getRepoBranches(repoPath);

  if (branchExists(branches, branchName)) {
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

type GithubPull = {
  html_url: string;
  number: number;
};

async function listOpenPulls(
  token: string,
  ref: GithubRepoRef,
  headBranch: string
) {
  try {
    const { data } = await axios.get<GithubPull[]>(
      `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls`,
      {
        headers: githubHeaders(token),
        params: {
          head: `${ref.owner}:${headBranch}`,
          state: "open",
        },
      }
    );
    return Array.isArray(data) ? data : [];
  } catch (error) {
    githubApiError(error, "No se pudo consultar los pull requests abiertos.");
  }
}

/** True si hay un PR abierto con esa rama como head. */
export async function hasOpenPullRequest(
  repoPath: string,
  headBranch: string,
  githubToken: string
) {
  const ref = await resolveGithubRepo(repoPath);
  const pulls = await listOpenPulls(githubToken, ref, headBranch);
  return pulls.length > 0;
}

/**
 * Deja el repo en la rama de la tarea: la ocupa si ya existe, o la crea desde HEAD.
 * Conserva cambios locales (staged/unstaged).
 */
export async function ensureTaskBranch(repoPath: string, branchName: string) {
  const git = simpleGit(repoPath);
  const branches = await getRepoBranches(repoPath);

  if (branches.current === branchName) {
    return "current";
  }

  if (branches.locals.includes(branchName)) {
    await git.checkout(branchName);
    return "checkout";
  }

  const remote = `origin/${branchName}`;
  if (branches.remotes.includes(remote)) {
    await git.checkout(["-b", branchName, "--track", remote]);
    return "track";
  }

  await git.checkoutLocalBranch(branchName);
  return "created";
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

function baseRef(branches: RepoBranches, baseBranch: string) {
  const remoteBase = `origin/${baseBranch}`;
  if (branches.remotes.includes(remoteBase)) {
    return remoteBase;
  }
  if (branches.locals.includes(baseBranch)) {
    return baseBranch;
  }
  return undefined;
}

/** Archivos nuevos y diff de la rama actual respecto a la base (p. ej. develop). */
export async function getChangesSinceBase(
  repoPath: string,
  baseBranch: string
) {
  const git = simpleGit(repoPath);
  const branches = await getRepoBranches(repoPath);
  const ref = baseRef(branches, baseBranch);
  if (!ref) {
    return { added: [] as string[], diff: "" };
  }
  const range = `${ref}...HEAD`;
  const added = (await git.diff(["--name-only", "--diff-filter=A", range]))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const diff = await git.diff([range]);
  return { added, diff };
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

export function changeFileCount(summary: ChangeSummary) {
  return new Set([
    ...summary.staged,
    ...summary.unstaged,
    ...summary.untracked,
  ]).size;
}

export async function stageAllChanges(repoPath: string) {
  const git = simpleGit(repoPath);
  await git.add(["-A"]);
  const files = (await git.diff(["--cached", "--name-only"]))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const added = (await git.diff(["--cached", "--name-only", "--diff-filter=A"]))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const deleted = (await git.diff(["--cached", "--name-only", "--diff-filter=D"]))
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const diff = await git.diff(["--cached"]);
  if (!files.length) {
    throw new Error("No hay cambios para hacer commit.");
  }
  return { files, added, deleted, diff };
}

export async function commitStaged(repoPath: string, message: string) {
  const git = simpleGit(repoPath);
  await git.commit(message);
}

export async function pushBranch(repoPath: string, branchName: string) {
  const git = simpleGit(repoPath);
  await git.push(["-u", "origin", branchName]);
}

export async function createPullRequest(options: {
  repoPath: string;
  githubToken: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}) {
  const { repoPath, githubToken, baseBranch, headBranch, title, body } = options;
  const ref = await resolveGithubRepo(repoPath);

  try {
    const { data } = await axios.post<GithubPull>(
      `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls`,
      {
        title,
        head: `${ref.owner}:${headBranch}`,
        base: baseBranch,
        body,
      },
      { headers: githubHeaders(githubToken) }
    );
    return data.html_url;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 422) {
      const existing = await listOpenPulls(githubToken, ref, headBranch);
      if (existing[0]?.html_url) {
        return existing[0].html_url;
      }
    }
    githubApiError(error, "No se pudo crear el pull request.");
  }
}
