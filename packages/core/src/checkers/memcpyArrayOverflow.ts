import Parser from "web-tree-sitter";

// Regla: memcpy(array.data(), ..., n) o memcpy(..., array.data(), n)
// donde `array` es un std::array<T, N> declarado en la misma función,
// y n es un literal mayor que N.
//
// A diferencia de std::string o std::vector, el tamaño de std::array
// es un parámetro de plantilla — se conoce en tiempo de compilación,
// literalmente escrito en la declaración. Por eso esta regla SÍ es
// completamente estática y fiable, mientras que "capacity() de un
// contenedor cualquiera" en general no lo es (esa es información en
// tiempo de ejecución que puede cambiar con resize/reserve, y un
// checker sintáctico no puede seguirle la pista sin ejecutar el código).

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

/** Mapa nombre -> N para std::array<T, N> declarados en la función. */
function arraySizes(functionNode: Parser.SyntaxNode): Map<string, number> {
  const sizes = new Map<string, number>();

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        // std::array<char, 2>  ->  namespace_identifier + template_type
        const m = typeNode.text.replace(/\s+/g, "").match(/^(std::)?array<.+,(\d+)>$/);
        if (m) {
          let cur: Parser.SyntaxNode | null = declNode;
          while (cur && cur.type !== "identifier") {
            cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
          }
          if (cur) sizes.set(cur.text, parseInt(m[2], 10));
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }

  walk(functionNode);
  return sizes;
}

/** Si `node` es `IDENT.data()` o `&IDENT`, devuelve IDENT; si no, null. */
function arrayIdentBehind(node: Parser.SyntaxNode): string | null {
  if (node.type === "pointer_expression") {
    const target = node.childForFieldName("argument");
    return target?.type === "identifier" ? target.text : null;
  }
  if (node.type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func?.type === "field_expression") {
      const obj = func.childForFieldName("argument");
      const field = func.childForFieldName("field");
      if (field?.text === "data" && obj?.type === "identifier") return obj.text;
    }
  }
  return null;
}

export function findMemcpyArrayOverflowIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(MEMCPY_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    const arg2 = match.captures.find((c) => c.name === "arg2")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !arg1 || !arg2 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    if (arg2.type !== "number_literal") continue;
    const n = parseInt(arg2.text, 10);
    if (Number.isNaN(n)) continue;

    const fn = enclosingFunction(callNode);
    if (!fn) continue;
    const sizes = arraySizes(fn);

    for (const [argNode, role] of [
      [arg0, "destino"],
      [arg1, "origen"],
    ] as const) {
      const ident = arrayIdentBehind(argNode);
      if (!ident) continue;
      const size = sizes.get(ident);
      if (size === undefined) continue;
      if (n > size) {
        findings.push({
          startIndex: argNode.startIndex,
          endIndex: argNode.endIndex,
          message:
            `${ident} es un std::array de ${size} elementos, pero este memcpy usa ${n} bytes como ` +
            `${role}. Desbordamiento del array.`,
        });
      }
    }
  }

  return findings;
}
