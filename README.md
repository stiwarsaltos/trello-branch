# Trello Branch

Extensión para Cursor/VS Code que conecta tarjetas de Trello con ramas Git: empezar tarea, code review del proyecto, commit, push y PR.

## Quick path

1. Instala el `.vsix` (**Extensions: Install from VSIX…**).
2. Abre un repo con `package.json` (front) o `composer.json` (API).
3. Si la tarea toca API y cliente: en cada ventana usa **Trello: Configurar repo companion** (una vez por máquina; no va en `.vscode/settings.json`).
4. En la vista **Trello Branch**: inicia sesión → elige lista → empieza una tarea (solo la tarjeta).
5. Trabaja los cambios en la rama actual (p. ej. `develop`), en API y/o cliente.
6. Al terminar: se listan este repo y el companion; marcas cuáles tienen cambios de esta tarea → rama + code review + PR. La tarjeta avanza cuando esos repos están cerrados.

## Qué hace

| Acción | Resultado |
|--------|-----------|
| Empezar tarea | Marca la tarjeta activa y la mueve; no elige repos ni crea ramas |
| Rama ya existe | Al terminar, pide un nombre alternativo |
| Terminar tarea | Detecta cambios, confirmas repos → rama + code review + commit Conventional Commits + PR |
| Vista lateral | Cuenta, tarea activa (detalle + imágenes), lista y tareas asignadas |

La descripción de la tarjeta debe incluir `Modulo:` y `Submodulo:` (también usa `Descripción:` / `Ejemplo:`).

## Requisitos

- Cursor o VS Code
- Cuenta de Trello (login con token)
- Repo Git local
- GitHub CLI (`gh`) autenticado, para crear el PR
- Script `code-review` en `package.json` (front) o `composer.json` (API)

## Configuración

| Setting | Uso |
|---------|-----|
| `trelloBranch.listId` | Lista de origen (también con **Trello: Seleccionar lista**) |
| `trelloBranch.developerName` | Prefijo de rama; si vacío, primer nombre del perfil Trello |
| `trelloBranch.baseBranch` | Rama base (default: `develop`) |

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
- El **PR** usa el nombre de la tarjeta como título.
