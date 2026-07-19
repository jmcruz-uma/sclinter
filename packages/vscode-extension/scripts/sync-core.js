#!/usr/bin/env node
// Copia el código fuente de @sclinter/core dentro de la propia
// extensión, antes de compilarla y empaquetarla con vsce.
//
// POR QUÉ: vsce (la herramienta que genera el .vsix) no gestiona bien los
// paquetes enlazados por npm workspaces — en vez de arriesgarnos a que
// intente resolver el enlace simbólico a packages/core mal, la extensión
// no depende de core en tiempo de ejecución en absoluto. Este script deja
// una copia autocontenida, y vsce empaqueta esa copia como si fuera
// código propio de la extensión — mismo resultado, cero riesgo de que la
// herramienta de terceros se confunda con el monorepo.
//
// Este script se ejecuta SIEMPRE antes de compilar la extensión (ver
// "build:extension" en el package.json raíz) — nunca se edita a mano el
// código dentro de packages/vscode-extension/src/checkers/ ni
// src/rules/: cualquier cambio real va en packages/core/src/, y este
// script lo replica.

const fs = require("node:fs");
const path = require("node:path");

const CORE_DIR = path.join(__dirname, "..", "..", "core");
const EXT_DIR = path.join(__dirname, "..");

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(path.join(CORE_DIR, "src", "checkers"), path.join(EXT_DIR, "src", "checkers"));
copyDir(path.join(CORE_DIR, "src", "rules"), path.join(EXT_DIR, "src", "rules"));

fs.mkdirSync(path.join(EXT_DIR, "assets"), { recursive: true });
fs.copyFileSync(
  path.join(CORE_DIR, "assets", "tree-sitter-cpp.wasm"),
  path.join(EXT_DIR, "assets", "tree-sitter-cpp.wasm")
);

console.log("sync-core: copiado src/checkers, src/rules y assets/tree-sitter-cpp.wasm desde packages/core.");
