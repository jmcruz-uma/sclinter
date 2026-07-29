import Parser from "web-tree-sitter";
import { VARIANTES_READ_N } from "./funcionesDeES";

// Regla: read_n(0, ...) o read_n(STDIN_FILENO, ...). read_n está pensada
// para exigir un número EXACTO de bytes (típico de un socket o pipe
// donde el protocolo ya fija el tamaño del campo) — sobre el teclado no
// tiene sentido: el usuario teclea una cantidad variable de caracteres
// y pulsa Intro, no un número de bytes fijo conocido de antemano. Se
// avisa independientemente del tipo del destino.
//
// Se aplica IGUAL a C y a C++ (a propósito, sin cppOnly): read_n() en sí
// no es una función de C++ — es de estilo C (fd, void*, size_t) — y el
// problema de fondo (read_n exige tamaño fijo, el teclado no lo tiene)
// es igual de real en los dos lenguajes. Se corrigió una versión anterior
// que la marcaba cppOnly por error, arrastrada de que el mensaje ANTIGUO
// sugería "usa std::cin" como solución — eso sí era de C++, pero era solo
// la redacción de la solución, no el patrón del bug en sí. El mensaje ya
// no sugiere ninguna solución concreta, solo describe el problema.

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

export function findReadNEnTecladoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      // Familia A: SOLO los helpers. La regla dice que read_n exige un número
      // exacto de bytes y el teclado no lo tiene; con `read` a secas ese
      // argumento no vale, así que aquí no entran read/recv.
      if (bare && VARIANTES_READ_N.includes(bare)) {
        const args = n.childForFieldName("arguments");
        const fdArg = args?.namedChildren[0];
        if (fdArg && isStdinFd(fdArg)) {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              "read_n() exige un número exacto de bytes, y está pensado para sockets/tuberías " +
              "(no para el teclado, que lee una secuencia de caracteres de longitud variable).",
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
