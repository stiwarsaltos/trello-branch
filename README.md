# Trello Branch

Extensión para Cursor/VS Code que conecta tarjetas de Trello con ramas Git: empezar tarea, code review del proyecto, commit, push y PR.

## Quick path

1. Instala el `.vsix` (**Extensions: Install from VSIX…**).
2. Abre un repo con `package.json` (front) o `composer.json` (API).
3. Si la tarea toca API y cliente: en cada ventana usa **Trello: Configurar repo companion** (una vez por máquina; no va en `.vscode/settings.json`).
4. En la vista **Trello Branch**: inicia sesión en Trello y GitHub → tableros **BUGS** y **NUEVAS FUNCIONALIDADES** (puedes agregar más) → empieza una o varias tareas.
5. Trabaja los cambios en la rama actual (p. ej. `develop`), en API y/o cliente.
6. Al terminar: se listan este repo y el companion; marcas cuáles tienen cambios de esta tarea → rama + code review + PR. La tarjeta avanza cuando esos repos están cerrados.

## Qué hace

| Acción | Resultado |
|--------|-----------|
| Empezar tarea | Marca la tarjeta en curso y la mueve; no pisa otras tareas abiertas |
| Regresar tarea | Devuelve **esa** tarjeta a la lista de origen, sin tocar las demás |
| Rama ya existe | Si no tiene PR abierto, la ocupa; si está en uso, pide otro nombre |
| Terminar tarea | Detecta cambios → rama + code review + PR. Al pasar la tarjeta: comentario Pull en front/back y Comando si hay uno nuevo |
| Vista lateral | Cuenta, tareas en curso (varias a la vez), tableros y asignadas |

Puedes tener **varias tareas en curso**. Terminar o regresar una no borra ni mueve las otras. Si dos tarjetas pedirían la misma rama, la nueva lleva sufijo `-2`. Al terminar, no se vuelve a `develop` si aún hay otras tareas abiertas.

El RUC se lee del campo **RUC EMPRESA** en Amazing Fields (Power-Up), descomprimiendo el `pluginData` de Trello. No va en el PR.

## Requisitos

- Cursor o VS Code
- Cuenta de Trello (login con token)
- Cuenta de GitHub en el editor (Cuentas → GitHub, permiso `repo`)
- Repo Git local con remote `origin` en GitHub
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

- El token de Trello se guarda en Secret Storage del editor (no en Settings).
- GitHub usa la sesión del editor (**GitHub: Iniciar sesión**, o Cuentas abajo a la izquierda). No hay que pegar un PAT. Si la org restringe OAuth, autoriza la app de GitHub del editor.
- El **owner/repo** del PR se lee del remote `origin`; no hace falta configurarlo.
- El `git push` sigue usando tus credenciales de Git (SSH o credential helper), no el token de la extensión.
- Las imágenes de la tarea activa se pueden previsualizar desde el árbol.
- Si el code review falla (exit ≠ 0), no se hace commit/push/PR.
- El **commit** describe **los cambios del diff** (funciones/archivos añadidos o quitados), en Conventional Commits en inglés. El título de Trello no entra en el commit; sí va en el PR.
- El **PR** usa el nombre de la tarjeta como título. La descripción del PR no incluye imágenes, Ejemplo, RUC ni datos de empresa.
