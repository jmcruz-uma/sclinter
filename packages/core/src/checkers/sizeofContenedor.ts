import Parser from "web-tree-sitter";

// Regla: sizeof(variable) donde `variable` es std::string, std::vector o
// std::string_view da el tamaño del OBJETO (punteros/tamaño/capacidad
// internos, típicamente 16-32 bytes), no el número de bytes de su
// contenido. Se necesita variable.size() para eso. Único caso donde
// sizeof() SÍ da el contenido real es std::array (tamaño fijo conocido
// en compilación) — por eso ese tipo se excluye aquí a propósito, mismo
// criterio que en memcpy-array-direccion-estilo.

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

/** Tipo declarado de `name` dentro de la función (texto normalizado), o null. */
function declaredTypeOf(functionNode: Parser.SyntaxNode, name: string): string | null {
  let result: string | null = null;
  function walk(n: Parser.SyntaxNode) {
    if (result) return;
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        let cur: Parser.SyntaxNode | null = declNode;
        while (cur && cur.type !== "identifier") {
          cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
        }
        if (cur?.text === name) result = typeNode.text.replace(/\s+/g, "");
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return result;
}

function isHeapBackedContainerType(typeText: string): boolean {
  return (
    typeText === "std::string" ||
    typeText === "string" ||
    typeText === "std::string_view" ||
    typeText === "string_view" ||
    /^(std::)?vector<.+>$/.test(typeText)
  );
}

export function findSizeofContenedorIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "sizeof_expression") {
      let value = n.childForFieldName("value");
      if (value?.type === "parenthesized_expression") value = value.namedChildren[0] ?? value;
      if (value?.type === "identifier") {
        const fn = enclosingFunction(n);
        const type = fn ? declaredTypeOf(fn, value.text) : null;
        if (type && isHeapBackedContainerType(type)) {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              `sizeof(${value.text}) da el tamaño del objeto ${type} (su representación interna, no su ` +
              `contenido). Usa ${value.text}.size() para el número de elementos/bytes de contenido.`,
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
