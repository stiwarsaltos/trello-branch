import axios from "axios";

export type TrelloMember = {
  id: string;
  username: string;
  fullName: string;
};

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idMembers: string[];
};

export type TrelloBoard = {
  id: string;
  name: string;
};

export type TrelloList = {
  id: string;
  name: string;
};

export async function getMe(apiKey: string, token: string) {
  const { data } = await axios.get("https://api.trello.com/1/members/me", {
    params: { key: apiKey, token, fields: "id,username,fullName" }
  });
  return data as TrelloMember;
}

export async function getBoards(apiKey: string, token: string) {
  const url = "https://api.trello.com/1/members/me/boards";
  const { data } = await axios.get(url, {
    params: { key: apiKey, token, fields: "name", filter: "open" }
  });
  return data as TrelloBoard[];
}

export async function getLists(apiKey: string, token: string, boardId: string) {
  const url = `https://api.trello.com/1/boards/${boardId}/lists`;
  const { data } = await axios.get(url, {
    params: { key: apiKey, token, fields: "name", filter: "open" }
  });
  return data as TrelloList[];
}

export async function getCards(apiKey: string, token: string, listId: string) {
  const url = `https://api.trello.com/1/lists/${listId}/cards`;
  const { data } = await axios.get(url, {
    params: { key: apiKey, token, fields: "name,desc,idMembers" }
  });
  return data as TrelloCard[];
}

export async function getCard(apiKey: string, token: string, cardId: string) {
  const { data } = await axios.get(`https://api.trello.com/1/cards/${cardId}`, {
    params: { key: apiKey, token, fields: "name,desc,idList,idMembers" }
  });
  return data as TrelloCard & { idList: string };
}

/** Tarjetas de la lista asignadas al miembro autenticado. */
export async function getAssignedCards(
  apiKey: string,
  token: string,
  listId: string,
  memberId: string
) {
  const cards = await getCards(apiKey, token, listId);
  return cards.filter(c => (c.idMembers ?? []).includes(memberId));
}

export async function getList(apiKey: string, token: string, listId: string) {
  const { data } = await axios.get(`https://api.trello.com/1/lists/${listId}`, {
    params: { key: apiKey, token, fields: "name,idBoard" }
  });
  return data as TrelloList & { idBoard: string };
}

export async function moveCard(
  apiKey: string, token: string, cardId: string, targetListId: string
) {
  await axios.put(`https://api.trello.com/1/cards/${cardId}`, null, {
    params: { key: apiKey, token, idList: targetListId }
  });
}

/** Mueve la tarjeta a la lista inmediatamente siguiente en el tablero. */
export async function moveCardToNextList(
  apiKey: string,
  token: string,
  cardId: string,
  currentListId: string
) {
  const current = await getList(apiKey, token, currentListId);
  const lists = await getLists(apiKey, token, current.idBoard);
  const index = lists.findIndex(l => l.id === currentListId);

  if (index === -1) {
    throw new Error(`No se encontró la lista actual "${current.name}" en el tablero.`);
  }
  if (index >= lists.length - 1) {
    throw new Error(
      `La lista "${current.name}" es la última del tablero; no hay siguiente lista.`
    );
  }

  const next = lists[index + 1];
  await moveCard(apiKey, token, cardId, next.id);
  return { from: current, to: next };
}
