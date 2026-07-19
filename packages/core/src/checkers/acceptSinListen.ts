import Parser from "web-tree-sitter";

// Regla: se llama a accept(...) sin que antes, en la misma función,
// haya una llamada a listen(...). Comprobación de orden textual simple:
// posición de listen() < posición de accept().
//
// Mensaje deliberadamente sutil (a petición expresa): no dice "falta
// listen()", solo indica que el socket no se ha preparado como servidor
// — el estudiante tiene que darse cuenta de qué falta, no que se lo digamos.

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

/** Todas las llamadas a `name` dentro del árbol, con su posición. */
function findCalls(root: Parser.SyntaxNode, name: string): Parser.SyntaxNode[] {
  const calls: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func && new RegExp(`(^|::)${name}$`).test(func.text)) calls.push(n);
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return calls;
}

export function findAcceptSinListenIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const acceptCalls = findCalls(tree.rootNode, "accept");

  const byFunction = new Map<number, Parser.SyntaxNode[]>();
  for (const call of acceptCalls) {
    const fn = enclosingFunction(call);
    if (!fn) continue;
    const list = byFunction.get(fn.startIndex) ?? [];
    list.push(call);
    byFunction.set(fn.startIndex, list);
  }

  for (const [, calls] of byFunction) {
    const fn = enclosingFunction(calls[0])!;
    const listenCalls = findCalls(fn, "listen");
    const firstListen = listenCalls.length > 0 ? Math.min(...listenCalls.map((c) => c.startIndex)) : null;

    for (const acceptCall of calls) {
      if (firstListen === null || firstListen > acceptCall.startIndex) {
        findings.push({
          startIndex: acceptCall.startIndex,
          endIndex: acceptCall.endIndex,
          message: "El socket de conexión no se ha iniciado como servidor.",
        });
      }
    }
  }

  return findings;
}
