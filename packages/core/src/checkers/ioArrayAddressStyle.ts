import Parser from "web-tree-sitter";

// Regla de ESTILO (no de bug), hermana de memcpy-array-direccion-estilo
// pero para read/read_n/recv/recvfrom/write/write_n/send/sendto: pasar
// &arr como buffer con un std::array es correcto (&arr == arr.data()),
// pero se marca igual por consistencia de hábito con std::string/vector.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const IO_FUNCS = ["read", "read_n", "recv", "recvfrom", "write", "write_n", "send", "sendto"];

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

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

export function findIoArrayAddressStyleIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (func && bare && IO_FUNCS.includes(bare)) {
        const args = n.childForFieldName("arguments");
        const buf = args?.namedChildren[1];
        if (buf?.type === "pointer_expression") {
          const target = buf.childForFieldName("argument");
          if (target?.type === "identifier") {
            const fn = enclosingFunction(n);
            if (fn && arrayVarNames(fn).has(target.text)) {
              findings.push({
                startIndex: buf.startIndex,
                endIndex: buf.endIndex,
                message:
                  `[estilo, no error] &${target.text} funciona correctamente aquí — para std::array, ` +
                  `&variable y variable.data() son la misma dirección. Aun así, en esta asignatura se usa ` +
                  `siempre ${target.text}.data(), por consistencia con std::string y std::vector.`,
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
