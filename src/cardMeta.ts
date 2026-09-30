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
  ruc?: string;
  empresa?: string;
};

const DESCRIPCION = "desc\\w*ci[oó]n";
const EJEMPLO = "ejemplos?";
const EMPRESA = "(?:empresa|raz[oó]n\\s*social|cliente|compa[ñn][ií]a)";
const RUC_LABEL = "r\\.?\\s*u\\.?\\s*c\\.?";
const SECTION_LABELS =
  `(?:m[oó]dulo|subm[oó]dulo|${DESCRIPCION}|${EJEMPLO}|${RUC_LABEL}|${EMPRESA})`;

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

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeRuc(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const digits = digitsOnly(value);
  if (digits.length >= 10 && digits.length <= 13) {
    return digits;
  }
  return undefined;
}

export function isRucEmpresaFieldName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^_+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized === "ruc empresa" || normalized === "rucempresa";
}

function matchRuc(desc: string) {
  const labeled = desc.match(
    new RegExp(`\\b${RUC_LABEL}\\s*[:.\\-]?\\s*(\\d[\\d\\s.-]{8,16}\\d)`, "i")
  );
  const fromLabel = labeled?.[1] ? normalizeRuc(labeled[1]) : undefined;
  if (fromLabel) {
    return fromLabel;
  }
  const field = matchField(desc, RUC_LABEL);
  return field ? normalizeRuc(field) : undefined;
}

export function parseCardMeta(
  desc: string,
  extras?: { ruc?: string }
): CardMeta {
  const text = desc ?? "";
  return {
    modulo: matchField(text, "m[oó]dulo"),
    submodulo: matchField(text, "subm[oó]dulo"),
    descripcion: sectionBody(text, DESCRIPCION) ?? bodyAfterLabels(text),
    ejemplo: sectionBody(text, EJEMPLO),
    ruc: normalizeRuc(extras?.ruc) ?? matchRuc(text),
    empresa: matchField(text, EMPRESA),
  };
}

export function formatMetaLine(meta: CardMeta) {
  if (meta.modulo && meta.submodulo) {
    return `${meta.modulo} → ${meta.submodulo}`;
  }
  return undefined;
}

const IMAGE_EXT = "png|jpe?g|gif|webp|bmp|svg|ico|avif";

function findClosing(text: string, openIndex: number, open: string, close: string) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === open) {
      depth++;
    } else if (text[i] === close) {
      depth--;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/** Quita `![alt](url)`, incluso con paréntesis en el nombre del archivo. */
function stripMarkdownImages(text: string) {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "!" && text[i + 1] === "[") {
      const altEnd = findClosing(text, i + 1, "[", "]");
      if (altEnd !== -1) {
        const afterAlt = altEnd + 1;
        if (text[afterAlt] === "(") {
          const destEnd = findClosing(text, afterAlt, "(", ")");
          if (destEnd !== -1) {
            i = destEnd + 1;
            continue;
          }
        } else if (text[afterAlt] === "[") {
          const refEnd = findClosing(text, afterAlt, "[", "]");
          if (refEnd !== -1) {
            i = refEnd + 1;
            continue;
          }
        } else {
          i = afterAlt;
          continue;
        }
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function isImageFilename(value: string) {
  return new RegExp(`\\.(?:${IMAGE_EXT})(?:\\b|$|\\?)`, "i").test(value.trim());
}

function isMediaUrl(url: string) {
  const value = url.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (value.startsWith("data:image/")) {
    return true;
  }
  if (new RegExp(`\\.(?:${IMAGE_EXT})(?:$|\\?|#)`, "i").test(value)) {
    return true;
  }
  return /trello(?:cdn)?|trello-attachments|\/attachments\/|\/previews\/|user-attachments|githubusercontent\.com|googleusercontent\.com|i\.imgur\.com|media\.giphy\.com/.test(
    value
  );
}

/** Quita imágenes, adjuntos de Trello y URLs que GitHub renderiza como media. */
function stripImages(text: string) {
  let cleaned = stripMarkdownImages(text)
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, "")
    .replace(/<video\b[\s\S]*?<\/video>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<source\b[\s\S]*?>/gi, "")
    .replace(/<img\b[\s\S]*?>/gi, "")
    .replace(/<\/img>/gi, "")
    .replace(/\{[^{}]*attachment[^{}]*\}/gi, "")
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=\s]+/gi, "");

  cleaned = cleaned.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, attrs: string, inner: string) => {
      const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      if (isMediaUrl(href) || isImageFilename(inner.replace(/<[^>]+>/g, ""))) {
        return "";
      }
      return full;
    }
  );

  cleaned = cleaned.replace(/\[[^\]]*\]\([^)]*\)/g, match => {
    const dest = match.slice(match.lastIndexOf("(") + 1, -1).trim();
    const label = match.slice(1, match.indexOf("]"));
    if (!dest || isMediaUrl(dest) || isImageFilename(label) || isImageFilename(dest)) {
      return "";
    }
    return match;
  });

  cleaned = cleaned.replace(/(?:https?:)?\/\/[^\s)"'<>]+/gi, url =>
    isMediaUrl(url) ? "" : url
  );
  cleaned = cleaned.replace(/(?:^|[\s<(])(?:www\.)?trello\.com\/[^\s)"'<>]+/gi, match =>
    match.startsWith("t") || match.startsWith("w") ? "" : match[0]
  );
  cleaned = cleaned.replace(
    new RegExp(`\\[[^\\]]+\\.(?:${IMAGE_EXT})\\]`, "gi"),
    ""
  );
  cleaned = cleaned.replace(/^[ \t]*!\[[^\]]*\][ \t]*$/gm, "");
  cleaned = cleaned.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, line =>
    isMediaUrl(line.replace(/^[ \t]*\[[^\]]+\]:[ \t]*/, "")) ? "" : line
  );
  cleaned = cleaned.replace(/^[ \t]*\[[^\]]+\]:[ \t]*$/gm, "");
  cleaned = cleaned.replace(/\[[^\]]*\]\(\s*\)/g, "");
  cleaned = cleaned.replace(/\[]\([^)]*\)/g, "");

  return cleaned;
}

function tidyText(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Quita imágenes y datos de empresa para no filtrarlos en un PR público. */
export function sanitizeForPr(text: string, empresa?: string) {
  let cleaned = stripImages(text)
    .replace(/<[^>]+>/g, " ")
    .replace(
      new RegExp(
        `\\**[ \\t]*(?:${RUC_LABEL}|${EMPRESA})\\b[^:\\n]*:[^\\n]*`,
        "gi"
      ),
      ""
    )
    .replace(new RegExp(`\\b${RUC_LABEL}\\s*[:.\\-]?\\s*\\d[\\d\\s.-]{8,16}\\d`, "gi"), "");

  const company = empresa?.trim();
  if (company && company.length >= 3) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "gi"), "");
  }

  return tidyText(cleaned);
}

/** Solo la sección Descripción de la tarjeta, sin imágenes ni datos de empresa. */
export function descriptionForPr(desc: string) {
  const text = desc ?? "";
  const empresa = matchField(text, EMPRESA);
  const explicit = sectionBody(text, DESCRIPCION);
  return sanitizeForPr(explicit ?? "", empresa);
}
