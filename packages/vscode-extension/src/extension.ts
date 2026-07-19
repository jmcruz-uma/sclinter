import * as vscode from "vscode";
import * as path from "node:path";
import Parser from "web-tree-sitter";
import { buildRangedReport } from "./rules/report";

let parser: Parser | undefined;
let cppLanguage: Parser.Language | undefined;
let diagnostics: vscode.DiagnosticCollection;

const LANGUAGES_SOPORTADAS = new Set(["cpp", "c"]);

async function ensureParserReady(context: vscode.ExtensionContext): Promise<void> {
  if (parser && cppLanguage) return;

  await Parser.init();

  const wasmPath = vscode.Uri.joinPath(context.extensionUri, "assets", "tree-sitter-cpp.wasm").fsPath;
  cppLanguage = await Parser.Language.load(wasmPath);

  parser = new Parser();
  parser.setLanguage(cppLanguage);
}

function revisarDocumento(document: vscode.TextDocument): void {
  if (!LANGUAGES_SOPORTADAS.has(document.languageId)) return;
  if (!parser || !cppLanguage) return;

  const code = document.getText();
  const tree = parser.parse(code);

  // isC se decide por la EXTENSIÓN REAL del fichero (igual que el CLI),
  // no por el languageId que VS Code le asigne. Motivo (decisión
  // explícita del profesor): un .c se va a compilar con gcc, no con g++,
  // sea cual sea el modo de lenguaje que el estudiante fuerce manualmente
  // en el editor — el compilador real manda, no la vista del editor.
  const isC = path.extname(document.fileName).toLowerCase() === ".c";
  const findings = buildRangedReport(tree, cppLanguage, { isC });

  const diagnosticosDelFichero: vscode.Diagnostic[] = findings.map((f) => {
    const range = new vscode.Range(
      document.positionAt(f.startIndex),
      document.positionAt(f.endIndex)
    );
    const diag = new vscode.Diagnostic(range, f.message, vscode.DiagnosticSeverity.Warning);
    diag.source = "sclinter";
    diag.code = f.ruleId;
    return diag;
  });

  diagnostics.set(document.uri, diagnosticosDelFichero);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  diagnostics = vscode.languages.createDiagnosticCollection("sclinter");
  context.subscriptions.push(diagnostics);

  // El parser se inicializa una vez, en segundo plano, al activar la
  // extensión — así el primer guardado/apertura no tiene que esperar a
  // cargar el WASM además de analizar el fichero.
  const parserListo = ensureParserReady(context);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await parserListo;
      revisarDocumento(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      await parserListo;
      revisarDocumento(document);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sclinter.revisarAhora", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await parserListo;
      revisarDocumento(editor.document);
    })
  );

  // Revisar los ficheros .cpp/.c que ya estuvieran abiertos al activar
  // la extensión (por ejemplo, si VS Code se abre directamente sobre un
  // fichero en vez de sobre una carpeta vacía).
  parserListo.then(() => {
    for (const document of vscode.workspace.textDocuments) {
      revisarDocumento(document);
    }
  });
}

export function deactivate(): void {
  diagnostics?.dispose();
}
