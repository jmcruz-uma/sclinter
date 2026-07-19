#!/usr/bin/env node
// Ejecuta el CLI contra TODOS los ficheros de packages/core/test/*.cpp
// y *.c, y falla si alguno hace que el propio programa reviente
// (excepción no controlada). NO comprueba que el número de avisos sea
// el "correcto" — eso se ha ido verificando a mano, caso a caso, con
// `node packages/cli/out/bin/check.js <fichero>` durante el desarrollo
// de cada regla. Este script es la red de seguridad mínima: "¿sigue
// funcionando sin explotar en ningún caso conocido?", no una suite de
// aserciones completa.
//
// Antes de cada corrección de una regla, merece la pena volver a mirar
// a mano el fichero de test relacionado con esa regla (el nombre del
// checker suele estar en el propio fichero, como comentario) para
// confirmar que el número de avisos sigue siendo el esperado.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const TEST_DIR = path.join(__dirname, "..", "packages", "core", "test");
const CLI_BIN = path.join(__dirname, "..", "packages", "cli", "out", "bin", "check.js");

const archivos = fs
  .readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".cpp") || f.endsWith(".c"))
  .sort();

let fallos = 0;
for (const f of archivos) {
  try {
    execFileSync("node", [CLI_BIN, path.join(TEST_DIR, f)], { stdio: "pipe" });
    console.log(`OK   ${f}`);
  } catch (err) {
    fallos++;
    console.log(`FALLO ${f}`);
    console.log(err.stderr?.toString() ?? err.message);
  }
}

console.log(`\n${archivos.length - fallos}/${archivos.length} ficheros ejecutados sin errores.`);
if (fallos > 0) process.exit(1);
