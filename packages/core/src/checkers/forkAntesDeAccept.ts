import Parser from "web-tree-sitter";

// Regla: fork() aparece ANTES que la primera llamada a accept() en la
// misma función. En el patrón de servidor con proceso por conexión que
// se enseña en esta asignatura, el orden esperado es accept() -> fork()
// dentro del bucle de atención a clientes; forkar antes de aceptar ninguna
// conexión no da el descriptor correcto al hijo.
//
// LIMITACIÓN CONOCIDA: solo mira orden textual dentro de la misma función,
// no rutas de ejecución. Si el fork() está deliberadamente antes por un
// motivo distinto (p. ej. un proceso auxiliar no relacionado con las
// conexiones), esta regla no lo sabe distinguir y avisaría igual — es un
// patrón pensado para el diseño que se enseña en el curso, no una verdad
// universal de todo programa con sockets.

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

export function findForkAntesDeAcceptIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const forkCalls = findCalls(tree.rootNode, "fork");

  const byFunction = new Map<number, Parser.SyntaxNode[]>();
  for (const call of forkCalls) {
    const fn = enclosingFunction(call);
    if (!fn) continue;
    const list = byFunction.get(fn.startIndex) ?? [];
    list.push(call);
    byFunction.set(fn.startIndex, list);
  }

  for (const [, calls] of byFunction) {
    const fn = enclosingFunction(calls[0])!;
    const acceptCalls = findCalls(fn, "accept");
    const firstAccept = acceptCalls.length > 0 ? Math.min(...acceptCalls.map((c) => c.startIndex)) : null;

    for (const forkCall of calls) {
      if (firstAccept !== null && forkCall.startIndex < firstAccept) {
        findings.push({
          startIndex: forkCall.startIndex,
          endIndex: forkCall.endIndex,
          message: "Este fork() ocurre antes de aceptar ninguna conexión. Revisa el orden respecto a accept().",
        });
      }
    }
  }

  return findings;
}
