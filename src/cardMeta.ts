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
const EMPRESA =
  "(?:empresa|nombre\\s+de\\s+la\\s+empresa|raz[oó]n\\s*social|cliente|compa[ñn][ií]a)";
const RUC_LABEL = "r\\.?\\s*u\\.?\\s*c\\.?";
const ID_LABEL = `(?:${RUC_LABEL}|identificaci[oó]n)`;
const SECTION_LABELS =
  `(?:m[oó]dulo|subm[oó]dulo|${DESCRIPCION}|${EJEMPLO}|${ID_LABEL}|${EMPRESA})`;

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
  const normalized = normalizeFieldName(name);
  return normalized === "ruc empresa" || normalized === "rucempresa";
}

export function isEmpresaFieldName(name: string) {
  const normalized = normalizeFieldName(name);
  return (
    normalized === "empresa" ||
    normalized === "nombre empresa" ||
    normalized === "razon social" ||
    normalized === "cliente"
  );
}

function normalizeFieldName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^_+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractIdFromText(text: string, allowLoose = false) {
  const labeled = text.match(
    new RegExp(
      `\\b(?:${RUC_LABEL}|identificaci[oó]n|nit|c\\.?i\\.?)\\s*[:.\\-]?\\s*(\\d[\\d\\s.-]{8,16}\\d)`,
      "i"
    )
  );
  if (labeled?.[1]) {
    return normalizeRuc(labeled[1]);
  }
  if (!allowLoose) {
    return undefined;
  }
  const loose = text.match(/\d[\d\s.-]{8,16}\d/);
  return loose ? normalizeRuc(loose[0]) : undefined;
}

/** Separa nombre de empresa y RUC/identificación si vienen en el mismo texto. */
export function splitCompanyAndId(value: string | undefined) {
  if (!value?.trim()) {
    return {};
  }
  const text = value.replace(/\s+/g, " ").trim();
  const identificacion = extractIdFromText(text, true);
  let empresa = text;
  if (identificacion) {
    const digitsPattern = identificacion.split("").join("[\\s.-]*");
    empresa = empresa
      .replace(
        new RegExp(
          `(?:${RUC_LABEL}|identificaci[oó]n|nit|c\\.?i\\.?)\\s*[:.\\-]?\\s*${digitsPattern}`,
          "i"
        ),
        ""
      )
      .replace(new RegExp(digitsPattern), "");
  }
  empresa = empresa.replace(/^[\s\-–,;:|/]+|[\s\-–,;:|/]+$/g, "").replace(/\s+/g, " ").trim();
  if (identificacion && empresa === identificacion) {
    empresa = "";
  }
  return {
    empresa: empresa || undefined,
    identificacion,
  };
}

export function identificationLabel(id: string) {
  return id.length === 13 ? "RUC" : "Identificación";
}

function plainCardText(desc: string) {
  return (desc ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
}

function looksLikeCompanyName(name: string) {
  if (name.length < 2 || name.length > 80) {
    return false;
  }
  if (
    /\b(debe|deben|para|cuando|ajustar|agregar|crear|requiere|usuario|exportar|permitir)\b/i.test(
      name
    )
  ) {
    return false;
  }
  return /[a-záéíóúñ]{2,}/i.test(name);
}

function companyFromCardDescription(text: string) {
  const fromEmpresa = splitCompanyAndId(matchField(text, EMPRESA));
  const fromId = splitCompanyAndId(matchField(text, ID_LABEL));
  const descripcion = sectionBody(text, DESCRIPCION) ?? bodyAfterLabels(text) ?? "";
  const fromDescEmpresa = splitCompanyAndId(matchField(descripcion, EMPRESA));
  const fromDescId = splitCompanyAndId(matchField(descripcion, ID_LABEL));

  let empresa =
    fromEmpresa.empresa ??
    fromDescEmpresa.empresa ??
    fromId.empresa ??
    fromDescId.empresa;
  let identificacion =
    fromId.identificacion ??
    fromDescId.identificacion ??
    fromEmpresa.identificacion ??
    fromDescEmpresa.identificacion ??
    extractIdFromText(descripcion) ??
    extractIdFromText(text);

  if (!empresa || !identificacion) {
    const block = `${matchField(text, EMPRESA) ?? ""}\n${descripcion}`;
    for (const line of block.split("\n")) {
      const cleaned = line.replace(/\*+/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned.length < 8 || cleaned.length > 180) {
        continue;
      }
      const split = splitCompanyAndId(cleaned);
      if (split.identificacion) {
        identificacion = identificacion ?? split.identificacion;
      }
      if (split.empresa && looksLikeCompanyName(split.empresa)) {
        empresa = empresa ?? split.empresa;
      }
      if (empresa && identificacion) {
        break;
      }
    }
  }

  return { empresa, identificacion };
}

export function parseCardMeta(
  desc: string,
  extras?: { ruc?: string; empresa?: string }
): CardMeta {
  const text = plainCardText(desc ?? "");
  const fromDesc = companyFromCardDescription(text);
  const fromExtrasRuc = splitCompanyAndId(extras?.ruc);
  const fromExtrasEmpresa = splitCompanyAndId(extras?.empresa);
  return {
    modulo: matchField(text, "m[oó]dulo"),
    submodulo: matchField(text, "subm[oó]dulo"),
    descripcion: sectionBody(text, DESCRIPCION) ?? bodyAfterLabels(text),
    ejemplo: sectionBody(text, EJEMPLO),
    ruc:
      fromDesc.identificacion ??
      fromExtrasRuc.identificacion ??
      fromExtrasEmpresa.identificacion,
    empresa:
      fromDesc.empresa ??
      fromExtrasEmpresa.empresa ??
      fromExtrasRuc.empresa,
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
        `\\**[ \\t]*(?:${ID_LABEL}|${EMPRESA})\\b[^:\\n]*:[^\\n]*`,
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
  const text = plainCardText(desc ?? "");
  const empresa = companyFromCardDescription(text).empresa;
  const explicit = sectionBody(text, DESCRIPCION);
  return sanitizeForPr(explicit ?? "", empresa);
}
