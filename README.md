# Trello Branch

Extensión para Cursor/VS Code que conecta tarjetas de Trello con ramas Git: empezar tarea, code review del proyecto, commit, push y PR.

## Quick path

1. Instala el `.vsix` (**Extensions: Install from VSIX…**).
2. Abre un repo con `package.json` (front) o `composer.json` (API).
3. Si la tarea toca API y cliente: en cada ventana usa **Trello: Configurar repo companion** (una vez por máquina; no va en `.vscode/settings.json`).
4. En la vista **Trello Branch**: inicia sesión → tableros **BUGS** y **NUEVAS FUNCIONALIDADES** (puedes agregar más) → empieza una tarea.
5. Trabaja los cambios en la rama actual (p. ej. `develop`), en API y/o cliente.
6. Al terminar: se listan este repo y el companion; marcas cuáles tienen cambios de esta tarea → rama + code review + PR. La tarjeta avanza cuando esos repos están cerrados.

## Qué hace

| Acción | Resultado |
|--------|-----------|
| Empezar tarea | Marca la tarjeta activa y la mueve; no elige repos ni crea ramas |
| Regresar tarea | Devuelve la tarjeta a la lista de origen al instante, sin confirmar |
| Rama ya existe | Si no tiene PR abierto, la ocupa; si está en uso, pide otro nombre |
| Terminar tarea | Detecta cambios → rama + code review + PR. Al pasar la tarjeta: comentario Pull en front/back y Comando si hay uno nuevo |
| Vista lateral | Cuenta, tarea activa, tableros (BUGS y NUEVAS FUNCIONALIDADES por defecto) y tareas asignadas |

El RUC se lee del campo **RUC EMPRESA** en Amazing Fields (Power-Up), descomprimiendo el `pluginData` de Trello. No va en el PR.

## Requisitos

- Cursor o VS Code
- Cuenta de Trello (login con token)
- Repo Git local
- GitHub CLI (`gh`) autenticado, para crear el PR
- Script `code-review` en `package.json` (front) o `composer.json` (API)

## Configuración

| Setting | Uso |
|---------|-----|
| `trelloBranch.developerName` | Prefijo de rama; si vacío, primer nombre del perfil Trello |
| `trelloBranch.baseBranch` | Rama base (default: `develop`) |

**Tableros:** por defecto **BUGS** y **NUEVAS FUNCIONALIDADES** (se vinculan por nombre al tablero de Trello). **Trello: Agregar tablero** suma otros. Las tareas asignadas salen de la primera lista de cada tablero.

**Repo companion (API + cliente):** comando **Trello: Configurar repo companion**. Se guarda en tu Cursor (globalState), asociado al repo abierto. Cada desarrollador configura su ruta local sin conflictos en git.

## Empaquetar

```bash
npm run package
npx @vscode/vsce package
```

Instala el `.vsix` generado con **Extensions: Install from VSIX…**.

## Notas

- El token de Trello se guarda en Secret Storage del editor.
- Las imágenes de la tarea activa se pueden previsualizar desde el árbol.
- Si el code review falla (exit ≠ 0), no se hace commit/push/PR.
- El **commit** describe **los cambios del diff** (funciones/archivos añadidos o quitados), en Conventional Commits en inglés. El título de Trello no entra en el commit; sí va en el PR.
- El **PR** usa el nombre de la tarjeta como título. La descripción del PR no incluye imágenes, Ejemplo, RUC ni datos de empresa.
