import Parser from "web-tree-sitter";

// Regla: memcpy/read/write/... sobre &variable, donde `variable` es un
// struct/class PLANO (definido en el fichero, sin campos std::string ni
// std::vector — esos ya están prohibidos del todo por
// struct-con-contenedor-direccion), SIN que exista en el fichero un
// static_assert(sizeof(TipoDelStruct) == N) que verifique su tamaño.
//
// Motivo: aunque el struct no tenga heap por dentro, el compilador puede
// insertar padding entre campos por alineación — sizeof(struct) puede no
// coincidir con la suma de sus campos, y ese padding es basura no
// inicializada que viajaría por la red. Un static_assert no arregla el
// problema solo, pero OBLIGA a que el estudiante se enfrente a él en
// tiempo de compilación (si hay padding inesperado, el assert falla) en
// vez de que se cuele en silencio. No hace falta que el checker sepa
// cuál es el tamaño "correcto" del protocolo — solo que exista la
// verificación.
//
// No exige que el static_assert aparezca ANTES de la llamada en el
// fichero — basta con que exista en algún punto, porque su efecto
// (fallar la compilación si el tamaño no cuadra) no depende del orden.

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

interface StructInfo {
  name: string;
  hasContainerField: boolean;
}

function structsInFile(root: Parser.SyntaxNode): StructInfo[] {
  const result: StructInfo[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "struct_specifier" || n.type === "class_specifier") {
      const name = n.childForFieldName("name")?.text;
      const body = n.childForFieldName("body");
      if (name && body) {
        let hasContainerField = false;
        for (const field of body.namedChildren) {
          if (field.type !== "field_declaration") continue;
          const typeText = field.childForFieldName("type")?.text.replace(/\s+/g, "") ?? "";
          if (
            typeText === "std::string" ||
            typeText === "string" ||
            /^(std::)?vector<.+>$/.test(typeText)
          ) {
            hasContainerField = true;
            break;
          }
        }
        result.push({ name, hasContainerField });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return result;
}

/** Nombres de struct/class con un static_assert(sizeof(Nombre) == N) en cualquier punto del fichero. */
function structsWithSizeAssert(root: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function sizeofTarget(node: Parser.SyntaxNode): string | null {
    if (node.type !== "sizeof_expression") return null;
    let value = node.childForFieldName("value");
    if (value?.type === "parenthesized_expression") value = value.namedChildren[0] ?? value;
    return value?.type === "identifier" ? value.text : null;
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "static_assert_declaration") {
      const expr = n.namedChildren[0];
      if (expr?.type === "binary_expression" && expr.childForFieldName("operator")?.text === "==") {
        const left = expr.childForFieldName("left");
        const right = expr.childForFieldName("right");
        const target = sizeofTarget(left!) ?? sizeofTarget(right!);
        if (target) names.add(target);
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
        if (cur?.text === name) {
          // Declaración combinada `struct T {...} var;`: el nodo `type` es
          // el struct_specifier ENTERO, cuyo .text sería toda la definición
          // (cuerpo incluido), no el nombre del tipo. El nombre está en su
          // hijo `name`. En la forma separada (`T var;`) el `type` ya es un
          // type_identifier y su .text es directamente el nombre.
          if (typeNode.type === "struct_specifier" || typeNode.type === "class_specifier") {
            result = typeNode.childForFieldName("name")?.text.replace(/\s+/g, "") ?? null;
          } else {
            result = typeNode.text.replace(/\s+/g, "");
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return result;
}

export function findStructSinStaticAssertIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  const structs = structsInFile(tree.rootNode);
  const plainStructNames = new Set(structs.filter((s) => !s.hasContainerField).map((s) => s.name));
  if (plainStructNames.size === 0) return findings;

  const verified = structsWithSizeAssert(tree.rootNode);

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
          if (type && plainStructNames.has(type) && !verified.has(type)) {
            findings.push({
              startIndex: arg.startIndex,
              endIndex: arg.endIndex,
              message:
                `&${target.text} es un ${type} y se envía/recibe entero con ${bare}(), pero no hay ` +
                `ningún static_assert(sizeof(${type}) == N) en el fichero. El compilador puede meter ` +
                `padding entre campos — sin el static_assert no hay garantía de que sizeof(${type}) sea ` +
                `el tamaño real del protocolo.`,
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
