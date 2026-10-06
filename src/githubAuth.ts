import * as vscode from "vscode";
import { getGithubUser, GithubUser } from "./github";

export const GITHUB_AUTH_PROVIDER = "github";
const GITHUB_SCOPES = ["repo"];

function providerMissingMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/no authentication provider/i.test(message) || /has not been registered/i.test(message)) {
    return (
      "Cursor/VS Code no tiene el proveedor de GitHub. " +
      "Inicia sesión en GitHub desde Cuentas (esquina inferior) o instala GitHub Authentication."
    );
  }
  return message;
}

export async function getGithubEditorSession(options?: {
  createIfNone?: boolean;
  silent?: boolean;
  forceNewSession?: boolean;
}): Promise<vscode.AuthenticationSession | undefined> {
  try {
    return await vscode.authentication.getSession(
      GITHUB_AUTH_PROVIDER,
      GITHUB_SCOPES,
      {
        createIfNone: options?.createIfNone,
        silent: options?.silent,
        forceNewSession: options?.forceNewSession,
      }
    );
  } catch (error) {
    throw new Error(providerMissingMessage(error));
  }
}

export async function loginWithGithub(options?: {
  forceNewSession?: boolean;
}): Promise<GithubUser | undefined> {
  const session = await getGithubEditorSession({
    createIfNone: !options?.forceNewSession,
    forceNewSession: options?.forceNewSession,
  });
  if (!session) {
    return undefined;
  }
  return getGithubUser(session.accessToken);
}

export async function requireGithubSession(): Promise<
  { token: string; user: GithubUser } | undefined
> {
  let session = await getGithubEditorSession({ silent: true });

  if (!session) {
    const action = await vscode.window.showInformationMessage(
      "Debes iniciar sesión en GitHub (cuenta del editor) para crear el pull request.",
      "Iniciar sesión"
    );
    if (action !== "Iniciar sesión") {
      return undefined;
    }
    session = await getGithubEditorSession({ createIfNone: true });
    if (!session) {
      return undefined;
    }
  }

  try {
    const user = await getGithubUser(session.accessToken);
    return { token: session.accessToken, user };
  } catch {
    const action = await vscode.window.showWarningMessage(
      "La sesión de GitHub del editor expiró o no tiene permiso para el repo.",
      "Iniciar sesión de nuevo"
    );
    if (action !== "Iniciar sesión de nuevo") {
      return undefined;
    }
    session = await getGithubEditorSession({ forceNewSession: true });
    if (!session) {
      return undefined;
    }
    const user = await getGithubUser(session.accessToken);
    return { token: session.accessToken, user };
  }
}
