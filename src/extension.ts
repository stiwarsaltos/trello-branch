import * as path from "path";
import * as vscode from "vscode";
import {
  clearStoredToken,
  loginWithTrello,
  requireSession,
  resolveDeveloperName,
  TRELLO_APP_KEY,
} from "./auth";
import { getAssignedCards, getBoards, getCard, getLists, moveCardToNextList } from "./trello";
import {
  branchExists,
  checkoutBranch,
  commitAllChanges,
  createLocalBranch,
  createPullRequest,
  getChangeSummary,
  getRepoBranches,
  hasBase,
  pushBranch,
  RepoBranches,
} from "./github";
import {
  ActiveRepo,
  ActiveTask,
  allReposClosed,
  clearActiveTask,
  findActiveRepo,
  getActiveTask,
  pendingRepoLabels,
  repoLabel,
  saveActiveTask,
  updateActiveRepo,
} from "./taskState";
import { TrelloTreeProvider } from "./treeView";
import { formatMetaLine, parseCardMeta } from "./cardMeta";
import { runProjectCodeReview } from "./codeReview";
import { previewCardImage } from "./imagePreview";
import { resolveCodeReviewRunner } from "./projectManifest";

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

async function pickListId(token: string) {
  let boards;
  try {
    boards = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Cargando tableros de Trello..." },
      () => getBoards(TRELLO_APP_KEY, token)
    );
  } catch (error) {
    reportError("No se pudieron obtener los tableros", error);
    return undefined;
  }

  trace(`Tableros recibidos: ${boards.length}`);
  if (boards.length === 0) {
    vscode.window.showInformationMessage("No se encontraron tableros en tu cuenta de Trello.");
    return undefined;
  }

  const pickedBoard = await vscode.window.showQuickPick(
    boards.map(b => ({ label: b.name, id: b.id })),
    { title: "Paso 1 de 2: tablero", placeHolder: "Elige el tablero de Trello" }
  );
  if (!pickedBoard) {
    trace("Selección de tablero cancelada.");
    return undefined;
  }
  trace(`Tablero elegido: ${pickedBoard.label} (${pickedBoard.id})`);

  let lists;
  try {
    lists = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Cargando listas..." },
      () => getLists(TRELLO_APP_KEY, token, pickedBoard.id)
    );
  } catch (error) {
    reportError("No se pudieron obtener las listas", error);
    return undefined;
  }

  trace(`Listas recibidas: ${lists.length}`);
  if (lists.length === 0) {
    vscode.window.showInformationMessage(`El tablero "${pickedBoard.label}" no tiene listas.`);
    return undefined;
  }

  const pickedList = await vscode.window.showQuickPick(
    lists.map(l => ({ label: l.name, description: l.id, id: l.id })),
    { title: "Paso 2 de 2: lista", placeHolder: `Elige la lista de ${pickedBoard.label}` }
  );
  if (!pickedList) {
    trace("Selección de lista cancelada.");
    return undefined;
  }

  await vscode.workspace.getConfiguration("trelloBranch")
    .update("listId", pickedList.id, vscode.ConfigurationTarget.Global);
  trace(`Lista guardada: ${pickedList.label} (${pickedList.id})`);
  vscode.window.showInformationMessage(`Lista guardada: ${pickedList.label}`);
  return pickedList.id;
}

const BRANCH_NAME_PATTERN = /^(?!\/|.*\.\.|.*\/\/|.*@\{|.*\\)[^\s~^:?*\[\\]+(?<!\.|\/)$/;

function branchExistsAnywhere(lists: RepoBranches[], name: string) {
  return lists.some(b => branchExists(b, name));
}

async function resolveBranchName(
  defaultName: string,
  branchLists: RepoBranches[]
): Promise<string | undefined> {
  if (!branchExistsAnywhere(branchLists, defaultName)) {
    return defaultName;
  }

  trace(`La rama "${defaultName}" ya existe; pidiendo nombre alternativo.`);

  while (true) {
    const proposed = await vscode.window.showInputBox({
      title: `La rama "${defaultName}" ya existe`,
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
        if (branchExistsAnywhere(branchLists, name)) {
          return `La rama "${name}" ya existe (local o en origin).`;
        }
        return undefined;
      },
    });

    if (proposed === undefined) {
      return undefined;
    }

    const name = proposed.trim();
    if (
      !branchExistsAnywhere(branchLists, name) &&
      BRANCH_NAME_PATTERN.test(name)
    ) {
      return name;
    }
  }
}

async function pickTaskScope(currentRoot: string, companionPath: string) {
  const currentLabel = repoLabel(currentRoot);
  const items: Array<{
    label: string;
    description?: string;
    roots: string[];
  }> = [
    {
      label: `Solo este repo (${currentLabel})`,
      description: currentRoot,
      roots: [currentRoot],
    },
  ];

  if (companionPath) {
    items.push({
      label: "Este + companion (API y cliente)",
      description: companionPath,
      roots: [currentRoot, companionPath],
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "Alcance de la tarea",
    placeHolder: companionPath
      ? "¿Trabajas solo aquí o también en el companion?"
      : "Configura trelloBranch.companionRepoPath para usar ambos repos",
  });
  return picked?.roots;
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
  return [
    `## Summary`,
    `- ${active.cardName}`,
    meta.modulo && meta.submodulo
      ? `- Módulo: ${meta.modulo} → ${meta.submodulo}`
      : undefined,
    "",
    meta.descripcion ? `## Descripción\n\n${meta.descripcion}` : undefined,
    meta.ejemplo ? `## Ejemplo\n\n${meta.ejemplo}` : undefined,
    "",
    "## Test plan",
    "- [ ] Revisar el diff del PR",
    "- [ ] Probar el flujo afectado",
  ]
    .filter(line => line !== undefined)
    .join("\n");
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

  const selectList = vscode.commands.registerCommand("trelloBranch.selectList", async () => {
    trace("Comando: Seleccionar lista");
    const session = await requireSession(secrets);
    if (!session) {
      return;
    }
    await pickListId(session.token);
    treeProvider.refresh();
  });

  const startTaskHandler = async (selectedCardId?: string) => {
    trace("Comando: Empezar tarea");
    const config = vscode.workspace.getConfiguration("trelloBranch");
    let listId = config.get<string>("listId");

    const session = await requireSession(secrets);
    if (!session) {
      return;
    }

    const { token, member } = session;
    const developer = resolveDeveloperName(member, config.get<string>("developerName"));
    trace(`Usuario: ${member.fullName} (@${member.username}) → prefijo rama: ${developer}`);

    const existing = getActiveTask(globalState, workspaceState);
    if (existing) {
      const action = await vscode.window.showWarningMessage(
        `Ya hay una tarea en curso: "${existing.cardName}".`,
        "Continuar igual",
        "Cancelar"
      );
      if (action !== "Continuar igual") {
        return;
      }
    }

    if (!listId || listId === "your-list-id") {
      trace("Sin listId configurado: pidiendo tablero y lista.");
      listId = await pickListId(token);
      if (!listId) {
        return;
      }
    }

    let cards;
    try {
      cards = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Cargando tus tareas asignadas...",
        },
        () => getAssignedCards(TRELLO_APP_KEY, token, listId!, member.id)
      );
    } catch (error) {
      reportError("No se pudieron obtener las tareas", error);
      return;
    }

    trace(`Tarjetas asignadas a ti: ${cards.length}`);
    if (cards.length === 0) {
      const action = await vscode.window.showInformationMessage(
        "No hay tareas asignadas a ti en esta lista.",
        "Elegir otra lista"
      );
      if (action) {
        await vscode.commands.executeCommand("trelloBranch.selectList");
      }
      return;
    }

    const taskItems = cards.map(c => {
      const meta = parseCardMeta(c.desc ?? "");
      const detailParts = [
        meta.descripcion ? `Desc: ${meta.descripcion.replace(/\s+/g, " ").slice(0, 140)}` : undefined,
        meta.ejemplo ? `Ej: ${meta.ejemplo.replace(/\s+/g, " ").slice(0, 100)}` : undefined,
        !meta.modulo || !meta.submodulo ? "Sin Modulo/Submodulo" : undefined,
      ].filter(Boolean);
      return {
        label: c.name,
        description: formatMetaLine(meta),
        detail: detailParts.join(" · ") || undefined,
        id: c.id,
        desc: c.desc,
      };
    });
    const picked = selectedCardId
      ? taskItems.find(item => item.id === selectedCardId)
      : await vscode.window.showQuickPick(taskItems, {
          title: `Tus tareas asignadas (${cards.length})`,
          placeHolder: "Selecciona la tarea con la que comenzarás",
          matchOnDescription: true,
          matchOnDetail: true,
        });
    if (!picked) {
      trace(
        selectedCardId
          ? `La tarea ${selectedCardId} ya no está disponible.`
          : "Selección de tarea cancelada."
      );
      if (selectedCardId) {
        vscode.window.showWarningMessage(
          "La tarea ya no está disponible en la lista seleccionada."
        );
        treeProvider.refresh();
      }
      return;
    }
    trace(`Tarea elegida: ${picked.label}`);

    const { modulo, submodulo } = parseCardMeta(picked.desc ?? "");
    if (!modulo || !submodulo) {
      vscode.window.showErrorMessage(
        "La tarjeta debe tener 'Modulo:' y 'Submodulo:' en la descripción."
      );
      return;
    }

    const defaultBranchName =
      `${developer}/${toPascalCase(modulo)}-${toPascalCase(submodulo)}`;
    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspacePath) {
      vscode.window.showErrorMessage("No hay carpeta de proyecto abierta.");
      return;
    }

    try {
      const currentBranches = await getRepoBranches(workspacePath);
      const currentRoot = currentBranches.root;
      trace(`Repo actual: ${currentRoot} | rama: ${currentBranches.current}`);

      const companionSetting =
        config.get<string>("companionRepoPath")?.trim() || "";
      let companionRoot = "";
      if (companionSetting) {
        companionRoot = await validateCompanionRepo(companionSetting);
        if (path.resolve(companionRoot) === path.resolve(currentRoot)) {
          vscode.window.showErrorMessage(
            "trelloBranch.companionRepoPath no puede ser el mismo repo que esta ventana."
          );
          return;
        }
      }

      const scopeRoots = await pickTaskScope(currentRoot, companionRoot);
      if (!scopeRoots?.length) {
        return;
      }

      const configuredBase = config.get<string>("baseBranch") || "develop";
      const branchLists: RepoBranches[] = [];
      const repoPlans: Array<{ root: string; baseBranch: string }> = [];

      for (const root of scopeRoots) {
        const branches = await getRepoBranches(root);
        branchLists.push(branches);
        const baseBranch = await resolveBaseBranch(configuredBase, branches);
        if (!baseBranch) {
          return;
        }
        repoPlans.push({ root: branches.root, baseBranch });
      }

      const branchName = await resolveBranchName(defaultBranchName, branchLists);
      if (!branchName) {
        trace("Creación de rama cancelada (nombre no propuesto).");
        return;
      }

      for (const plan of repoPlans) {
        await createLocalBranch(plan.root, branchName, plan.baseBranch);
        trace(`Rama creada: ${branchName} desde ${plan.baseBranch} en ${plan.root}`);
      }

      try {
        const moved = await moveCardToNextList(
          TRELLO_APP_KEY, token, picked.id, listId!
        );
        trace(`Tarjeta movida: ${moved.from.name} → ${moved.to.name}`);

        const repos: ActiveRepo[] = repoPlans.map(plan => ({
          root: plan.root,
          label: repoLabel(plan.root),
          status: "pending",
        }));

        await saveActiveTask(globalState, {
          cardId: picked.id,
          cardName: picked.label,
          cardDesc: picked.desc ?? "",
          branchName,
          repos,
          startedAt: new Date().toISOString(),
        });
        await workspaceState.update("trelloBranch.activeTask", undefined);
        treeProvider.refresh();

        const repoNames = repos.map(r => r.label).join(" + ");
        vscode.window.showInformationMessage(
          `Rama ${branchName} en ${repoNames}. Tarjeta en "${moved.to.name}".`
        );
      } catch (moveError) {
        reportError(
          `Rama creada (${branchName}), pero no se pudo mover la tarjeta`,
          moveError
        );
      }
    } catch (error) {
      reportError("No se pudo crear la rama", error);
    }
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

  const finishTask = vscode.commands.registerCommand("trelloBranch.finishTask", async () => {
    trace("Comando: Terminar tarea");
    const config = vscode.workspace.getConfiguration("trelloBranch");
    const baseBranch = config.get<string>("baseBranch") || "develop";

    const session = await requireSession(secrets);
    if (!session) {
      return;
    }
    const { token } = session;

    let active = getActiveTask(globalState, workspaceState);
    if (!active) {
      vscode.window.showInformationMessage(
        "No hay una tarea iniciada con la extensión. Empieza una con \"Trello: Empezar tarea\"."
      );
      return;
    }

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

    const activeRepo = findActiveRepo(active, currentRoot);
    if (!activeRepo) {
      vscode.window.showWarningMessage(
        `Esta ventana (${repoLabel(currentRoot)}) no forma parte de la tarea "${active.cardName}". ` +
          `Repos de la tarea: ${active.repos.map(r => r.label).join(", ")}.`
      );
      return;
    }

    if (activeRepo.status !== "pending") {
      vscode.window.showInformationMessage(
        `Este repo (${activeRepo.label}) ya está ${activeRepo.status}` +
          (activeRepo.prUrl ? `: ${activeRepo.prUrl}` : ".")
      );
      return;
    }

    let summary;
    try {
      await checkoutBranch(currentRoot, active.branchName);
      summary = await getChangeSummary(currentRoot);
    } catch (error) {
      reportError("No se pudo revisar los cambios", error);
      return;
    }

    let prUrl: string | undefined;

    if (!summary.hasChanges) {
      const continueEmpty = await vscode.window.showWarningMessage(
        `No hay cambios en ${activeRepo.label}. ¿Marcar este repo como omitido?`,
        "Omitir este repo",
        "Cancelar"
      );
      if (continueEmpty !== "Omitir este repo") {
        return;
      }
      active = await updateActiveRepo(globalState, active, currentRoot, {
        status: "skipped",
      });
      trace(`Repo omitido (sin cambios): ${activeRepo.label}`);
    } else {
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
      const meta = parseCardMeta(taskSnapshot.cardDesc ?? "");
      const commitMessage = [
        taskSnapshot.cardName,
        "",
        meta.descripcion ? meta.descripcion.slice(0, 400) : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Commit, push y PR en ${activeRepo.label}...`,
          },
          async () => {
            await commitAllChanges(currentRoot, commitMessage);
            trace(
              `Commit creado en ${taskSnapshot.branchName} (${activeRepo.label})`
            );
            await pushBranch(currentRoot, taskSnapshot.branchName);
            trace(`Push de ${taskSnapshot.branchName}`);

            prUrl = await createPullRequest({
              repoPath: currentRoot,
              baseBranch,
              headBranch: taskSnapshot.branchName,
              title: taskSnapshot.cardName,
              body: buildPrBody(taskSnapshot),
            });
            trace(`PR creado: ${prUrl}`);
          }
        );
      } catch (error) {
        reportError("No se pudo completar commit/push/PR", error);
        return;
      }

      active = await updateActiveRepo(globalState, taskSnapshot, currentRoot, {
        status: "done",
        prUrl,
      });

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
        `${activeRepo.label} listo. Falta cerrar: ${pending}. ` +
          `Abre esa ventana y usa "Trello: Terminar tarea".`
      );
      return;
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

    for (const repo of active.repos) {
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

    await clearActiveTask(globalState, workspaceState);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      `Tarea terminada. Tarjeta en "${movedTo}".` +
        (prSummary ? ` PRs: ${prSummary}` : "")
    );
  });

  const showLog = vscode.commands.registerCommand("trelloBranch.showLog", () => log.show());
  const refreshView = vscode.commands.registerCommand(
    "trelloBranch.refreshView",
    () => treeProvider.refresh()
  );

  context.subscriptions.push(
    login,
    logout,
    selectList,
    startTask,
    startSelectedTask,
    copyCardText,
    previewImage,
    finishTask,
    showLog,
    refreshView,
    treeView,
    log
  );
}
