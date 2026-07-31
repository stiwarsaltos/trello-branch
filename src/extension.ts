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
import { clearActiveTask, getActiveTask, saveActiveTask } from "./taskState";
import { TrelloTreeProvider } from "./treeView";
import { formatMetaLine, parseCardMeta } from "./cardMeta";
import { openCodeReview } from "./codeReview";
import { detectProjectManifest } from "./projectManifest";

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

/** Si la base configurada no existe en el repo, deja elegir otra y la recuerda. */
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

export function activate(context: vscode.ExtensionContext) {
  const { secrets, workspaceState } = context;
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

    const existing = getActiveTask(workspaceState);
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

    const branchName = `${developer}/${toPascalCase(modulo)}-${toPascalCase(submodulo)}`;
    const repoPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!repoPath) {
      vscode.window.showErrorMessage("No hay carpeta de proyecto abierta.");
      return;
    }

    try {
      const branches = await getRepoBranches(repoPath);
      trace(`Repo: ${branches.root} | rama actual: ${branches.current}`);

      const baseBranch = await resolveBaseBranch(
        config.get<string>("baseBranch") || "develop",
        branches
      );
      if (!baseBranch) {
        return;
      }

      await createLocalBranch(repoPath, branchName, baseBranch);
      trace(`Rama creada: ${branchName} desde ${baseBranch} en ${branches.root}`);

      try {
        const moved = await moveCardToNextList(
          TRELLO_APP_KEY, token, picked.id, listId!
        );
        trace(`Tarjeta movida: ${moved.from.name} → ${moved.to.name}`);

        await saveActiveTask(workspaceState, {
          cardId: picked.id,
          cardName: picked.label,
          cardDesc: picked.desc ?? "",
          branchName,
          repoRoot: branches.root,
          startedAt: new Date().toISOString(),
        });
        treeProvider.refresh();

        vscode.window.showInformationMessage(
          `Rama creada: ${branchName}. Tarjeta movida a "${moved.to.name}".`
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

  const finishTask = vscode.commands.registerCommand("trelloBranch.finishTask", async () => {
    trace("Comando: Terminar tarea");
    const config = vscode.workspace.getConfiguration("trelloBranch");
    const baseBranch = config.get<string>("baseBranch") || "develop";

    const session = await requireSession(secrets);
    if (!session) {
      return;
    }
    const { token } = session;

    const active = getActiveTask(workspaceState);
    if (!active) {
      vscode.window.showInformationMessage(
        "No hay una tarea iniciada con la extensión. Empieza una con \"Trello: Empezar tarea\"."
      );
      return;
    }

    const repoPath =
      vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? active.repoRoot;
    if (!repoPath) {
      vscode.window.showErrorMessage("No hay carpeta de proyecto abierta.");
      return;
    }

    let summary;
    try {
      // Asegura estar en la rama de la tarea antes del review/commit.
      await checkoutBranch(repoPath, active.branchName);
      summary = await getChangeSummary(repoPath);
    } catch (error) {
      reportError("No se pudo revisar los cambios", error);
      return;
    }

    if (!summary.hasChanges) {
      const continueEmpty = await vscode.window.showWarningMessage(
        "No hay cambios locales para commit. ¿Continuar solo moviendo la tarjeta y volviendo a develop?",
        "Continuar sin commit",
        "Cancelar"
      );
      if (continueEmpty !== "Continuar sin commit") {
        return;
      }
    } else {
      const manifest = await detectProjectManifest(repoPath);
      if (!manifest) {
        vscode.window.showErrorMessage(
          "No se encontró package.json ni composer.json en la raíz del proyecto. " +
            "El code review requiere uno de los dos."
        );
        return;
      }
      trace(`Manifiesto del proyecto: ${manifest.fileName} (${manifest.kind})`);

      await openCodeReview({
        cardName: active.cardName,
        branchName: active.branchName,
        baseBranch,
        cardDesc: active.cardDesc ?? "",
        summary,
        manifest,
      });

      const decision = await vscode.window.showQuickPick(
        [
          {
            label: "Aprobar review → commit + push + PR",
            description: active.branchName,
            detail: `Crea el PR hacia ${baseBranch}, mueve la tarjeta y vuelve a ${baseBranch}`,
            action: "approve" as const,
          },
          {
            label: "Cancelar",
            action: "cancel" as const,
          },
        ],
        {
          title: "Code review",
          placeHolder: "Revisa el panel de diff y confirma para continuar",
        }
      );
      if (decision?.action !== "approve") {
        return;
      }

      const meta = parseCardMeta(active.cardDesc ?? "");
      const commitMessage = [
        active.cardName,
        "",
        meta.descripcion ? meta.descripcion.slice(0, 400) : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Creando commit, push y PR...",
          },
          async () => {
            await commitAllChanges(repoPath, commitMessage);
            trace(`Commit creado en ${active.branchName}`);
            await pushBranch(repoPath, active.branchName);
            trace(`Push de ${active.branchName}`);

            const prBody = [
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

            const prUrl = await createPullRequest({
              repoPath,
              baseBranch,
              headBranch: active.branchName,
              title: active.cardName,
              body: prBody,
            });
            trace(`PR creado: ${prUrl}`);
            vscode.window.showInformationMessage(`PR creado: ${prUrl}`, "Abrir").then(action => {
              if (action === "Abrir" && prUrl.startsWith("http")) {
                vscode.env.openExternal(vscode.Uri.parse(prUrl));
              }
            });
          }
        );
      } catch (error) {
        reportError("No se pudo completar commit/push/PR", error);
        return;
      }
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

    try {
      await checkoutBranch(repoPath, baseBranch);
      trace(`Checkout a ${baseBranch} en ${repoPath}`);
    } catch (error) {
      reportError(
        `Tarjeta movida a "${movedTo}", pero no se pudo volver a ${baseBranch}`,
        error
      );
      return;
    }

    await clearActiveTask(workspaceState);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      `Tarea terminada. Tarjeta en "${movedTo}". Estás en ${baseBranch}.`
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
    finishTask,
    showLog,
    refreshView,
    treeView,
    log
  );
}
