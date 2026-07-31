import * as vscode from "vscode";
import { getMe, TrelloMember } from "./trello";

/** API Key del Power-Up (pública por diseño en Trello). */
export const TRELLO_APP_KEY = "a6a02f5ff02ecdefb7fccaf78f237b96";

const TOKEN_SECRET_KEY = "trelloBranch.token";

export function getAuthorizeUrl() {
  const params = new URLSearchParams({
    expiration: "never",
    name: "Trello Branch",
    scope: "read,write",
    response_type: "token",
    key: TRELLO_APP_KEY,
  });
  return `https://trello.com/1/authorize?${params.toString()}`;
}

export async function getStoredToken(secrets: vscode.SecretStorage) {
  return secrets.get(TOKEN_SECRET_KEY);
}

export async function clearStoredToken(secrets: vscode.SecretStorage) {
  await secrets.delete(TOKEN_SECRET_KEY);
}

export async function loginWithTrello(secrets: vscode.SecretStorage): Promise<TrelloMember | undefined> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(getAuthorizeUrl()));
  if (!opened) {
    vscode.window.showErrorMessage("No se pudo abrir el navegador para iniciar sesión en Trello.");
    return undefined;
  }

  await vscode.window.showInformationMessage(
    "En el navegador autoriza la app. Luego copia el token y pégalo aquí.",
    { modal: true },
    "Ya tengo el token"
  );

  const token = await vscode.window.showInputBox({
    title: "Trello: Iniciar sesión",
    prompt: "Pega el token que te mostró Trello",
    placeHolder: "ATTA... o el token generado",
    ignoreFocusOut: true,
    password: true,
  });

  if (!token?.trim()) {
    return undefined;
  }

  const cleaned = token.trim();
  const member = await getMe(TRELLO_APP_KEY, cleaned);
  await secrets.store(TOKEN_SECRET_KEY, cleaned);
  return member;
}

export async function requireSession(
  secrets: vscode.SecretStorage
): Promise<{ token: string; member: TrelloMember } | undefined> {
  let token = await getStoredToken(secrets);

  if (!token) {
    const action = await vscode.window.showInformationMessage(
      "Debes iniciar sesión en Trello para continuar.",
      "Iniciar sesión"
    );
    if (action !== "Iniciar sesión") {
      return undefined;
    }
    const member = await loginWithTrello(secrets);
    if (!member) {
      return undefined;
    }
    token = await getStoredToken(secrets);
    if (!token) {
      return undefined;
    }
    return { token, member };
  }

  try {
    const member = await getMe(TRELLO_APP_KEY, token);
    return { token, member };
  } catch {
    await clearStoredToken(secrets);
    const action = await vscode.window.showWarningMessage(
      "La sesión de Trello expiró o no es válida.",
      "Iniciar sesión de nuevo"
    );
    if (action !== "Iniciar sesión de nuevo") {
      return undefined;
    }
    const member = await loginWithTrello(secrets);
    if (!member) {
      return undefined;
    }
    token = await getStoredToken(secrets);
    if (!token) {
      return undefined;
    }
    return { token, member };
  }
}

/** Prefijo de rama: setting opcional, o primer nombre del perfil Trello. */
export function resolveDeveloperName(member: TrelloMember, override?: string) {
  if (override?.trim()) {
    return override.trim();
  }
  const first = member.fullName?.trim().split(/\s+/)[0];
  return first || member.username;
}
