import {
  decompress,
  decompressFromBase64,
  decompressFromEncodedURIComponent,
  decompressFromUTF16,
} from "lz-string";
import { isRucEmpresaFieldName, normalizeRuc } from "./cardMeta";

type PluginData = {
  idPlugin?: string;
  value: string;
};

const AMAZING_FIELDS_PLUGIN_ID = "60e068efb294647187bbe4f5";

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function decompressAmazingBlob(blob: string): unknown {
  const attempts = [
    () => decompressFromUTF16(blob),
    () => decompress(blob),
    () => decompressFromBase64(blob),
    () => decompressFromEncodedURIComponent(blob),
  ];
  for (const attempt of attempts) {
    try {
      const out = attempt();
      if (!out) {
        continue;
      }
      return tryJson(out) ?? out;
    } catch {
      // Probar el siguiente algoritmo.
    }
  }
  return undefined;
}

export function decodeAmazingPluginValue(raw: string | undefined): unknown {
  if (!raw) {
    return undefined;
  }
  const parsed = tryJson(raw);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const blob = record.FD ?? record.fd ?? record.data;
    if (typeof blob === "string") {
      return decompressAmazingBlob(blob) ?? parsed;
    }
    return parsed;
  }
  return decompressAmazingBlob(raw) ?? parsed;
}

function fieldNameOf(entry: Record<string, unknown>) {
  const name = entry.name ?? entry.n ?? entry.title ?? entry.label ?? entry.l;
  return typeof name === "string" ? name : undefined;
}

function fieldIdOf(entry: Record<string, unknown>) {
  const id = entry.id ?? entry.i ?? entry.fid ?? entry.fieldId;
  return typeof id === "string" ? id : undefined;
}

function collectFieldDefs(data: unknown, acc: Map<string, string>) {
  if (!data) {
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      collectFieldDefs(item, acc);
    }
    return;
  }
  if (typeof data !== "object") {
    return;
  }
  const record = data as Record<string, unknown>;
  const name = fieldNameOf(record);
  const id = fieldIdOf(record);
  if (name && id) {
    acc.set(id, name);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectFieldDefs(value, acc);
    }
  }
}

function rucFromNamedMap(data: unknown, namesById: Map<string, string>): string | undefined {
  if (!data) {
    return undefined;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = rucFromNamedMap(item, namesById);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof data === "string" || typeof data === "number") {
    return undefined;
  }
  if (typeof data !== "object") {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const named = fieldNameOf(record);
  if (named && isRucEmpresaFieldName(named)) {
    const raw = record.value ?? record.v ?? record.text ?? record.val ?? record.number;
    if (typeof raw === "string" || typeof raw === "number") {
      const ruc = normalizeRuc(String(raw));
      if (ruc) {
        return ruc;
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const mappedName = namesById.get(key) ?? key;
    if (isRucEmpresaFieldName(mappedName) || isRucEmpresaFieldName(key)) {
      if (typeof value === "string" || typeof value === "number") {
        const ruc = normalizeRuc(String(value));
        if (ruc) {
          return ruc;
        }
      }
      if (value && typeof value === "object") {
        const inner = value as Record<string, unknown>;
        const raw = inner.value ?? inner.v ?? inner.text ?? inner.val;
        if (typeof raw === "string" || typeof raw === "number") {
          const ruc = normalizeRuc(String(raw));
          if (ruc) {
            return ruc;
          }
        }
      }
    }
    const nested = rucFromNamedMap(value, namesById);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function amazingEntries(data: PluginData[] | undefined) {
  const all = data ?? [];
  const amazing = all.filter(entry => entry.idPlugin === AMAZING_FIELDS_PLUGIN_ID);
  return amazing.length ? amazing : all;
}

export function rucFromAmazingPluginData(
  cardPluginData: PluginData[] | undefined,
  boardPluginData: PluginData[] | undefined
) {
  const namesById = new Map<string, string>();
  const boardEntries = amazingEntries(boardPluginData);
  const cardEntries = amazingEntries(cardPluginData);
  for (const entry of boardEntries) {
    collectFieldDefs(decodeAmazingPluginValue(entry.value), namesById);
  }
  for (const entry of cardEntries) {
    collectFieldDefs(decodeAmazingPluginValue(entry.value), namesById);
  }

  const payloads = [
    ...cardEntries.map(entry => decodeAmazingPluginValue(entry.value)),
    ...boardEntries.map(entry => decodeAmazingPluginValue(entry.value)),
  ];
  for (const payload of payloads) {
    const ruc = rucFromNamedMap(payload, namesById);
    if (ruc) {
      return ruc;
    }
  }
  return undefined;
}
