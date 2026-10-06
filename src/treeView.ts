import * as vscode from "vscode";
import { getStoredToken, TRELLO_APP_KEY } from "./auth";
import { getGithubEditorSession } from "./githubAuth";
import { formatMetaLine, identificationLabel, parseCardMeta, sanitizeForPr } from "./cardMeta";
import { ActiveTask, getActiveTasks, repoLabel } from "./taskState";
import { getCompanionPath } from "./companionConfig";
import { getRepoBranches } from "./github";

function repoStatusIcon(status: string) {
  if (status === "done") {
    return "pass";
  }
  if (status === "skipped") {
    return "circle-slash";
  }
  return "circle-outline";
}
import {
  getAssignedCardsForBoard,
  getBoards,
  getCard,
  getCardImageAttachments,
  getMe,
  TrelloAttachment,
  TrelloCard,
} from "./trello";
import {
  CatalogBoard,
  syncBoardCatalog,
} from "./boardConfig";

class TrelloNode extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly children: TrelloNode[] = []
  ) {
    super(label, collapsibleState);
  }
}

function actionNode(
  label: string,
  command: string,
  icon: string,
  ...args: unknown[]
) {
  const item = new TrelloNode(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  item.command = { command, title: label, arguments: args };
  return item;
}

function infoNode(label: string, icon: string, tooltip?: string) {
  const item = new TrelloNode(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  if (tooltip) {
    item.tooltip = tooltip;
  }
  return item;
}

function clip(text: string, max = 120) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function copyableTextNode(kind: string, text: string, icon: string) {
  const item = actionNode(
    `${kind}: ${clip(text)}`,
    "trelloBranch.copyCardText",
    icon,
    kind,
    text
  );
  item.tooltip = `${text}\n\nClic para copiar`;
  return item;
}

function cardInfoChildren(desc: string) {
  const meta = parseCardMeta(desc ?? "");
  const descripcion =
    sanitizeForPr(meta.descripcion ?? "", meta.empresa) || "Sin descripción";
  const ejemplo = sanitizeForPr(meta.ejemplo ?? "", meta.empresa) || "Sin ejemplo";
  const metaLine = formatMetaLine(meta) ?? "Sin módulo/submódulo";
  const idLabel = meta.ruc ? identificationLabel(meta.ruc) : "RUC";

  return [
    infoNode(metaLine, "symbol-namespace", metaLine),
    ...(meta.empresa
      ? [copyableTextNode("Empresa", meta.empresa, "organization")]
      : []),
    ...(meta.ruc
      ? [copyableTextNode(idLabel, meta.ruc, "key")]
      : []),
    copyableTextNode("Descripción", descripcion, "note"),
    copyableTextNode("Ejemplo", ejemplo, "lightbulb"),
  ];
}

function imageNodes(cardId: string, images: TrelloAttachment[]) {
  if (images.length === 0) {
    return [infoNode("Sin imágenes adjuntas", "file-media")];
  }

  return [
    new TrelloNode(
      `Imágenes (${images.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
      images.map(image => {
        const item = actionNode(
          image.name || "Imagen",
          "trelloBranch.previewCardImage",
          "file-media",
          {
            cardId,
            attachmentId: image.id,
            name: image.name || "imagen",
            url: image.url,
            isUpload: image.isUpload,
            mimeType: image.mimeType,
          }
        );
        item.tooltip = "Clic para previsualizar";
        return item;
      })
    ),
  ];
}

function taskNode(card: TrelloCard) {
  const meta = parseCardMeta(card.desc ?? "");
  const children: TrelloNode[] = [
    ...cardInfoChildren(card.desc ?? ""),
    actionNode(
      "Empezar esta tarea",
      "trelloBranch.startSelectedTask",
      "play",
      { cardId: card.id, listId: card.idList }
    ),
  ];

  const item = new TrelloNode(
    card.name,
    vscode.TreeItemCollapsibleState.Collapsed,
    children
  );
  item.description = formatMetaLine(meta) ?? "Sin módulo/submódulo";
  item.iconPath = new vscode.ThemeIcon(
    meta.modulo && meta.submodulo ? "issues" : "warning"
  );
  return item;
}

export class TrelloTreeProvider implements vscode.TreeDataProvider<TrelloNode> {
  private readonly changed = new vscode.EventEmitter<TrelloNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh() {
    this.changed.fire(undefined);
  }

  getTreeItem(element: TrelloNode) {
    return element;
  }

  private async githubAccountNode() {
    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await getGithubEditorSession({ silent: true });
    } catch {
      return actionNode(
        "GitHub del editor no disponible — iniciar sesión",
        "trelloBranch.githubLogin",
        "warning"
      );
    }

    if (!session) {
      return actionNode(
        "Iniciar sesión con GitHub",
        "trelloBranch.githubLogin",
        "github"
      );
    }

    const node = new TrelloNode(
      session.account.label,
      vscode.TreeItemCollapsibleState.Collapsed,
      [
        infoNode(`Cuenta del editor: ${session.account.label}`, "github-inverted"),
        actionNode(
          "Cerrar sesión de GitHub",
          "trelloBranch.githubLogout",
          "sign-out"
        ),
      ]
    );
    node.description = "GitHub";
    node.iconPath = new vscode.ThemeIcon("github");
    return node;
  }

  private async activeTaskNode(token: string, active: ActiveTask) {
    let cardDesc = active.cardDesc ?? "";
    let images: TrelloAttachment[] = [];
    try {
      const [card, imageAttachments] = await Promise.all([
        getCard(TRELLO_APP_KEY, token, active.cardId),
        getCardImageAttachments(TRELLO_APP_KEY, token, active.cardId),
      ]);
      cardDesc = card.desc ?? cardDesc;
      images = imageAttachments;
    } catch {
      // Usa la descripción guardada si la API falla.
    }

    const meta = parseCardMeta(cardDesc);
    const repoNodes = active.repos.map(repo => {
      const label =
        repo.status === "done" && repo.prUrl
          ? `${repo.label} — PR`
          : `${repo.label} — ${repo.status}`;
      return infoNode(
        label,
        repoStatusIcon(repo.status),
        repo.prUrl || repo.root
      );
    });

    const item = new TrelloNode(
      active.cardName,
      vscode.TreeItemCollapsibleState.Expanded,
      [
        ...cardInfoChildren(cardDesc),
        infoNode(
          `Rama al terminar: ${active.branchName}`,
          "git-branch",
          `${active.branchName}\nSe crea al terminar, solo en los repos con cambios.`
        ),
        ...(active.repos.length
          ? repoNodes
          : [
              infoNode(
                "Repos: se detectan al terminar (este + companion)",
                "search",
                "Al terminar se listan los repos con cambios para confirmar."
              ),
            ]),
        ...imageNodes(active.cardId, images),
        actionNode(
          "Terminar esta tarea",
          "trelloBranch.finishTask",
          "pass-filled",
          { cardId: active.cardId }
        ),
        actionNode(
          "Regresar esta tarea",
          "trelloBranch.returnTask",
          "discard",
          { cardId: active.cardId }
        ),
      ]
    );
    item.description = formatMetaLine(meta) ?? "Sin módulo/submódulo";
    item.iconPath = new vscode.ThemeIcon("play-circle");
    item.tooltip = `${active.cardName}\n${active.branchName}`;
    return item;
  }

  private async boardNode(
    token: string,
    memberId: string,
    board: CatalogBoard
  ) {
    if (!board.id) {
      const node = new TrelloNode(
        board.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        [
          actionNode(
            "Vincular tablero de Trello",
            "trelloBranch.linkBoard",
            "link",
            board.key
          ),
        ]
      );
      node.description = board.builtin ? "por defecto · sin vincular" : "sin vincular";
      node.iconPath = new vscode.ThemeIcon("warning");
      return node;
    }

    try {
      const { originList, cards } = await getAssignedCardsForBoard(
        TRELLO_APP_KEY,
        token,
        board.id,
        memberId
      );
      const children: TrelloNode[] = [
        ...(originList
          ? [infoNode(`Lista de origen: ${originList.name}`, "list-unordered")]
          : [infoNode("El tablero no tiene listas", "warning")]),
        ...(cards.length
          ? cards.map(taskNode)
          : [
              actionNode(
                "No hay tareas asignadas — actualizar",
                "trelloBranch.refreshView",
                "refresh"
              ),
            ]),
        ...(board.builtin
          ? []
          : [
              actionNode(
                "Quitar tablero",
                "trelloBranch.removeBoard",
                "close",
                board.key
              ),
            ]),
      ];
      const node = new TrelloNode(
        board.name,
        vscode.TreeItemCollapsibleState.Expanded,
        children
      );
      node.description = `${cards.length} tarea(s)`;
      node.iconPath = new vscode.ThemeIcon(
        board.builtin ? "bookmark" : "layout"
      );
      return node;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const node = new TrelloNode(
        board.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        [
          actionNode(
            "No se pudo cargar — reintentar",
            "trelloBranch.refreshView",
            "error"
          ),
        ]
      );
      node.description = "error";
      node.tooltip = message;
      node.iconPath = new vscode.ThemeIcon("error");
      return node;
    }
  }

  async getChildren(element?: TrelloNode): Promise<TrelloNode[]> {
    if (element) {
      return element.children;
    }

    const token = await getStoredToken(this.context.secrets);
    if (!token) {
      return [
        actionNode(
          "Iniciar sesión con Trello",
          "trelloBranch.login",
          "sign-in"
        ),
      ];
    }

    try {
      const member = await getMe(TRELLO_APP_KEY, token);
      const account = new TrelloNode(
        member.fullName,
        vscode.TreeItemCollapsibleState.Collapsed,
        [
          actionNode(
            `@${member.username}`,
            "trelloBranch.showLog",
            "account"
          ),
          actionNode(
            "Cerrar sesión",
            "trelloBranch.logout",
            "sign-out"
          ),
        ]
      );
      account.description = "Trello";
      account.iconPath = new vscode.ThemeIcon("account");

      const githubNode = await this.githubAccountNode();

      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let companionNode: TrelloNode | undefined;
      if (workspacePath) {
        try {
          const currentRoot = (await getRepoBranches(workspacePath)).root;
          const companion = getCompanionPath(
            this.context.globalState,
            currentRoot
          );
          companionNode = new TrelloNode(
            "Repo companion",
            vscode.TreeItemCollapsibleState.Collapsed,
            [
              companion
                ? infoNode(
                    `${repoLabel(companion)}`,
                    "link",
                    companion
                  )
                : infoNode("Sin configurar", "warning"),
              actionNode(
                "Configurar companion",
                "trelloBranch.setCompanionRepo",
                "folder-opened"
              ),
              ...(companion
                ? [
                    actionNode(
                      "Quitar companion",
                      "trelloBranch.clearCompanionRepo",
                      "close"
                    ),
                  ]
                : []),
            ]
          );
          companionNode.iconPath = new vscode.ThemeIcon("repo");
          companionNode.description = companion
            ? repoLabel(companion)
            : "solo este repo";
        } catch {
          // Workspace abierto pero no es git.
        }
      }

      const tasks = getActiveTasks(
        this.context.globalState,
        this.context.workspaceState
      );
      let activeNode: TrelloNode;
      if (tasks.length === 0) {
        activeNode = new TrelloNode(
          "Sin tarea activa",
          vscode.TreeItemCollapsibleState.None
        );
        activeNode.iconPath = new vscode.ThemeIcon("circle-outline");
      } else {
        const taskNodes = await Promise.all(
          tasks.map(task => this.activeTaskNode(token, task))
        );
        activeNode = new TrelloNode(
          `En curso (${tasks.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          taskNodes
        );
        activeNode.iconPath = new vscode.ThemeIcon("play-circle");
      }

      const trelloBoards = await getBoards(TRELLO_APP_KEY, token);
      const catalog = await syncBoardCatalog(this.context.globalState, trelloBoards);
      const boardNodes = await Promise.all(
        catalog.map(board => this.boardNode(token, member.id, board))
      );

      const boardsRoot = new TrelloNode(
        "Tableros",
        vscode.TreeItemCollapsibleState.Expanded,
        [
          ...boardNodes,
          actionNode(
            "Agregar tablero",
            "trelloBranch.addBoard",
            "plus"
          ),
        ]
      );
      boardsRoot.iconPath = new vscode.ThemeIcon("layout");
      boardsRoot.description = `${catalog.length}`;

      return [account, githubNode, ...(companionNode ? [companionNode] : []), activeNode, boardsRoot];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorNode = actionNode(
        "No se pudo cargar Trello — reintentar",
        "trelloBranch.refreshView",
        "error"
      );
      errorNode.tooltip = message;
      return [errorNode];
    }
  }
}
