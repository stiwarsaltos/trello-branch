/**
 * Spanish → English for Conventional Commit messages.
 * Phrase matches run first (longest wins), then per-token lookup.
 */

const PHRASES: [string, string][] = (
  [
    ["cuentas y permisos", "accounts permissions"],
    ["cuentas y usuarios", "accounts"],
    ["recursos humanos", "hr"],
    ["ordenes de compra", "purchase orders"],
    ["ordenes de venta", "sales orders"],
    ["notas de credito", "credit notes"],
    ["notas de debito", "debit notes"],
    ["puntos de venta", "pos"],
    ["punto de venta", "pos"],
    ["lista de precios", "price list"],
    ["listado de usuarios", "user list"],
    ["filtro de sucursal", "location filter"],
    ["filtros de sucursal", "location filters"],
    ["centro de costo", "cost center"],
    ["centros de costo", "cost centers"],
    ["flujo de caja", "cash flow"],
    ["tipo de cambio", "exchange rate"],
    ["codigo de barras", "barcode"],
    ["base de datos", "database"],
    ["inicio de sesion", "login"],
    ["cerrar sesion", "logout"],
    ["restablecer contrasena", "reset password"],
    ["cambiar contrasena", "change password"],
    ["al guardar", "when saving"],
    ["al crear", "when creating"],
    ["al actualizar", "when updating"],
    ["al eliminar", "when deleting"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

const WORDS: Record<string, string> = {
  el: "",
  la: "",
  los: "",
  las: "",
  un: "a",
  una: "a",
  unos: "some",
  unas: "some",
  de: "",
  del: "",
  al: "to",
  a: "to",
  y: "and",
  o: "or",
  u: "or",
  para: "for",
  con: "with",
  sin: "without",
  en: "in",
  por: "by",
  sobre: "about",
  desde: "from",
  hasta: "until",
  entre: "between",
  segun: "according to",
  que: "that",
  se: "",
  su: "its",
  sus: "its",
  este: "this",
  esta: "this",
  estos: "these",
  estas: "these",
  ese: "that",
  esa: "that",
  cuando: "when",
  donde: "where",
  como: "how",
  no: "not",
  si: "if",
  mas: "more",
  menos: "less",
  nuevo: "new",
  nueva: "new",
  nuevos: "new",
  nuevas: "new",
  agregar: "add",
  agrega: "add",
  agregue: "add",
  anadir: "add",
  anade: "add",
  crear: "create",
  crea: "create",
  implementar: "implement",
  implementa: "implement",
  corregir: "fix",
  corrige: "fix",
  arreglar: "fix",
  arregla: "fix",
  solucionar: "fix",
  soluciona: "fix",
  actualizar: "update",
  actualiza: "update",
  modificar: "update",
  modifica: "update",
  cambiar: "change",
  cambia: "change",
  eliminar: "remove",
  elimina: "remove",
  quitar: "remove",
  quita: "remove",
  borrar: "delete",
  borra: "delete",
  mejorar: "improve",
  mejora: "improve",
  mostrar: "show",
  muestra: "show",
  visualizar: "display",
  ocultar: "hide",
  oculta: "hide",
  validar: "validate",
  valida: "validate",
  permitir: "allow",
  permite: "allow",
  restringir: "restrict",
  restringe: "restrict",
  ordenar: "sort",
  ordena: "sort",
  filtrar: "filter",
  filtra: "filter",
  buscar: "search",
  busca: "search",
  mover: "move",
  mueve: "move",
  restaurar: "restore",
  restaura: "restore",
  habilitar: "enable",
  habilita: "enable",
  deshabilitar: "disable",
  deshabilita: "disable",
  exportar: "export",
  exporta: "export",
  importar: "import",
  importa: "import",
  imprimir: "print",
  imprime: "print",
  guardar: "save",
  guarda: "save",
  seleccionar: "select",
  selecciona: "select",
  asignar: "assign",
  asigna: "assign",
  calcular: "calculate",
  calcula: "calculate",
  reportar: "report",
  ajustar: "adjust",
  ajusta: "adjust",
  configurar: "configure",
  configura: "configure",
  registrar: "register",
  registra: "register",
  consultar: "query",
  consulta: "query",
  listar: "list",
  lista: "list",
  cargar: "load",
  carga: "load",
  descargar: "download",
  descarga: "download",
  enviar: "send",
  envia: "send",
  recibir: "receive",
  recibe: "receive",
  aprobar: "approve",
  aprueba: "approve",
  rechazar: "reject",
  rechaza: "reject",
  anular: "void",
  anula: "void",
  facturar: "invoice",
  paginar: "paginate",
  filtro: "filter",
  filtros: "filters",
  campo: "field",
  campos: "fields",
  boton: "button",
  botones: "buttons",
  pantalla: "screen",
  pantallas: "screens",
  formulario: "form",
  formularios: "forms",
  tabla: "table",
  tablas: "tables",
  columna: "column",
  columnas: "columns",
  fila: "row",
  filas: "rows",
  modal: "modal",
  menu: "menu",
  mensaje: "message",
  mensajes: "messages",
  error: "error",
  errores: "errors",
  alerta: "alert",
  validacion: "validation",
  validaciones: "validations",
  permiso: "permission",
  permisos: "permissions",
  usuario: "user",
  usuarios: "users",
  cuenta: "account",
  cuentas: "accounts",
  rol: "role",
  roles: "roles",
  sucursal: "location",
  sucursales: "locations",
  bodega: "warehouse",
  bodegas: "warehouses",
  inventario: "inventory",
  producto: "product",
  productos: "products",
  articulo: "item",
  articulos: "items",
  cliente: "customer",
  clientes: "customers",
  proveedor: "vendor",
  proveedores: "vendors",
  factura: "invoice",
  facturas: "invoices",
  facturacion: "invoicing",
  pago: "payment",
  pagos: "payments",
  cobro: "collection",
  cobros: "collections",
  compra: "purchase",
  compras: "purchasing",
  venta: "sale",
  ventas: "sales",
  pedido: "order",
  pedidos: "orders",
  orden: "order",
  ordenes: "orders",
  nomina: "payroll",
  empleado: "employee",
  empleados: "employees",
  contabilidad: "accounting",
  asiento: "journal entry",
  asientos: "journal entries",
  tesoreria: "treasury",
  caja: "cash",
  banco: "bank",
  bancos: "banks",
  reporte: "report",
  reportes: "reports",
  educacion: "education",
  estudiante: "student",
  estudiantes: "students",
  fecha: "date",
  fechas: "dates",
  hora: "time",
  monto: "amount",
  montos: "amounts",
  total: "total",
  totales: "totals",
  precio: "price",
  precios: "prices",
  descuento: "discount",
  descuentos: "discounts",
  impuesto: "tax",
  impuestos: "taxes",
  iva: "vat",
  cantidad: "quantity",
  cantidades: "quantities",
  estado: "status",
  estados: "statuses",
  opcion: "option",
  opciones: "options",
  configuracion: "settings",
  configuraciones: "settings",
  documento: "document",
  documentos: "documents",
  archivo: "file",
  archivos: "files",
  imagen: "image",
  imagenes: "images",
  enlace: "link",
  comentario: "comment",
  comentarios: "comments",
  descripcion: "description",
  titulo: "title",
  nombre: "name",
  codigo: "code",
  numero: "number",
  detalle: "detail",
  detalles: "details",
  resumen: "summary",
  flujo: "flow",
  proceso: "process",
  procesos: "processes",
  endpoint: "endpoint",
  api: "api",
  modulo: "module",
  submodulo: "submodule",
  rama: "branch",
  ramas: "branches",
};

function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function applyPhrases(text: string) {
  let out = fold(text);
  for (const [from, to] of PHRASES) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return out;
}

const KNOWN_ENGLISH = new Set(
  Object.values(WORDS)
    .flatMap(v => v.split(/\s+/))
    .concat([
      "feat",
      "fix",
      "refactor",
      "chore",
      "docs",
      "test",
      "style",
      "perf",
      "ci",
      "build",
      "add",
      "update",
      "remove",
      "the",
      "a",
      "an",
      "and",
      "or",
      "for",
      "with",
      "to",
      "of",
      "in",
    ])
    .filter(Boolean)
);

function looksEnglishToken(token: string) {
  if (KNOWN_ENGLISH.has(token)) {
    return true;
  }
  return /^[a-z][a-z0-9-]*$/.test(token) && !/[aeiou]cion$/.test(token);
}

function translateToken(token: string) {
  if (/^\d+$/.test(token) || /^[a-z0-9]+[-_/][a-z0-9-_]+$/i.test(token)) {
    return token;
  }
  const mapped = WORDS[token];
  if (mapped !== undefined) {
    return mapped;
  }
  const verb = token.match(
    /^(.+?)(?:ar|er|ir|ando|iendo|ado|ido|cion|ciones|mente)$/
  );
  if (verb) {
    const fromStem = WORDS[verb[1]] ?? WORDS[`${verb[1]}ar`];
    if (fromStem) {
      return fromStem;
    }
  }
  return looksEnglishToken(token) ? token : token;
}

/** Lowercase English sentence from Spanish (or already-English) copy. */
export function toEnglish(text: string) {
  const withPhrases = applyPhrases(text);
  const tokens = withPhrases
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const translated = tokens
    .map(translateToken)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return translated;
}

export function toEnglishKebab(text: string) {
  return toEnglish(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
