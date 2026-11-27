import * as assert from "assert";
import { fallbackCommitMessage, scopeFromModule, StagedChangeSet } from "../commitMessage";

const controllerDiff = [
  "diff --git a/app/Http/Controllers/Education/StudentController.php b/app/Http/Controllers/Education/StudentController.php",
  "index 111..222 100644",
  "--- a/app/Http/Controllers/Education/StudentController.php",
  "+++ b/app/Http/Controllers/Education/StudentController.php",
  "@@ -10,6 +10,9 @@ class StudentController",
  "     public function index()",
  "     {",
  "+        public function enrolledStudents()",
  "+        {",
  "+            return $this->studentRepository->enrolled();",
  "         return view(\"education.students.index\");",
  "     }",
].join("\n");

const viewDiff = [
  "diff --git a/resources/views/cuentas/permisos/index.blade.php b/resources/views/cuentas/permisos/index.blade.php",
  "index 111..222 100644",
  "--- a/resources/views/cuentas/permisos/index.blade.php",
  "+++ b/resources/views/cuentas/permisos/index.blade.php",
  "@@ -4,3 +4,4 @@",
  " <div>",
  "+    <button type=\"submit\">Guardar</button>",
  " </div>",
].join("\n");

function staged(file: string, diff: string): StagedChangeSet {
  return { files: [file], added: [], deleted: [], diff };
}

suite("mensaje de commit", () => {
  test("el scope sale del módulo y no de la carpeta técnica", () => {
    assert.strictEqual(
      scopeFromModule({
        module: "Cuentas y Usuarios",
        submodule: "Cuentas y Permisos",
      }),
      "accounts-permissions"
    );

    const message = fallbackCommitMessage(
      staged("app/Http/Controllers/Education/StudentController.php", controllerDiff),
      { module: "Cuentas y Usuarios", submodule: "Cuentas y Permisos" }
    );
    const header = message.split("\n")[0];
    assert.ok(header.startsWith("feat(accounts-permissions):"), header);
    assert.ok(!header.includes("(controllers)"), header);
    assert.ok(/enrolled/i.test(header), header);
  });

  test("sin módulo, el scope es la carpeta de negocio", () => {
    const message = fallbackCommitMessage(
      staged("app/Http/Controllers/Education/StudentController.php", controllerDiff)
    );
    const header = message.split("\n")[0];
    assert.ok(header.startsWith("feat(education):"), header);
    assert.ok(!header.includes("(controllers)"), header);
  });

  test("un cambio sin símbolos usa el módulo en vez de un nombre genérico", () => {
    const message = fallbackCommitMessage(
      staged("resources/views/cuentas/permisos/index.blade.php", viewDiff),
      { module: "Cuentas y Usuarios", submodule: "Cuentas y Permisos" }
    );
    const header = message.split("\n")[0];
    assert.strictEqual(
      header,
      "feat(accounts-permissions): update accounts permissions"
    );
    assert.ok(!/views|index|files|module/i.test(header), header);
  });
});
