import Parser from "web-tree-sitter";

// Regla: se usa fd[0] o fd[1] en read()/write()/read_n()/write_n() ANTES
// de que, en la misma función, se haya llamado a pipe(fd). Mismo patrón
// que accept-sin-listen: el nombre del array de descriptores se lee
// directamente del argumento de pipe(...), sin necesitar saber cómo
// se declaró esa variable.
//
// Si no hay ninguna llamada a pipe(...) en la función, no se avisa
// (no hay base para establecer el orden) — mismo criterio aplicado tras
// el fallo real que se corrigió en fork-antes-de-accept.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

interface PipeCall {
  arrayName: string;
  startIndex: number;
}

function findPipeCalls(root: Parser.SyntaxNode): PipeCall[] {
  const results: PipeCall[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func && /(^|::)pipe$/.test(func.text)) {
        const args = n.childForFieldName("arguments");
        const first = args?.namedChildren[0];
        if (first?.type === "identifier") {
          results.push({ arrayName: first.text, startIndex: n.startIndex });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return results;
}

/** Si `node` es ARRAY[algo], devuelve el nombre de ARRAY; si no, null. */
function subscriptArrayName(node: Parser.SyntaxNode): string | null {
  if (node.type !== "subscript_expression") return null;
  const arg = node.childForFieldName("argument");
  return arg?.type === "identifier" ? arg.text : null;
}

const IO_FUNCS = ["read", "read_n", "write", "write_n"];

export function findPipeUsoAntesDeCrearIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const pipeCalls = findPipeCalls(n);
      if (pipeCalls.length > 0) {
        const earliestByName = new Map<string, number>();
        for (const p of pipeCalls) {
          const prev = earliestByName.get(p.arrayName);
          if (prev === undefined || p.startIndex < prev) earliestByName.set(p.arrayName, p.startIndex);
        }

        function walkForIo(m: Parser.SyntaxNode) {
          if (m.type === "call_expression") {
            const func = m.childForFieldName("function");
            const bare = func?.text.replace(/^.*::/, "");
            if (func && bare && IO_FUNCS.includes(bare)) {
              const args = m.childForFieldName("arguments");
              const first = args?.namedChildren[0];
              const arrayName = first ? subscriptArrayName(first) : null;
              if (arrayName) {
                const pipePos = earliestByName.get(arrayName);
                if (pipePos !== undefined && m.startIndex < pipePos) {
                  findings.push({
                    startIndex: m.startIndex,
                    endIndex: m.endIndex,
                    message:
                      `Se usa ${first!.text} aquí, pero pipe(${arrayName}) todavía no se ha llamado en ` +
                      `este punto de la función. El descriptor no existe todavía.`,
                  });
                }
              }
            }
          }
          for (const child of m.namedChildren) walkForIo(child);
        }
        walkForIo(n);
      }
    }
    for (const child of n.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
