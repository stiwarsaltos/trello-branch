import * as assert from "assert";
import * as vscode from "vscode";
import {
  ActiveTask,
  getActiveTask,
  getActiveTasks,
  removeActiveTask,
  saveActiveTask,
  uniqueBranchName,
} from "../taskState";

function memoryMemento(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = { ...initial };
  return {
    get: <T>(key: string, defaultValue?: T) =>
      ((store[key] as T | undefined) ?? defaultValue) as T,
    update: async (key: string, value: unknown) => {
      if (value === undefined) {
        delete store[key];
      } else {
        store[key] = value;
      }
    },
    keys: () => Object.keys(store),
  } as vscode.Memento;
}

function task(partial: Partial<ActiveTask> & Pick<ActiveTask, "cardId" | "cardName">): ActiveTask {
  return {
    cardDesc: "",
    branchName: `dev/${partial.cardId}`,
    repos: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

suite("tareas en paralelo", () => {
  test("uniqueBranchName no pisa la rama de otra tarea", () => {
    const tasks = [task({ cardId: "a", cardName: "A", branchName: "juan/Mod-Sub" })];
    assert.strictEqual(
      uniqueBranchName("juan/Mod-Sub", tasks, "b"),
      "juan/Mod-Sub-2"
    );
    assert.strictEqual(
      uniqueBranchName("juan/Mod-Sub", tasks, "a"),
      "juan/Mod-Sub"
    );
  });

  test("empezar otra tarea no reemplaza la anterior", async () => {
    const state = memoryMemento();
    await saveActiveTask(state, task({ cardId: "a", cardName: "Bugs login" }));
    await saveActiveTask(state, task({ cardId: "b", cardName: "Nueva factura" }));

    const tasks = getActiveTasks(state);
    assert.strictEqual(tasks.length, 2);
    assert.deepStrictEqual(
      tasks.map(item => item.cardId),
      ["a", "b"]
    );
  });

  test("actualizar una tarea deja intacta la otra", async () => {
    const state = memoryMemento();
    await saveActiveTask(state, task({ cardId: "a", cardName: "A", branchName: "a" }));
    await saveActiveTask(state, task({ cardId: "b", cardName: "B", branchName: "b" }));
    await saveActiveTask(
      state,
      task({ cardId: "a", cardName: "A", branchName: "a-renamed" })
    );

    const tasks = getActiveTasks(state);
    assert.strictEqual(tasks.find(item => item.cardId === "b")?.branchName, "b");
    assert.strictEqual(
      tasks.find(item => item.cardId === "a")?.branchName,
      "a-renamed"
    );
  });

  test("quitar una tarea no borra las demás", async () => {
    const state = memoryMemento();
    await saveActiveTask(state, task({ cardId: "a", cardName: "A" }));
    await saveActiveTask(state, task({ cardId: "b", cardName: "B" }));
    await removeActiveTask(state, undefined, "a");

    const tasks = getActiveTasks(state);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].cardId, "b");
  });

  test("migra la tarea única antigua", () => {
    const state = memoryMemento({
      "trelloBranch.activeTask": task({ cardId: "legacy", cardName: "Vieja" }),
    });
    const tasks = getActiveTasks(state);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].cardId, "legacy");
    assert.strictEqual(getActiveTask(state)?.cardId, "legacy");
  });

  test("getActiveTask sin cardId es undefined si hay varias", async () => {
    const state = memoryMemento();
    await saveActiveTask(state, task({ cardId: "a", cardName: "A" }));
    await saveActiveTask(state, task({ cardId: "b", cardName: "B" }));
    assert.strictEqual(getActiveTask(state), undefined);
    assert.strictEqual(getActiveTask(state, undefined, "b")?.cardName, "B");
  });
});
