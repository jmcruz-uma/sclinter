import Parser from "web-tree-sitter";

// Regla de NORMATIVA de la asignatura (no heurística de riesgo, como
// memcpy-string-data-prohibido): read(0, ...) o read(STDIN_FILENO, ...)
// está prohibido siempre, sea cual sea el tipo del destino — no solo
// cuando el destino es claramente numérico.
//
// Motivo (criterio del profesor): en esta asignatura, toda entrada por
// teclado se trata como una secuencia de caracteres, y hay que usar
// std::cin/std::getline. read() sobre el teclado arrastra fallos
// típicos aunque el destino sea un buffer de bytes: olvidar el '\0'
// final, o acabar escribiendo directamente sobre un std::string (que en
// esta asignatura también está restringido, ver memcpy-string-data-prohibido).
//
// No mira el tipo del destino en absoluto — a propósito, es una
// prohibición de la función sobre ese descriptor, no del tipo del dato.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

function isStdinFd(node: Parser.SyntaxNode): boolean {
  if (node.type === "number_literal" && node.text === "0") return true;
  if (node.type === "identifier" && node.text === "STDIN_FILENO") return true;
  return false;
}

export function findReadDesdeTecladoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (bare === "read") {
        const args = n.childForFieldName("arguments");
        const fdArg = args?.namedChildren[0];
        if (fdArg && isStdinFd(fdArg)) {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              "En esta asignatura, la entrada por teclado se trata siempre como una secuencia de " +
              "caracteres — usa std::cin o std::getline() en vez de read() aquí.",
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
