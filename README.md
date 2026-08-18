# Trello Branch

Extensión para Cursor/VS Code que conecta tarjetas de Trello con ramas Git: empezar tarea, code review del proyecto, commit, push y PR.

## Quick path

1. Instala el `.vsix` (**Extensions: Install from VSIX…**).
2. Abre un repo con `package.json` (front) o `composer.json` (API).
3. Si la tarea toca API y cliente: configura `trelloBranch.companionRepoPath` al path del otro repo (ventanas separadas).
4. En la vista **Trello Branch**: inicia sesión → elige lista → empieza una tarea (solo este / este + companion).
5. Al terminar en cada ventana: code review en terminal → commit + push + PR. La tarjeta avanza cuando todos los repos de la tarea están cerrados.

## Qué hace

| Acción | Resultado |
|--------|-----------|
| Empezar tarea | Crea `Dev/Modulo-Submodulo` desde `develop` (configurable) y mueve la tarjeta a la siguiente lista |
| Rama ya existe | Pide un nombre alternativo |
| Terminar tarea | Code review en consola → commit + push + PR (`gh`) → vuelve a la rama base |
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
| `trelloBranch.companionRepoPath` | Path absoluto del otro repo (API/cliente) para tareas duales |

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
