import * as vscode from "vscode";
import { getStoredToken, TRELLO_APP_KEY } from "./auth";
import { formatMetaLine, parseCardMeta } from "./cardMeta";
import { getActiveTask, repoLabel } from "./taskState";
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
  getAssignedCards,
  getCard,
  getCardImageAttachments,
  getList,
  getMe,
  TrelloAttachment,
  TrelloCard,
} from "./trello";

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
  const descripcion = meta.descripcion ?? "Sin descripción";
  const ejemplo = meta.ejemplo ?? "Sin ejemplo";
  const metaLine = formatMetaLine(meta) ?? "Sin módulo/submódulo";

  return [
    infoNode(metaLine, "symbol-namespace", metaLine),
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
      card.id
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

      const active = getActiveTask(
        this.context.globalState,
        this.context.workspaceState
      );
      let activeNode: TrelloNode;
      if (active) {
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
          const node = infoNode(
            label,
            repoStatusIcon(repo.status),
            repo.prUrl || repo.root
          );
          return node;
        });

        activeNode = new TrelloNode(
          `En curso: ${active.cardName}`,
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
              "Terminar tarea",
              "trelloBranch.finishTask",
              "pass-filled"
            ),
          ]
        );
        activeNode.description =
          formatMetaLine(meta) ?? "Sin módulo/submódulo";
      } else {
        activeNode = new TrelloNode(
          "Sin tarea activa",
          vscode.TreeItemCollapsibleState.None
        );
      }
      activeNode.iconPath = new vscode.ThemeIcon(
        active ? "play-circle" : "circle-outline"
      );

      const listId = vscode.workspace
        .getConfiguration("trelloBranch")
        .get<string>("listId");
      if (!listId) {
        return [
          account,
          ...(companionNode ? [companionNode] : []),
          activeNode,
          actionNode(
            "Seleccionar tablero y lista",
            "trelloBranch.selectList",
            "list-selection"
          ),
        ];
      }

      const [list, cards] = await Promise.all([
        getList(TRELLO_APP_KEY, token, listId),
        getAssignedCards(TRELLO_APP_KEY, token, listId, member.id),
      ]);

      const listNode = new TrelloNode(
        list.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        [
          actionNode(
            "Cambiar lista",
            "trelloBranch.selectList",
            "list-selection"
          ),
        ]
      );
      listNode.description = "Lista de origen";
      listNode.iconPath = new vscode.ThemeIcon("list-unordered");

      const tasksNode = new TrelloNode(
        `Mis tareas (${cards.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        cards.length
          ? cards.map(taskNode)
          : [
              actionNode(
                "No hay tareas asignadas — actualizar",
                "trelloBranch.refreshView",
                "refresh"
              ),
            ]
      );
      tasksNode.iconPath = new vscode.ThemeIcon("checklist");

      return [account, ...(companionNode ? [companionNode] : []), activeNode, listNode, tasksNode];
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
