import Parser from "web-tree-sitter";

// Regla: memcpy/write_n/read_n/send/sendto/recv/recvfrom/read/write sobre
// &variable, donde `variable` es de un tipo struct/class DEFINIDO EN EL
// FICHERO que tiene algún campo std::string o std::vector. Volcar los
// bytes crudos del struct completo serializa punteros internos al heap,
// no el contenido — mismo problema de fondo que memcpy-direccion-contenedor
// e io-container-direccion, pero ahí solo se detectaba la variable
// std::string/std::vector directa, no un struct propio que la contiene.
//
// Requiere que el struct esté definido en el propio fichero (no puede
// mirar dentro de una struct declarada en una cabecera que no ve).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const FUNCS = ["memcpy", "read", "read_n", "recv", "recvfrom", "write", "write_n", "send", "sendto"];

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Nombres de struct/class definidos en el fichero que tienen algún campo std::string/std::vector. */
function riskyStructNames(root: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "struct_specifier" || n.type === "class_specifier") {
      const name = n.childForFieldName("name")?.text;
      const body = n.childForFieldName("body");
      if (name && body) {
        let risky = false;
        for (const field of body.namedChildren) {
          if (field.type !== "field_declaration") continue;
          const typeText = field.childForFieldName("type")?.text.replace(/\s+/g, "") ?? "";
          if (
            typeText === "std::string" ||
            typeText === "string" ||
            /^(std::)?vector<.+>$/.test(typeText)
          ) {
            risky = true;
            break;
          }
        }
        if (risky) names.add(name);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return names;
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

export function findStructConContenedorDireccionIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const riskyStructs = riskyStructNames(tree.rootNode);
  if (riskyStructs.size === 0) return findings;

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (func && bare && FUNCS.includes(bare)) {
        const args = n.childForFieldName("arguments");
        for (const arg of args?.namedChildren ?? []) {
          if (arg.type !== "pointer_expression") continue;
          const target = arg.childForFieldName("argument");
          if (target?.type !== "identifier") continue;
          const fn = enclosingFunction(n);
          if (!fn) continue;
          const type = declaredTypeOf(fn, target.text);
          if (type && riskyStructs.has(type)) {
            findings.push({
              startIndex: arg.startIndex,
              endIndex: arg.endIndex,
              message:
                `&${target.text} es un ${type}, que tiene algún campo std::string/std::vector — ` +
                `${bare}() volcará los punteros internos de ese campo, no su contenido de texto. ` +
                `Hay que serializar/deserializar campo a campo, no el struct entero de una vez.`,
            });
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
