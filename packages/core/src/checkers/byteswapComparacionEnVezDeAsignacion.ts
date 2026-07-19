import Parser from "web-tree-sitter";

// Regla: una sentencia completa que es una COMPARACIÓN (==) contra una
// llamada a htons/ntohs/std::byteswap, en vez de una ASIGNACIÓN (=). El
// resultado de la conversión se descarta — la variable de la izquierda
// nunca se actualiza. Es un error puramente sintáctico: una comparación
// usada como sentencia completa no tiene ningún efecto observable
// (mismo aviso que -Wunused-value del compilador daría en general, pero
// aquí el mensaje es específico y mucho más orientador que el genérico).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SWAP_FUNCS = ["htons", "ntohs", "htonl", "ntohl", "byteswap"];

export function findByteswapComparacionEnVezDeAsignacionIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "expression_statement") {
      const expr = n.namedChildren[0];
      if (expr?.type === "binary_expression") {
        const op = expr.childForFieldName("operator")?.text;
        if (op === "==") {
          const left = expr.childForFieldName("left");
          const right = expr.childForFieldName("right");
          for (const [target, other] of [
            [left, right],
            [right, left],
          ] as const) {
            if (target?.type !== "identifier") continue;
            if (other?.type !== "call_expression") continue;
            const func = other.childForFieldName("function");
            const bare = func?.text.replace(/^.*::/, "");
            if (bare && SWAP_FUNCS.includes(bare)) {
              findings.push({
                startIndex: expr.startIndex,
                endIndex: expr.endIndex,
                message:
                  `Esta línea compara (==) en vez de asignar (=) — ${target.text} nunca recibe el ` +
                  `resultado de ${bare}(...), la comparación se descarta sin efecto. ¿Querías ` +
                  `"${target.text} = ${other.text};"?`,
              });
            }
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
