import Parser from "web-tree-sitter";

// Regla de ESTILO, no de bug: memcpy(&arr, ...) o memcpy(..., &arr, ...)
// donde `arr` es un std::array es código correcto (comprobado: para
// std::array, &arr == arr.data(), no tiene representación interna oculta,
// a diferencia de std::string/std::vector — ver memcpyContainerAddressDestination.ts).
//
// Se marca de todas formas por decisión pedagógica del profesor: un único
// hábito ("siempre .data() sobre un contenedor, nunca &contenedor") que
// generaliza bien a todos los contenedores de la STL, en vez de que el
// estudiante tenga que recordar cuáles son "seguros" con & y cuáles no.
// El mensaje debe dejar claro que es una norma de estilo, NO un error de
// comportamiento indefinido — sería falso decir lo segundo.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const MEMCPY_QUERY = `
(call_expression
  function: (_) @func
  arguments: (argument_list
    . (_) @arg0
    . (_) @arg1
    . (_) @arg2
    .)
) @call
`;

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Nombres declarados como std::array<T, N> dentro de la función. */
function arrayVarNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        const typeText = typeNode.text.replace(/\s+/g, "");
        if (/^(std::)?array<.+>$/.test(typeText)) {
          let cur: Parser.SyntaxNode | null = declNode;
          while (cur && cur.type !== "identifier") {
            cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
          }
          if (cur) names.add(cur.text);
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }

  walk(functionNode);
  return names;
}

export function findMemcpyArrayAddressStyleIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(MEMCPY_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !arg1 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    const fn = enclosingFunction(callNode);
    if (!fn) continue;
    const arrays = arrayVarNames(fn);

    for (const [argNode, rol] of [
      [arg0, "destino"],
      [arg1, "origen"],
    ] as const) {
      if (argNode.type !== "pointer_expression") continue;
      const target = argNode.childForFieldName("argument");
      if (!target || target.type !== "identifier") continue;
      if (!arrays.has(target.text)) continue;

      findings.push({
        startIndex: argNode.startIndex,
        endIndex: argNode.endIndex,
        message:
          `[estilo, no error] &${target.text} funciona correctamente aquí como ${rol} — para ` +
          `std::array, &variable y variable.data() son la misma dirección. Aun así, en esta ` +
          `asignatura se usa siempre ${target.text}.data() sobre contenedores, por consistencia ` +
          `con std::string y std::vector (donde & sí sería un error).`,
      });
    }
  }

  return findings;
}
