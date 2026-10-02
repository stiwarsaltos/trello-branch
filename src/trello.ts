import axios from "axios";
import { companyFromAmazingPluginData } from "./amazingFields";
import { isEmpresaFieldName, isRucEmpresaFieldName, splitCompanyAndId } from "./cardMeta";

export type TrelloMember = {
  id: string;
  username: string;
  fullName: string;
};

export type TrelloCustomField = {
  id: string;
  name: string;
  type: string;
};

export type TrelloCustomFieldItem = {
  idCustomField: string;
  value?: {
    text?: string;
    number?: string;
    checked?: string;
    date?: string;
  };
};

export type TrelloPluginData = {
  idPlugin: string;
  value: string;
};

export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  idMembers: string[];
  idList?: string;
  customFieldItems?: TrelloCustomFieldItem[];
  pluginData?: TrelloPluginData[];
  ruc?: string;
  empresa?: string;
};

export type TrelloBoard = {
  id: string;
  name: string;
};

export type TrelloList = {
  id: string;
  name: string;
};

export type TrelloAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  bytes?: number;
  isUpload?: boolean;
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
    params: {
      key: apiKey,
      token,
      fields: "name,desc,idMembers,idList",
      customFieldItems: true,
      pluginData: true,
    }
  });
  return data as TrelloCard[];
}

export async function getCard(
  apiKey: string,
  token: string,
  cardId: string
) {
  const { data } = await axios.get(`https://api.trello.com/1/cards/${cardId}`, {
    params: {
      key: apiKey,
      token,
      fields: "name,desc,idList,idMembers,idBoard",
      customFieldItems: true,
      pluginData: true,
    }
  });
  const card = data as TrelloCard & { idList: string; idBoard: string };
  const [fields, boardPluginData] = await Promise.all([
    getBoardCustomFields(apiKey, token, card.idBoard),
    getBoardPluginData(apiKey, token, card.idBoard),
  ]);
  const company = resolveCardCompany(card, fields, boardPluginData);
  return {
    ...card,
    ruc: company.ruc,
    empresa: company.empresa,
  };
}

export async function getBoardPluginData(
  apiKey: string,
  token: string,
  boardId: string
) {
  try {
    const { data } = await axios.get(
      `https://api.trello.com/1/boards/${boardId}/pluginData`,
      { params: { key: apiKey, token } }
    );
    return data as TrelloPluginData[];
  } catch {
    return [];
  }
}

export async function getBoardCustomFields(
  apiKey: string,
  token: string,
  boardId: string
) {
  try {
    const { data } = await axios.get(
      `https://api.trello.com/1/boards/${boardId}/customFields`,
      { params: { key: apiKey, token } }
    );
    return data as TrelloCustomField[];
  } catch {
    return [];
  }
}

function customFieldValue(item: TrelloCustomFieldItem) {
  return item.value?.text ?? item.value?.number;
}

function companyFromCustomFields(
  fields: TrelloCustomField[],
  items: TrelloCustomFieldItem[] | undefined
) {
  const info: { ruc?: string; empresa?: string } = {};
  if (!items?.length || !fields.length) {
    return info;
  }
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const item of items) {
    const field = byId.get(item.idCustomField);
    if (!field) {
      continue;
    }
    if (!isRucEmpresaFieldName(field.name) && !isEmpresaFieldName(field.name)) {
      continue;
    }
    const split = splitCompanyAndId(customFieldValue(item));
    if (split.identificacion && !info.ruc) {
      info.ruc = split.identificacion;
    }
    if (split.empresa && !info.empresa) {
      info.empresa = split.empresa;
    }
  }
  return info;
}

export function resolveCardCompany(
  card: Pick<TrelloCard, "customFieldItems" | "pluginData">,
  fields: TrelloCustomField[],
  boardPluginData?: TrelloPluginData[]
) {
  const native = companyFromCustomFields(fields, card.customFieldItems);
  const amazing = companyFromAmazingPluginData(card.pluginData, boardPluginData);
  return {
    ruc: native.ruc ?? amazing.ruc,
    empresa: native.empresa ?? amazing.empresa,
  };
}

export function resolveCardRuc(
  card: Pick<TrelloCard, "customFieldItems" | "pluginData">,
  fields: TrelloCustomField[],
  boardPluginData?: TrelloPluginData[]
) {
  return resolveCardCompany(card, fields, boardPluginData).ruc;
}

export async function getCardAttachments(
  apiKey: string,
  token: string,
  cardId: string
) {
  const { data } = await axios.get(
    `https://api.trello.com/1/cards/${cardId}/attachments`,
    { params: { key: apiKey, token } }
  );
  return data as TrelloAttachment[];
}

/** Adjuntos de imagen de una tarjeta (mime image/* o extensión conocida). */
export async function getCardImageAttachments(
  apiKey: string,
  token: string,
  cardId: string
) {
  const attachments = await getCardAttachments(apiKey, token, cardId);
  return attachments.filter(isImageAttachment);
}

/**
 * Descarga un adjunto. Subidas en Trello: ruta /download/ con header
 * OAuth (key/token por query ya no autentican). Enlaces externos: GET a url.
 */
export async function downloadAttachment(
  apiKey: string,
  token: string,
  attachment: Pick<
    TrelloAttachment,
    "id" | "name" | "url" | "isUpload"
  > & { cardId: string }
) {
  const { data, headers } =
    attachment.isUpload === false
      ? await axios.get(attachment.url, { responseType: "arraybuffer" })
      : await axios.get(
          `https://api.trello.com/1/cards/${attachment.cardId}/attachments/` +
            `${attachment.id}/download/${encodeURIComponent(attachment.name)}`,
          {
            responseType: "arraybuffer",
            headers: {
              Authorization:
                `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"`,
            },
          }
        );
  const mimeType =
    typeof headers["content-type"] === "string"
      ? headers["content-type"].split(";")[0].trim()
      : "application/octet-stream";
  return { bytes: Buffer.from(data), mimeType };
}

function isImageAttachment(attachment: TrelloAttachment) {
  if (attachment.mimeType?.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.name ?? "");
}

/** Tarjetas de la primera lista del tablero asignadas al miembro autenticado. */
export async function getAssignedCardsForBoard(
  apiKey: string,
  token: string,
  boardId: string,
  memberId: string
) {
  const lists = await getLists(apiKey, token, boardId);
  const origin = lists[0];
  if (!origin) {
    return { originList: undefined, cards: [] };
  }
  const cards = await getAssignedCards(apiKey, token, origin.id, memberId);
  return { originList: origin, cards };
}

export async function getAssignedCards(
  apiKey: string,
  token: string,
  listId: string,
  memberId: string
) {
  const list = await getList(apiKey, token, listId);
  const [cards, fields, boardPluginData] = await Promise.all([
    getCards(apiKey, token, listId),
    getBoardCustomFields(apiKey, token, list.idBoard),
    getBoardPluginData(apiKey, token, list.idBoard),
  ]);
  return cards
    .filter(c => (c.idMembers ?? []).includes(memberId))
    .map(card => {
      const company = resolveCardCompany(card, fields, boardPluginData);
      return {
        ...card,
        ruc: company.ruc,
        empresa: company.empresa,
      };
    });
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

/** Mueve la tarjeta a la lista inmediatamente anterior en el tablero. */
export async function moveCardToPreviousList(
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
  if (index <= 0) {
    throw new Error(
      `La lista "${current.name}" es la primera del tablero; no hay lista anterior.`
    );
  }

  const previous = lists[index - 1];
  await moveCard(apiKey, token, cardId, previous.id);
  return { from: current, to: previous };
}

export async function commentOnCard(
  apiKey: string,
  token: string,
  cardId: string,
  text: string
) {
  await axios.post(
    `https://api.trello.com/1/cards/${cardId}/actions/comments`,
    null,
    { params: { key: apiKey, token, text } }
  );
}
