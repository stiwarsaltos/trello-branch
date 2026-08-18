import * as vscode from "vscode";
import { downloadAttachment } from "./trello";

export async function previewCardImage(options: {
  apiKey: string;
  token: string;
  cardId: string;
  attachmentId: string;
  name: string;
  url?: string;
  isUpload?: boolean;
  mimeType?: string;
}) {
  const { apiKey, token, cardId, attachmentId, name } = options;

  const panel = vscode.window.createWebviewPanel(
    "trelloBranch.imagePreview",
    name || "Imagen Trello",
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true }
  );

  panel.webview.html = loadingHtml(name);

  try {
    const { bytes, mimeType } = await downloadAttachment(apiKey, token, {
      cardId,
      id: attachmentId,
      name,
      url: options.url ?? "",
      isUpload: options.isUpload,
    });
    const mime = options.mimeType?.startsWith("image/")
      ? options.mimeType
      : mimeType.startsWith("image/")
        ? mimeType
        : "image/png";
    const base64 = bytes.toString("base64");
    panel.webview.html = imageHtml(name, mime, base64);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    panel.webview.html = errorHtml(name, message);
  }
}

function loadingHtml(name: string) {
  return wrapHtml(name, `<p style="color:#ccc">Cargando imagen…</p>`);
}

function errorHtml(name: string, message: string) {
  return wrapHtml(
    name,
    `<p style="color:#f48771">No se pudo cargar la imagen.</p>
     <pre style="color:#ccc;white-space:pre-wrap">${escapeHtml(message)}</pre>`
  );
}

function imageHtml(name: string, mime: string, base64: string) {
  return wrapHtml(
    name,
    `<img src="data:${mime};base64,${base64}" alt="${escapeHtml(name)}" />`
  );
}

function wrapHtml(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #1e1e1e;
      color: #ccc;
      font-family: var(--vscode-font-family, sans-serif);
    }
    .wrap {
      box-sizing: border-box;
      min-height: 100%;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: #ddd;
      text-align: center;
      word-break: break-word;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
