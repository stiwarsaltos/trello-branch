/**
 * Parsea el cuerpo típico de una tarjeta Trello del equipo:
 *
 *   Modulo: Cuentas y Usuarios
 *   Submodulo: Cuentas y Permisos
 *
 *   Descripción:
 *   ...
 *
 *   Ejemplo:
 *   ...
 *
 * Las etiquetas llegan en markdown ("**Descripción:**"), con sufijos
 * ("Submodulo Nuevo:") y con erratas frecuentes ("Descipción:").
 */

export type CardMeta = {
  modulo?: string;
  submodulo?: string;
  descripcion?: string;
  ejemplo?: string;
};

const DESCRIPCION = "desc\\w*ci[oó]n";
const EJEMPLO = "ejemplos?";
const SECTION_LABELS = `(?:m[oó]dulo|subm[oó]dulo|${DESCRIPCION}|${EJEMPLO})`;

function matchField(desc: string, label: string) {
  const pattern = new RegExp(
    `^[ \\t]*\\**[ \\t]*${label}\\b[^:\\n]*:[ \\t]*\\**[ \\t]*(.+?)[ \\t]*\\**[ \\t]*$`,
    "im"
  );
  return desc.match(pattern)?.[1]?.trim() || undefined;
}

function sectionBody(desc: string, label: string) {
  const heading = `\\**[ \\t]*${label}\\b[^:\\n]*:[ \\t]*\\**`;
  const nextHeading = `\\n[ \\t]*\\**[ \\t]*${SECTION_LABELS}\\b[^:\\n]*:`;
  const pattern = new RegExp(
    `(?:^|\\n)[ \\t]*${heading}[ \\t]*([\\s\\S]*?)(?=${nextHeading}|$)`,
    "i"
  );
  const body = desc.match(pattern)?.[1];
  return body?.replace(/\*+$/, "").trim() || undefined;
}

/** Texto restante tras las etiquetas, para tarjetas sin encabezado explícito. */
function bodyAfterLabels(desc: string) {
  const pattern = new RegExp(
    `(?:^|\\n)[ \\t]*\\**[ \\t]*subm[oó]dulo\\b[^:\\n]*:[^\\n]*\\n([\\s\\S]*?)` +
    `(?=\\n[ \\t]*\\**[ \\t]*${SECTION_LABELS}\\b[^:\\n]*:|$)`,
    "i"
  );
  return desc.match(pattern)?.[1]?.trim() || undefined;
}

export function parseCardMeta(desc: string): CardMeta {
  const text = desc ?? "";
  return {
    modulo: matchField(text, "m[oó]dulo"),
    submodulo: matchField(text, "subm[oó]dulo"),
    descripcion: sectionBody(text, DESCRIPCION) ?? bodyAfterLabels(text),
    ejemplo: sectionBody(text, EJEMPLO),
  };
}

export function formatMetaLine(meta: CardMeta) {
  if (meta.modulo && meta.submodulo) {
    return `${meta.modulo} → ${meta.submodulo}`;
  }
  return undefined;
}
