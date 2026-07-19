import Parser from "web-tree-sitter";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildReport, formatReport } from "@sclinter/core";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Uso: node check.js <fichero.cpp>");
    process.exit(1);
  }

  await Parser.init();
  // El .wasm vive en el paquete core (única fuente de verdad), se
  // localiza a través de require.resolve en vez de una ruta relativa
  // fija — así funciona igual sea cual sea la profundidad de node_modules
  // que use el gestor de paquetes.
  const corePkgPath = require.resolve("@sclinter/core/package.json");
  const wasmPath = path.join(path.dirname(corePkgPath), "assets", "tree-sitter-cpp.wasm");
  const Cpp = await Parser.Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(Cpp);

  const code = fs.readFileSync(target, "utf8");
  const tree = parser.parse(code);

  const isC = path.extname(target).toLowerCase() === ".c";
  const findings = buildReport(code, tree, Cpp, { isC });
  console.log(formatReport(path.basename(target), findings));

  // Código de salida 0 siempre: esto es un aviso, no un bloqueo de entrega.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
