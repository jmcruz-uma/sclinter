#!/usr/bin/env node
// Empaqueta la extensión en un directorio TEMPORAL, fuera del monorepo
// por completo (ni siquiera es un subdirectorio de packages/) y sin
// ninguna configuración de npm workspaces de por medio.
//
// POR QUÉ ESTE RODEO: se comprobó en la práctica que `vsce package`
// ejecutado directamente dentro de packages/vscode-extension (aunque esa
// carpeta tuviera su propio node_modules aislado, sin workspaces) sigue
// listando ficheros duplicados y se cuela fuera de la carpeta de la
// extensión (hacia ../core) — vsce internamente no maneja bien estar
// anidado dentro de la carpeta de un monorepo con workspaces, aunque el
// paquete en sí no dependa de ningún otro paquete del repo. La solución
// robusta no es intentar adivinar qué confunde a vsce, sino no darle la
// oportunidad: se copia todo lo necesario a un directorio nuevo, fuera
// del monorepo, se instala y se empaqueta ahí, y se trae el .vsix de
// vuelta. Es el mismo entorno, byte a byte, que un proyecto de extensión
// independiente (que sí funcionaba sin problemas).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const EXT_DIR = path.join(__dirname, "..");
const CORE_DIR = path.join(__dirname, "..", "..", "core");
const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const STAGING = fs.mkdtempSync(path.join(os.tmpdir(), "sclinter-vsix-"));

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log("Directorio de empaquetado aislado:", STAGING);

// 1) Ficheros propios de la extensión (código fuente y manifiesto, NO el
//    "out/" ni "node_modules" ni checkers/rules sincronizados antes).
for (const f of ["package.json", "tsconfig.json", ".vscodeignore", "icon.png", "README.md"]) {
  const srcPath = path.join(EXT_DIR, f);
  if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, path.join(STAGING, f));
}
// La licencia vive en la raíz del monorepo (única copia, sin duplicar), pero
// tiene que viajar DENTRO del .vsix: MIT exige conservar el aviso de copyright
// en las distribuciones, y vsce además avisa si no encuentra un LICENSE. Se
// copia aquí desde la raíz al staging para que quede empaquetada en la extensión.
const licenseSrc = path.join(ROOT_DIR, "LICENSE");
if (fs.existsSync(licenseSrc)) fs.copyFileSync(licenseSrc, path.join(STAGING, "LICENSE"));
copyDir(path.join(EXT_DIR, "src"), path.join(STAGING, "src"));
// El sync-core ya habrá dejado src/checkers y src/rules copiados desde
// core — pero por si acaso se empaqueta sin haber sincronizado antes,
// se sincroniza aquí también directamente desde core, para que este
// script sea seguro de ejecutar de forma aislada.
copyDir(path.join(CORE_DIR, "src", "checkers"), path.join(STAGING, "src", "checkers"));
copyDir(path.join(CORE_DIR, "src", "rules"), path.join(STAGING, "src", "rules"));
fs.mkdirSync(path.join(STAGING, "assets"), { recursive: true });
fs.copyFileSync(
  path.join(CORE_DIR, "assets", "tree-sitter-cpp.wasm"),
  path.join(STAGING, "assets", "tree-sitter-cpp.wasm")
);

// 2) Instalación totalmente limpia, sin ningún contexto de workspace —
//    STAGING no tiene ningún ancestro con "workspaces" en su package.json.
execSync("npm install", { cwd: STAGING, stdio: "inherit" });

// 3) Compilar y empaquetar.
execSync("npx tsc -p ./", { cwd: STAGING, stdio: "inherit" });
execSync("npx vsce package", { cwd: STAGING, stdio: "inherit" });

// 4) Traer el .vsix generado de vuelta a packages/vscode-extension/.
const vsixFile = fs.readdirSync(STAGING).find((f) => f.endsWith(".vsix"));
if (!vsixFile) {
  console.error("No se generó ningún .vsix en el directorio aislado.");
  process.exit(1);
}
fs.copyFileSync(path.join(STAGING, vsixFile), path.join(EXT_DIR, vsixFile));
console.log(`\n.vsix copiado de vuelta a packages/vscode-extension/${vsixFile}`);

// 5) Limpieza del directorio temporal.
fs.rmSync(STAGING, { recursive: true, force: true });
