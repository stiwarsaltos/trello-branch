import * as path from "path";
import * as vscode from "vscode";
import {
  clearStoredToken,
  loginWithTrello,
  requireSession,
  resolveDeveloperName,
  TRELLO_APP_KEY,
} from "./auth";
import {
  GITHUB_AUTH_PROVIDER,
  loginWithGithub,
  requireGithubSession,
} from "./githubAuth";
import { commentOnCard, getAssignedCardsForBoard, getBoards, getCard, getList, moveCard, moveCardToNextList, moveCardToPreviousList } from "./trello";
import {
  branchExists,
  changeFileCount,
  checkoutBranch,
  commitStaged,
  createPullRequest,
  ensureTaskBranch,
  getChangeSummary,
  getRepoBranches,
  GithubAuthError,
  hasBase,
  hasOpenPullRequest,
  pushBranch,
  RepoBranches,
  stageAllChanges,
} from "./github";
import {
  ActiveRepo,
  ActiveTask,
  allReposClosed,
  findActiveRepo,
  getActiveTasks,
  pendingRepoLabels,
  removeActiveTask,
  repoLabel,
  saveActiveTask,
  sameRepoRoot,
  uniqueBranchName,
  updateActiveRepo,
} from "./taskState";
import { TrelloTreeProvider } from "./treeView";
import { descriptionForPr, formatMetaLine, parseCardMeta, sanitizeForPr } from "./cardMeta";
import { buildCommitFromDiff } from "./commitMessage";
import { runProjectCodeReview } from "./codeReview";
import { previewCardImage } from "./imagePreview";
import { resolveCodeReviewRunner } from "./projectManifest";
import {
  addCatalogBoard,
  linkCatalogBoard,
  readBoardCatalog,
  removeCatalogBoard,
  syncBoardCatalog,
  unusedTrelloBoards,
} from "./boardConfig";
import { buildFinishCardComment } from "./finishComment";
import {
  clearCompanionPath,
  getCompanionPath,
  pickAndSaveCompanionPath,
} from "./companionConfig";

const log = vscode.window.createOutputChannel("Trello Branch");

function trace(message: string) {
  log.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function toPascalCase(text: string) {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportError(context: string, error: unknown) {
  const message = errorMessage(error);
  trace(`ERROR en ${context}: ${message}`);
  vscode.window.showErrorMessage(`${context}: ${message}`, "Ver detalles").then(action => {
    if (action) {
      log.show();
    }
  });
}

async function startPickedCard(
  picked: { id: string; label: string; desc?: string; ruc?: string },
  listId: string,
  token: string,
  developer: string,
  globalState: vscode.Memento,
  workspaceState: vscode.Memento,
  treeProvider: TrelloTreeProvider
) {
  const { modulo, submodulo } = parseCardMeta(picked.desc ?? "");
  if (!modulo || !submodulo) {
    vscode.window.showErrorMessage(
      "La tarjeta debe tener 'Modulo:' y 'Submodulo:' en la descripción."
    );
    return;
  }

  const defaultBranchName = uniqueBranchName(
    `${developer}/${toPascalCase(modulo)}-${toPascalCase(submodulo)}`,
    getActiveTasks(globalState, workspaceState),
    picked.id
  );

  const already = getActiveTasks(globalState, workspaceState).find(
    task => task.cardId === picked.id
  );
  if (already) {
    vscode.window.showInformationMessage(
      `"${picked.label}" ya está en curso. Termínala o regrésala desde su nodo.`
    );
    treeProvider.refresh();
    return;
  }

  try {
    const moved = await moveCardToNextList(
      TRELLO_APP_KEY,
      token,
      picked.id,
      listId
    );
    trace(`Tarjeta movida: ${moved.from.name} → ${moved.to.name}`);

    await saveActiveTask(
      globalState,
      {
        cardId: picked.id,
        cardName: picked.label,
        cardDesc: picked.desc ?? "",
        branchName: defaultBranchName,
        originListId: listId,
        cardRuc: picked.ruc,
        repos: [],
        startedAt: new Date().toISOString(),
      },
      workspaceState
    );
    treeProvider.refresh();

    const openCount = getActiveTasks(globalState, workspaceState).length;
    vscode.window.showInformationMessage(
      `Tarea en curso: "${picked.label}".` +
        (openCount > 1 ? ` Llevas ${openCount} tareas a la vez.` : "") +
        ` Trabaja los cambios; al terminar se detectan los repos (este y el companion).`
    );
  } catch (moveError) {
    reportError("No se pudo mover la tarjeta", moveError);
  }
}

async function loadTrelloBoards(token: string) {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Cargando tableros de Trello..." },
      () => getBoards(TRELLO_APP_KEY, token)
    );
  } catch (error) {
    reportError("No se pudieron obtener los tableros", error);
    return undefined;
  }
}

async function pickTrelloBoard(
  token: string,
  title: string,
  excludeIds: string[] = []
) {
  const boards = await loadTrelloBoards(token);
  if (!boards) {
    return undefined;
  }
  if (boards.length === 0) {
    vscode.window.showInformationMessage("No se encontraron tableros en tu cuenta de Trello.");
    return undefined;
  }
  const available = boards.filter(board => !excludeIds.includes(board.id));
  if (available.length === 0) {
    vscode.window.showInformationMessage("No hay más tableros de Trello para agregar.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    available.map(board => ({ label: board.name, id: board.id })),
    { title, placeHolder: "Elige el tablero de Trello" }
  );
  if (!picked) {
    return undefined;
  }
  return { id: picked.id, name: picked.label };
}

const BRANCH_NAME_PATTERN = /^(?!\/|.*\.\.|.*\/\/|.*@\{|.*\\)[^\s~^:?*\[\\]+(?<!\.|\/)$/;

async function pickOpenTask(
  tasks: ActiveTask[],
  title: string
): Promise<ActiveTask | undefined> {
  if (tasks.length === 0) {
    return undefined;
  }
  if (tasks.length === 1) {
    return tasks[0];
  }
  const picked = await vscode.window.showQuickPick(
    tasks.map(task => ({
      label: task.cardName,
      description: task.branchName,
      task,
    })),
    { title, placeHolder: "Elige la tarea (no afecta a las demás)" }
  );
  return picked?.task;
}

async function resolveBranchName(
  defaultName: string,
  repoPath: string,
  branches: RepoBranches,
  githubToken: string
): Promise<string | undefined> {
  if (!branchExists(branches, defaultName)) {
    return defaultName;
  }

  const inUse = await hasOpenPullRequest(repoPath, defaultName, githubToken);
  if (!inUse) {
    trace(`La rama "${defaultName}" ya existe y no está en uso; se ocupa.`);
    return defaultName;
  }

  trace(`La rama "${defaultName}" tiene un PR abierto; pidiendo nombre alternativo.`);

  while (true) {
    const proposed = await vscode.window.showInputBox({
      title: `La rama "${defaultName}" está en uso (PR abierto)`,
      prompt: "Propón otro nombre de rama para esta tarea",
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: value => {
        const name = value.trim();
        if (!name) {
          return "El nombre no puede estar vacío.";
        }
        if (!BRANCH_NAME_PATTERN.test(name)) {
          return "Nombre de rama inválido para git.";
        }
        if (branchExists(branches, name)) {
          return `La rama "${name}" ya existe (local o en origin).`;
        }
        return undefined;
      },
    });

    if (proposed === undefined) {
      return undefined;
    }

    const name = proposed.trim();
    if (!branchExists(branches, name) && BRANCH_NAME_PATTERN.test(name)) {
      return name;
    }
  }
}

type RepoScan = {
  root: string;
  label: string;
  hasChanges: boolean;
  fileCount: number;
};

async function listFinishCandidates(
  currentRoot: string,
  companionPath: string | undefined
) {
  const roots = [currentRoot];
  if (companionPath && path.resolve(companionPath) !== path.resolve(currentRoot)) {
    roots.push(path.resolve(companionPath));
  }

  const scans: RepoScan[] = [];
  for (const root of roots) {
    const branches = await getRepoBranches(root);
    const summary = await getChangeSummary(branches.root);
    scans.push({
      root: branches.root,
      label: repoLabel(branches.root),
      hasChanges: summary.hasChanges,
      fileCount: changeFileCount(summary),
    });
  }
  return scans;
}

/** Confirma qué repos cierran esta tarea. Por defecto marca los que tienen cambios. */
async function confirmReposToClose(scans: RepoScan[]) {
  const items = scans.map(scan => ({
    label: scan.label,
    description: scan.hasChanges
      ? `${scan.fileCount} archivo(s) con cambios → rama + PR`
      : "sin cambios → omitir",
    detail: scan.root,
    picked: scan.hasChanges,
    scan,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Repos a cerrar en esta tarea",
    placeHolder: "Desmarca si los cambios no son de esta tarjeta",
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  return new Set(picked.map(item => path.resolve(item.scan.root)));
}

async function validateCompanionRepo(companionPath: string) {
  const resolved = path.resolve(companionPath);
  try {
    await getRepoBranches(resolved);
  } catch (error) {
    throw new Error(
      `El companion no es un repo git válido (${resolved}): ${errorMessage(error)}`
    );
  }
  const runner = await resolveCodeReviewRunner(resolved);
  if (!runner) {
    throw new Error(
      `El companion (${resolved}) no tiene script "code-review" en package.json ni composer.json.`
    );
  }
  return resolved;
}

async function resolveBaseBranch(configured: string, branches: RepoBranches) {
  if (hasBase(branches, configured)) {
    return configured;
  }

  trace(`La base "${configured}" no existe en ${branches.root}.`);
  const candidates = [
    ...branches.locals,
    ...branches.remotes
      .filter(r => r.startsWith("origin/"))
      .map(r => r.replace(/^origin\//, "")),
  ];
  const unique = [...new Set(candidates)];

  if (unique.length === 0) {
    throw new Error(`El repositorio ${branches.root} no tiene ramas.`);
  }

  const picked = await vscode.window.showQuickPick(
    unique.map(name => ({
      label: name,
      description: name === branches.current ? "rama actual" : undefined,
    })),
    {
      title: `La rama "${configured}" no existe en este repo`,
      placeHolder: "Elige la rama base para crear la nueva rama",
    }
  );
  if (!picked) {
    return undefined;
  }

  await vscode.workspace.getConfiguration("trelloBranch")
    .update("baseBranch", picked.label, vscode.ConfigurationTarget.Workspace);
  trace(`Base guardada para este workspace: ${picked.label}`);
  return picked.label;
}

function buildPrBody(active: ActiveTask) {
  const meta = parseCardMeta(active.cardDesc ?? "");
  const descripcion = descriptionForPr(active.cardDesc ?? "");
  const modulo = sanitizeForPr(meta.modulo ?? "", meta.empresa);
  const submodulo = sanitizeForPr(meta.submodulo ?? "", meta.empresa);
  const cardName = sanitizeForPr(active.cardName, meta.empresa) || active.cardName;
  return sanitizeForPr(
    [
      `## Summary`,
      `- ${cardName}`,
      modulo && submodulo ? `- Module: ${modulo} → ${submodulo}` : undefined,
      "",
      descripcion ? `## Description\n\n${descripcion}` : undefined,
      "",
      "## Test plan",
      "- [ ] Review the PR diff",
      "- [ ] Test the affected flow",
    ]
      .filter(line => line !== undefined)
      .join("\n"),
    meta.empresa
  );
}

export function activate(context: vscode.ExtensionContext) {
  const { secrets, workspaceState, globalState } = context;
  const treeProvider = new TrelloTreeProvider(context);
  const treeView = vscode.window.createTreeView("trelloBranch.tasks", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  trace("Extensión activada.");

  const login = vscode.commands.registerCommand("trelloBranch.login", async () => {
    trace("Comando: Iniciar sesión");
    try {
      const member = await loginWithTrello(secrets);
      if (!member) {
        return;
      }
      trace(`Sesión iniciada: ${member.fullName} (@${member.username})`);
      treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Conectado como ${member.fullName} (@${member.username})`
      );
    } catch (error) {
      reportError("No se pudo iniciar sesión", error);
    }
  });

  const logout = vscode.commands.registerCommand("trelloBranch.logout", async () => {
    trace("Comando: Cerrar sesión");
    await clearStoredToken(secrets);
    treeProvider.refresh();
    vscode.window.showInformationMessage("Sesión de Trello cerrada.");
  });

  const githubLogin = vscode.commands.registerCommand(
    "trelloBranch.githubLogin",
    async () => {
      trace("Comando: GitHub iniciar sesión");
      try {
        const user = await loginWithGithub();
        if (!user) {
          return;
        }
        trace(`Sesión GitHub: ${user.name} (@${user.login})`);
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `GitHub conectado como ${user.name} (@${user.login})`
        );
      } catch (error) {
        reportError("No se pudo iniciar sesión en GitHub", error);
      }
    }
  );

  const githubLogout = vscode.commands.registerCommand(
    "trelloBranch.githubLogout",
    async () => {
      trace("Comando: GitHub cerrar sesión");
      treeProvider.refresh();
      vscode.window.showInformationMessage(
        "GitHub se cierra desde Cuentas del editor (esquina inferior) → GitHub → Sign Out."
      );
    }
  );

  const addBoard = vscode.commands.registerCommand("trelloBranch.addBoard", async () => {
    trace("Comando: Agregar tablero");
    const session = await requireSession(secrets);
    if (!session) {
      return;
    }
    const trelloBoards = await loadTrelloBoards(session.token);
    if (!trelloBoards) {
      return;
    }
    const catalog = await syncBoardCatalog(globalState, trelloBoards);
    const unused = unusedTrelloBoards(trelloBoards, catalog);
    if (unused.length === 0) {
      vscode.window.showInformationMessage("No hay más tableros de Trello para agregar.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      unused.map(board => ({ label: board.name, id: board.id })),
      { title: "Agregar tablero", placeHolder: "Elige un tablero de Trello" }
    );
    if (!picked) {
      return;
    }
    await addCatalogBoard(globalState, { id: picked.id, name: picked.label });
    trace(`Tablero agregado: ${picked.label} (${picked.id})`);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Tablero agregado: ${picked.label}`);
  });

  const linkBoard = vscode.commands.registerCommand(
    "trelloBranch.linkBoard",
    async (boardKey?: string) => {
      trace("Comando: Vincular tablero");
      const session = await requireSession(secrets);
      if (!session || !boardKey) {
        return;
      }
      const catalog = readBoardCatalog(globalState);
      const entry = catalog.find(board => board.key === boardKey);
      if (!entry) {
        return;
      }
      const picked = await pickTrelloBoard(
        session.token,
        `Vincular ${entry.name}`,
        catalog.map(board => board.id).filter((id): id is string => Boolean(id))
      );
      if (!picked) {
        return;
      }
      await linkCatalogBoard(globalState, boardKey, picked);
      treeProvider.refresh();
      vscode.window.showInformationMessage(`${entry.name} vinculado a ${picked.name}`);
    }
  );

  const removeBoard = vscode.commands.registerCommand(
    "trelloBranch.removeBoard",
    async (boardKey?: string) => {
      if (!boardKey) {
        return;
      }
      await removeCatalogBoard(globalState, boardKey);
      treeProvider.refresh();
      vscode.window.showInformationMessage("Tablero quitado de la extensión.");
    }
  );

  const setCompanionRepo = vscode.commands.registerCommand(
    "trelloBranch.setCompanionRepo",
    async () => {
      trace("Comando: Configurar repo companion");
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) {
        vscode.window.showErrorMessage("No hay carpeta de proyecto abierta.");
        return;
      }

      let currentRoot: string;
      try {
        currentRoot = (await getRepoBranches(workspacePath)).root;
      } catch (error) {
        reportError("No se pudo resolver el repo actual", error);
        return;
      }

      const picked = await pickAndSaveCompanionPath(globalState, currentRoot);
      if (!picked) {
        return;
      }

      try {
        await validateCompanionRepo(picked);
      } catch (error) {
        await clearCompanionPath(globalState, currentRoot);
        reportError("Companion inválido", error);
        return;
      }

      treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Companion guardado para ${repoLabel(currentRoot)}: ${picked}`
      );
    }
  );

  const clearCompanionRepo = vscode.commands.registerCommand(
    "trelloBranch.clearCompanionRepo",
    async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) {
        return;
      }
      let currentRoot: string;
      try {
        currentRoot = (await getRepoBranches(workspacePath)).root;
      } catch {
        return;
      }
      await clearCompanionPath(globalState, currentRoot);
      treeProvider.refresh();
      vscode.window.showInformationMessage("Companion eliminado para este repo.");
    }
  );

  const startTaskHandler = async (
    selected?: string | { cardId?: string; listId?: string }
  ) => {
    trace("Comando: Empezar tarea");
    const config = vscode.workspace.getConfiguration("trelloBranch");
    const selectedCardId =
      typeof selected === "string" ? selected : selected?.cardId;
    let listId = typeof selected === "object" ? selected?.listId : undefined;

    const session = await requireSession(secrets);
    if (!session) {
      return;
    }

    const { token, member } = session;
    const developer = resolveDeveloperName(member, config.get<string>("developerName"));
    trace(`Usuario: ${member.fullName} (@${member.username}) → prefijo rama: ${developer}`);

    const trelloBoards = await loadTrelloBoards(token);
    if (!trelloBoards) {
      return;
    }
    const catalog = await syncBoardCatalog(globalState, trelloBoards);
    const linked = catalog.filter(board => board.id);

    if (!listId) {
      if (linked.length === 0) {
        vscode.window.showWarningMessage(
          "Vincula BUGS o NUEVAS FUNCIONALIDADES, o agrega un tablero."
        );
        return;
      }
      const boardItem =
        linked.length === 1
          ? { label: linked[0].name, id: linked[0].id as string }
          : await vscode.window.showQuickPick(
              linked.map(board => ({
                label: board.name,
                description: board.builtin ? "por defecto" : "agregado",
                id: board.id as string,
              })),
              {
                title: "Tablero",
                placeHolder: "Elige el tablero de la tarea",
              }
            );
      if (!boardItem) {
        return;
      }
      let cardsForBoard;
      try {
        cardsForBoard = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Cargando tus tareas asignadas...",
          },
          () =>
            getAssignedCardsForBoard(
              TRELLO_APP_KEY,
              token,
              boardItem.id,
              member.id
            )
        );
      } catch (error) {
        reportError("No se pudieron obtener las tareas", error);
        return;
      }
      listId = cardsForBoard.originList?.id;
      const cards = cardsForBoard.cards;
      trace(`Tarjetas asignadas en ${boardItem.label}: ${cards.length}`);
      if (!listId || cards.length === 0) {
        vscode.window.showInformationMessage(
          `No hay tareas asignadas a ti en ${boardItem.label}.`
        );
        return;
      }

      const taskItems = cards.map(c => {
        const meta = parseCardMeta(c.desc ?? "");
        const descripcion = sanitizeForPr(meta.descripcion ?? "", meta.empresa);
        const ejemplo = sanitizeForPr(meta.ejemplo ?? "", meta.empresa);
        const detailParts = [
          descripcion ? `Desc: ${descripcion.replace(/\s+/g, " ").slice(0, 140)}` : undefined,
          ejemplo ? `Ej: ${ejemplo.replace(/\s+/g, " ").slice(0, 100)}` : undefined,
          !meta.modulo || !meta.submodulo ? "Sin Modulo/Submodulo" : undefined,
        ].filter(Boolean);
        return {
          label: c.name,
          description: formatMetaLine(meta),
          detail: detailParts.join(" · ") || undefined,
          id: c.id,
          desc: c.desc,
          ruc: c.ruc,
          idList: c.idList ?? listId,
        };
      });
      const pickedCard = selectedCardId
        ? taskItems.find(item => item.id === selectedCardId)
        : await vscode.window.showQuickPick(taskItems, {
            title: `Tus tareas en ${boardItem.label} (${cards.length})`,
            placeHolder: "Selecciona la tarea con la que comenzarás",
            matchOnDescription: true,
            matchOnDetail: true,
          });
      if (!pickedCard) {
        trace(
          selectedCardId
            ? `La tarea ${selectedCardId} ya no está disponible.`
            : "Selección de tarea cancelada."
        );
        if (selectedCardId) {
          vscode.window.showWarningMessage(
            "La tarea ya no está disponible en el tablero seleccionado."
          );
          treeProvider.refresh();
        }
        return;
      }
      await startPickedCard(
        pickedCard,
        pickedCard.idList ?? listId,
        token,
        developer,
        globalState,
        workspaceState,
        treeProvider
      );
      return;
    }

    let cards;
    try {
      cards = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Cargando tus tareas asignadas...",
        },
        async () => {
          const card = await getCard(TRELLO_APP_KEY, token, selectedCardId!);
          return [card];
        }
      );
    } catch (error) {
      reportError("No se pudieron obtener las tareas", error);
      return;
    }

    const picked = {
      label: cards[0].name,
      id: cards[0].id,
      desc: cards[0].desc,
      ruc: cards[0].ruc,
    };
    await startPickedCard(
      picked,
      listId,
      token,
      developer,
      globalState,
      workspaceState,
      treeProvider
    );
  };

  const startTask = vscode.commands.registerCommand(
    "trelloBranch.startTask",
    startTaskHandler
  );
  const startSelectedTask = vscode.commands.registerCommand(
    "trelloBranch.startSelectedTask",
    startTaskHandler
  );

  const copyCardText = vscode.commands.registerCommand(
    "trelloBranch.copyCardText",
    async (kind?: string, text?: string) => {
      if (!text) {
        return;
      }
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(
        `${kind ?? "Texto"} copiado al portapapeles`
      );
    }
  );

  const previewImage = vscode.commands.registerCommand(
    "trelloBranch.previewCardImage",
    async (payload?: {
      cardId?: string;
      attachmentId?: string;
      name?: string;
      url?: string;
      isUpload?: boolean;
      mimeType?: string;
    }) => {
      if (!payload?.cardId || !payload.attachmentId || !payload.name) {
        return;
      }
      const session = await requireSession(secrets);
      if (!session) {
        return;
      }
      await previewCardImage({
        apiKey: TRELLO_APP_KEY,
        token: session.token,
        cardId: payload.cardId,
        attachmentId: payload.attachmentId,
        name: payload.name,
        url: payload.url,
        isUpload: payload.isUpload,
        mimeType: payload.mimeType,
      });
    }
  );

  const finishTask = vscode.commands.registerCommand(
    "trelloBranch.finishTask",
    async (payload?: { cardId?: string }) => {
    trace("Comando: Terminar tarea");
    const config = vscode.workspace.getConfiguration("trelloBranch");
    const baseBranch = config.get<string>("baseBranch") || "develop";

    const session = await requireSession(secrets);
    if (!session) {
      return;
    }
    const { token } = session;

    const openTasks = getActiveTasks(globalState, workspaceState);
    const pickedTask = payload?.cardId
      ? openTasks.find(task => task.cardId === payload.cardId)
      : await pickOpenTask(openTasks, "Terminar tarea");
    if (!pickedTask) {
      vscode.window.showInformationMessage(
        openTasks.length
          ? "No se eligió ninguna tarea."
          : "No hay una tarea iniciada con la extensión. Empieza una con \"Trello: Empezar tarea\"."
      );
      return;
    }
    let active: ActiveTask = pickedTask;

    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspacePath) {
      vscode.window.showErrorMessage("No hay carpeta de proyecto abierta.");
      return;
    }

    let currentRoot: string;
    try {
      currentRoot = (await getRepoBranches(workspacePath)).root;
    } catch (error) {
      reportError("No se pudo resolver el repo de esta ventana", error);
      return;
    }

    const alreadyHere = findActiveRepo(active, currentRoot);
    if (alreadyHere && alreadyHere.status !== "pending") {
      vscode.window.showInformationMessage(
        `Este repo (${alreadyHere.label}) ya está ${alreadyHere.status}` +
          (alreadyHere.prUrl ? `: ${alreadyHere.prUrl}` : ".")
      );
      return;
    }

    let companionRoot: string | undefined;
    const savedCompanion = getCompanionPath(globalState, currentRoot);
    if (savedCompanion) {
      try {
        companionRoot = await validateCompanionRepo(savedCompanion);
      } catch (error) {
        trace(`Companion no usable: ${errorMessage(error)}`);
        vscode.window.showWarningMessage(
          `No se pudo usar el companion: ${errorMessage(error)}. Se revisa solo este repo.`
        );
      }
    }

    let scans: RepoScan[];
    try {
      scans = await listFinishCandidates(currentRoot, companionRoot);
    } catch (error) {
      reportError("No se pudieron revisar los repos", error);
      return;
    }

    const closed = active.repos.filter(
      r => r.status === "done" || r.status === "skipped"
    );
    const openScans = scans.filter(
      scan => !closed.some(r => sameRepoRoot(r.root, scan.root))
    );

    if (openScans.length === 0) {
      vscode.window.showInformationMessage(
        "No hay repos pendientes por cerrar en esta tarea."
      );
      return;
    }

    const selectedRoots = await confirmReposToClose(openScans);
    if (!selectedRoots) {
      return;
    }

    const nextRepos: ActiveRepo[] = [
      ...closed,
      ...openScans.map(scan => ({
        root: scan.root,
        label: scan.label,
        status:
          selectedRoots.has(path.resolve(scan.root)) && scan.hasChanges
            ? ("pending" as const)
            : ("skipped" as const),
      })),
    ];
    active = { ...active, repos: nextRepos };
    await saveActiveTask(globalState, active, workspaceState);
    treeProvider.refresh();

    const activeRepo = findActiveRepo(active, currentRoot);
    if (!activeRepo) {
      vscode.window.showWarningMessage(
        `Esta ventana (${repoLabel(currentRoot)}) no quedó en el cierre de "${active.cardName}".`
      );
      return;
    }

    if (activeRepo.status === "skipped") {
      trace(`Repo omitido en esta ventana: ${activeRepo.label}`);
    } else {
      const others = getActiveTasks(globalState, workspaceState).filter(
        task => task.cardId !== active.cardId
      );
      if (others.length) {
        const go = await vscode.window.showWarningMessage(
          `Hay ${others.length} tarea(s) más en curso. Este cierre es solo de "${active.cardName}". ` +
            `Los cambios actuales de este repo irán a su rama.`,
          "Seguir",
          "Cancelar"
        );
        if (go !== "Seguir") {
          return;
        }
      }

      let github: Awaited<ReturnType<typeof requireGithubSession>>;
      try {
        github = await requireGithubSession();
      } catch (error) {
        reportError("No se pudo usar GitHub del editor", error);
        return;
      }
      if (!github) {
        return;
      }

      let branchName: string | undefined;
      try {
        const currentBranches = await getRepoBranches(currentRoot);
        branchName = await resolveBranchName(
          active.branchName,
          currentRoot,
          currentBranches,
          github.token
        );
      } catch (error) {
        if (error instanceof GithubAuthError) {
          await loginWithGithub({ forceNewSession: true }).catch(() => undefined);
        }
        reportError("No se pudo comprobar si la rama ya tiene un PR", error);
        return;
      }
      if (!branchName) {
        trace("Creación de rama cancelada al terminar.");
        return;
      }
      if (branchName !== active.branchName) {
        active = { ...active, branchName };
        await saveActiveTask(globalState, active, workspaceState);
        trace(`Nombre de rama actualizado: ${branchName}`);
      }

      try {
        const branchAction = await ensureTaskBranch(currentRoot, branchName);
        trace(
          branchAction === "created"
            ? `Rama creada: ${branchName} en ${currentRoot}`
            : `Rama ocupada: ${branchName} en ${currentRoot} (${branchAction})`
        );
      } catch (error) {
        reportError("No se pudo usar la rama de la tarea", error);
        return;
      }

      let review;
      try {
        review = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Code review en ${activeRepo.label}...`,
          },
          () => runProjectCodeReview(currentRoot)
        );
      } catch (error) {
        reportError("No se pudo ejecutar el code review", error);
        return;
      }

      trace(
        `Code review (${review.runner.label}): ${review.runner.shellCommand} → exit ${review.exitCode}`
      );

      if (!review.ok) {
        vscode.window.showErrorMessage(
          `Code review falló en ${activeRepo.label} (${review.runner.label}). ` +
            `Si el error es "Premature close", reintenta; suele ser un corte temporal de la API.`
        );
        return;
      }

      const decision = await vscode.window.showQuickPick(
        [
          {
            label: "Aprobar → commit + push + PR",
            description: active.branchName,
            detail: `Code review OK en ${activeRepo.label}. PR hacia ${baseBranch}`,
            action: "approve" as const,
          },
          {
            label: "Cancelar",
            action: "cancel" as const,
          },
        ],
        {
          title: "Code review OK",
          placeHolder: "Confirma para crear commit, push y PR en este repo",
        }
      );
      if (decision?.action !== "approve") {
        return;
      }

      const taskSnapshot = active;

      let prUrl: string | undefined;
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Commit, push y PR en ${activeRepo.label}...`,
          },
          async () => {
            const staged = await stageAllChanges(currentRoot);
            const commitMessage = await buildCommitFromDiff(
              staged,
              currentRoot
            );
            await commitStaged(currentRoot, commitMessage);
            trace(
              `Commit creado en ${taskSnapshot.branchName} (${activeRepo.label}): ${commitMessage.split("\n")[0]}`
            );
            await pushBranch(currentRoot, taskSnapshot.branchName);
            trace(`Push de ${taskSnapshot.branchName}`);

            prUrl = await createPullRequest({
              repoPath: currentRoot,
              githubToken: github.token,
              baseBranch,
              headBranch: taskSnapshot.branchName,
              title: taskSnapshot.cardName,
              body: buildPrBody(taskSnapshot),
            });
            trace(`PR creado: ${prUrl}`);
          }
        );
      } catch (error) {
        if (error instanceof GithubAuthError) {
          await loginWithGithub({ forceNewSession: true }).catch(() => undefined);
        }
        reportError("No se pudo completar commit/push/PR", error);
        return;
      }

      active = await updateActiveRepo(
        globalState,
        taskSnapshot,
        currentRoot,
        {
          status: "done",
          prUrl,
        },
        workspaceState
      );

      if (prUrl?.startsWith("http")) {
        vscode.window.showInformationMessage(`PR creado: ${prUrl}`, "Abrir").then(action => {
          if (action === "Abrir" && prUrl) {
            vscode.env.openExternal(vscode.Uri.parse(prUrl));
          }
        });
      }
    }

    treeProvider.refresh();

    if (!allReposClosed(active)) {
      const pending = pendingRepoLabels(active).join(", ");
      vscode.window.showInformationMessage(
        `${activeRepo.label}: ${activeRepo.status}. Falta cerrar: ${pending}. ` +
          `Abre esa ventana y usa "Trello: Terminar tarea".`
      );
      return;
    }

    let finishComment: string | undefined;
    try {
      finishComment = await buildFinishCardComment(active.repos, baseBranch);
    } catch (error) {
      trace(`No se pudo armar el comentario de Trello: ${errorMessage(error)}`);
    }

    let movedTo: string | undefined;
    try {
      const card = await getCard(TRELLO_APP_KEY, token, active.cardId);
      const moved = await moveCardToNextList(
        TRELLO_APP_KEY, token, active.cardId, card.idList
      );
      movedTo = moved.to.name;
      trace(`Tarjeta movida: ${moved.from.name} → ${moved.to.name}`);
    } catch (error) {
      reportError("No se pudo mover la tarjeta", error);
      return;
    }

    if (finishComment) {
      try {
        await commentOnCard(
          TRELLO_APP_KEY,
          token,
          active.cardId,
          finishComment
        );
        trace(`Comentario en tarjeta: ${finishComment.replace(/\n/g, " | ")}`);
      } catch (error) {
        reportError("No se pudo comentar la tarjeta", error);
      }
    }

    const stillOpen = getActiveTasks(globalState, workspaceState).filter(
      task => task.cardId !== active.cardId
    );
    for (const repo of active.repos.filter(r => r.status === "done")) {
      try {
        await checkoutBranch(repo.root, baseBranch);
        trace(`Checkout a ${baseBranch} en ${repo.root}`);
      } catch (error) {
        reportError(
          `No se pudo volver a ${baseBranch} en ${repo.label}`,
          error
        );
      }
    }

    const prSummary = active.repos
      .filter(r => r.prUrl)
      .map(r => `${r.label}: ${r.prUrl}`)
      .join(" · ");

    await removeActiveTask(globalState, workspaceState, active.cardId);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      `Tarea terminada. Tarjeta en "${movedTo}".` +
        (prSummary ? ` PRs: ${prSummary}` : "") +
        (stillOpen.length
          ? ` Siguen en curso: ${stillOpen.map(t => t.cardName).join(", ")}.`
          : "")
    );
  });

  const returnTask = vscode.commands.registerCommand(
    "trelloBranch.returnTask",
    async (payload?: { cardId?: string }) => {
      trace("Comando: Regresar tarea");
      const session = await requireSession(secrets);
      if (!session) {
        return;
      }

      const openTasks = getActiveTasks(globalState, workspaceState);
      const active = payload?.cardId
        ? openTasks.find(task => task.cardId === payload.cardId)
        : await pickOpenTask(openTasks, "Regresar tarea");
      if (!active) {
        vscode.window.showInformationMessage(
          openTasks.length
            ? "No se eligió ninguna tarea."
            : "No hay una tarea activa para regresar."
        );
        return;
      }

      try {
        const card = await getCard(TRELLO_APP_KEY, session.token, active.cardId);
        let movedTo: string;
        if (active.originListId && active.originListId !== card.idList) {
          await moveCard(
            TRELLO_APP_KEY,
            session.token,
            active.cardId,
            active.originListId
          );
          try {
            movedTo = (await getList(
              TRELLO_APP_KEY,
              session.token,
              active.originListId
            )).name;
          } catch {
            movedTo = "lista de origen";
          }
          trace(`Tarjeta devuelta a ${movedTo} (${active.originListId})`);
        } else {
          const moved = await moveCardToPreviousList(
            TRELLO_APP_KEY,
            session.token,
            active.cardId,
            card.idList
          );
          movedTo = moved.to.name;
          trace(`Tarjeta movida: ${moved.from.name} → ${moved.to.name}`);
        }

        await removeActiveTask(globalState, workspaceState, active.cardId);
        treeProvider.refresh();
        const remaining = getActiveTasks(globalState, workspaceState);
        vscode.window.showInformationMessage(
          `Tarea regresada a "${movedTo}". Ya no está activa.` +
            (remaining.length
              ? ` Siguen en curso: ${remaining.map(t => t.cardName).join(", ")}.`
              : "")
        );
      } catch (error) {
        reportError("No se pudo regresar la tarjeta", error);
      }
    }
  );

  const showLog = vscode.commands.registerCommand("trelloBranch.showLog", () => log.show());
  const refreshView = vscode.commands.registerCommand(
    "trelloBranch.refreshView",
    () => treeProvider.refresh()
  );

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(event => {
      if (event.provider.id === GITHUB_AUTH_PROVIDER) {
        treeProvider.refresh();
      }
    }),
    login,
    logout,
    githubLogin,
    githubLogout,
    addBoard,
    linkBoard,
    removeBoard,
    setCompanionRepo,
    clearCompanionRepo,
    startTask,
    startSelectedTask,
    copyCardText,
    previewImage,
    finishTask,
    returnTask,
    showLog,
    refreshView,
    treeView,
    log
  );
}
