import Parser from "web-tree-sitter";

// Regla: dentro de una función, se compara `argc` con una constante K
// (típicamente `argc != K` o `argc < K`), pero luego se accede a
// `argv[N]` con N >= K. Si la comprobación garantiza como mucho índices
// 0..K-1, acceder a argv[K] o más allá es memoria fuera de lo comprobado.
//
// Heurística: toma K de la primera comparación numérica contra `argc`
// que encuentre en la función, y compara contra el índice literal más
// alto usado en argv[...]. No entiende la lógica completa (por ejemplo
// varias comprobaciones combinadas), así que puede haber falsos negativos,
// pero no debería dar falsos positivos en los patrones típicos.
//
// CORRECCIÓN (falso positivo real, alumno_019 del corpus): el operador
// tiene que ser de COMPARACIÓN (== != < <= > >=). Antes se aceptaba
// cualquier `binary_expression` de `argc` con un número, así que una
// RESTA como `int num = argc - 1;` (número de argumentos, nada que ver
// con validar argc) se leía como "argc comparado contra 1" y disparaba
// avisos sobre argv[1..] en programas que no validan argc en absoluto.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const ARGC_CMP_QUERY = `
(binary_expression
  left: (identifier) @lhs
  right: (number_literal) @rhs) @cmp
`;

// Solo estos operadores garantizan algo sobre argc; una resta/suma no.
const COMPARISON_OPERATORS = new Set(["==", "!=", "<", "<=", ">", ">="]);

const ARGV_INDEX_QUERY = `
(subscript_expression
  argument: (identifier) @arr
  (subscript_argument_list (number_literal) @idx)) @sub
`;

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

export function findArgcArgvMismatchIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const cmpQuery = language.query(ARGC_CMP_QUERY);
  const idxQuery = language.query(ARGV_INDEX_QUERY);

  // K por función: el primer literal comparado contra argc que aparezca.
  const kByFunction = new Map<number, { k: number; node: Parser.SyntaxNode }>();

  for (const match of cmpQuery.matches(tree.rootNode)) {
    const lhs = match.captures.find((c) => c.name === "lhs")?.node;
    const rhs = match.captures.find((c) => c.name === "rhs")?.node;
    const cmp = match.captures.find((c) => c.name === "cmp")?.node;
    if (!lhs || !rhs || !cmp) continue;
    if (lhs.text !== "argc") continue;

    const operator = cmp.childForFieldName("operator")?.text;
    if (!operator || !COMPARISON_OPERATORS.has(operator)) continue;

    const fn = enclosingFunction(cmp);
    if (!fn) continue;
    if (kByFunction.has(fn.startIndex)) continue; // ya tenemos K para esta función

    const k = parseInt(rhs.text, 10);
    if (Number.isNaN(k)) continue;
    kByFunction.set(fn.startIndex, { k, node: cmp });
  }

  const findings: Finding[] = [];

  for (const match of idxQuery.matches(tree.rootNode)) {
    const arr = match.captures.find((c) => c.name === "arr")?.node;
    const idx = match.captures.find((c) => c.name === "idx")?.node;
    const sub = match.captures.find((c) => c.name === "sub")?.node;
    if (!arr || !idx || !sub) continue;
    if (arr.text !== "argv") continue;

    const fn = enclosingFunction(sub);
    if (!fn) continue;
    const kInfo = kByFunction.get(fn.startIndex);
    if (!kInfo) continue;

    const n = parseInt(idx.text, 10);
    if (Number.isNaN(n)) continue;

    if (n >= kInfo.k) {
      findings.push({
        startIndex: sub.startIndex,
        endIndex: sub.endIndex,
        message:
          `Se compara argc contra ${kInfo.k} en esta función, lo que como mucho garantiza ` +
          `argv[0]..argv[${kInfo.k - 1}]. Aquí se accede a argv[${n}], fuera de lo comprobado.`,
      });
    }
  }

  return findings;
}
