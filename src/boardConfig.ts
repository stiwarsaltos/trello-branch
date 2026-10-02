import * as vscode from "vscode";
import { TrelloBoard } from "./trello";

export type CatalogBoard = {
  key: string;
  name: string;
  id?: string;
  builtin: boolean;
};

const BOARDS_KEY = "trelloBranch.catalogBoards";

export const DEFAULT_BOARD_NAMES = ["BUGS", "NUEVAS FUNCIONALIDADES"] as const;

export function normalizeBoardName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function builtinKey(name: string) {
  return `builtin:${normalizeBoardName(name)}`;
}

export function defaultCatalog(): CatalogBoard[] {
  return DEFAULT_BOARD_NAMES.map(name => ({
    key: builtinKey(name),
    name,
    builtin: true,
  }));
}

export function readBoardCatalog(
  globalState: vscode.Memento
): CatalogBoard[] {
  const saved = globalState.get<CatalogBoard[]>(BOARDS_KEY) ?? [];
  const extras = saved.filter(board => !board.builtin && board.id);
  const builtins = defaultCatalog().map(entry => {
    const previous = saved.find(
      board =>
        board.key === entry.key ||
        (board.builtin &&
          normalizeBoardName(board.name) === normalizeBoardName(entry.name))
    );
    return {
      ...entry,
      id: previous?.id,
    };
  });
  return [...builtins, ...extras];
}

export async function saveBoardCatalog(
  globalState: vscode.Memento,
  boards: CatalogBoard[]
) {
  await globalState.update(BOARDS_KEY, boards);
}

export async function syncBoardCatalog(
  globalState: vscode.Memento,
  trelloBoards: TrelloBoard[]
) {
  const catalog = readBoardCatalog(globalState);
  let changed = false;
  const next = catalog.map(entry => {
    if (entry.id) {
      const stillThere = trelloBoards.some(board => board.id === entry.id);
      if (stillThere) {
        return entry;
      }
    }
    const match = trelloBoards.find(
      board => normalizeBoardName(board.name) === normalizeBoardName(entry.name)
    );
    if (!match) {
      return entry;
    }
    if (entry.id === match.id) {
      return entry;
    }
    changed = true;
    return { ...entry, id: match.id };
  });
  if (changed) {
    await saveBoardCatalog(globalState, next);
  }
  return next;
}

export async function addCatalogBoard(
  globalState: vscode.Memento,
  board: TrelloBoard
) {
  const catalog = readBoardCatalog(globalState);
  if (catalog.some(entry => entry.id === board.id)) {
    return catalog;
  }
  const next = [
    ...catalog,
    {
      key: `trello:${board.id}`,
      name: board.name,
      id: board.id,
      builtin: false,
    },
  ];
  await saveBoardCatalog(globalState, next);
  return next;
}

export async function linkCatalogBoard(
  globalState: vscode.Memento,
  key: string,
  board: TrelloBoard
) {
  const catalog = readBoardCatalog(globalState).map(entry =>
    entry.key === key ? { ...entry, id: board.id } : entry
  );
  await saveBoardCatalog(globalState, catalog);
  return catalog;
}

export async function removeCatalogBoard(
  globalState: vscode.Memento,
  key: string
) {
  const catalog = readBoardCatalog(globalState);
  const target = catalog.find(entry => entry.key === key);
  if (!target || target.builtin) {
    return catalog;
  }
  const next = catalog.filter(entry => entry.key !== key);
  await saveBoardCatalog(globalState, next);
  return next;
}

export function unusedTrelloBoards(
  trelloBoards: TrelloBoard[],
  catalog: CatalogBoard[]
) {
  const used = new Set(
    catalog.map(entry => entry.id).filter((id): id is string => Boolean(id))
  );
  return trelloBoards.filter(board => !used.has(board.id));
}
