import Parser from "web-tree-sitter";

// Regla: write/write_n/send/sendto usa array.size() como tamaño a
// enviar, pero en la misma función existe una variable de offset
// asociada a ESE array (usada como array.data()+X, &array[X], o en una
// asignación array[X]=...) cuyo total es NO CONSTANTE — es decir, al
// menos uno de sus incrementos depende de algo que solo se sabe en
// tiempo de ejecución (strlen, .size() de otra variable, una variable
// cualquiera), no de literales ni sizeof(...) (que en C++ siempre es
// constante en tiempo de compilación, a diferencia de C con VLAs).
//
// Diseño deliberadamente estrecho (decisión consensuada con el
// profesor): SOLO avisa cuando el offset es demostrablemente no
// constante. Si todos los incrementos son literales/sizeof(...), el
// offset final podría coincidir a propósito con el tamaño declarado del
// array (protocolo de tamaño fijo) — ahí NO se avisa, porque no hay
// contradicción real, solo la ausencia de uso del offset, que por sí
// sola no es prueba de nada.
//
// Solo cubre std::array (no std::vector) y las funciones de ENVÍO
// (write/write_n/send/sendto) — el patrón real del catálogo es sobre
// arrays de tamaño genérico (2048) parcialmente rellenados antes de
// enviar, no sobre recepción.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SEND_FUNCS = ["write", "write_n", "send", "sendto"];

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Nombres declarados como std::array<T,N> dentro de la función. */
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

/** Para cada array, el nombre de la variable de offset usada para escribir en él (si la hay). */
function offsetVarPerArray(functionNode: Parser.SyntaxNode, arrays: Set<string>): Map<string, string> {
  const result = new Map<string, string>();

  function considerSubscript(sub: Parser.SyntaxNode) {
    const arrName = sub.childForFieldName("argument")?.text;
    const idxList = sub.namedChildren.find((c) => c.type === "subscript_argument_list");
    const idx = idxList?.namedChildren[0];
    if (arrName && arrays.has(arrName) && idx?.type === "identifier") {
      result.set(arrName, idx.text);
    }
  }

  function walk(n: Parser.SyntaxNode) {
    // array.data() + X
    if (n.type === "binary_expression" && n.childForFieldName("operator")?.text === "+") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "call_expression") {
        const func = left.childForFieldName("function");
        if (func?.type === "field_expression") {
          const obj = func.childForFieldName("argument");
          const field = func.childForFieldName("field");
          if (field?.text === "data" && obj?.type === "identifier" && arrays.has(obj.text) && right?.type === "identifier") {
            result.set(obj.text, right.text);
          }
        }
      }
    }
    // &array[X]
    if (n.type === "pointer_expression") {
      const target = n.childForFieldName("argument");
      if (target?.type === "subscript_expression") considerSubscript(target);
    }
    // array[X] = ...
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      if (left?.type === "subscript_expression") considerSubscript(left);
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return result;
}

/** ¿Tiene `name` al menos un incremento (+=) NO constante en la función? */
function hasNonConstantIncrement(functionNode: Parser.SyntaxNode, name: string): boolean {
  let found = false;
  function isConstant(expr: Parser.SyntaxNode | null): boolean {
    if (!expr) return true;
    if (expr.type === "number_literal") return true;
    if (expr.type === "sizeof_expression") return true; // sizeof es constante en C++, siempre
    return false;
  }
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "assignment_expression") {
      const op = n.childForFieldName("operator")?.text;
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (op === "+=" && left?.type === "identifier" && left.text === name && !isConstant(right ?? null)) {
        found = true;
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return found;
}

export function findSizeEnVezDeOffsetIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const arrays = arrayVarNames(fn);
      if (arrays.size > 0) {
        const offsets = offsetVarPerArray(fn, arrays);

        function walk(n: Parser.SyntaxNode) {
          if (n.type === "call_expression") {
            const func = n.childForFieldName("function");
            const bare = func?.text.replace(/^.*::/, "");
            if (func && bare && SEND_FUNCS.includes(bare)) {
              const args = n.childForFieldName("arguments");
              const sizeArg = args?.namedChildren[2];
              // ¿es ARRAY.size()?
              if (sizeArg?.type === "call_expression") {
                const sizeFunc = sizeArg.childForFieldName("function");
                if (sizeFunc?.type === "field_expression") {
                  const obj = sizeFunc.childForFieldName("argument");
                  const field = sizeFunc.childForFieldName("field");
                  if (field?.text === "size" && obj?.type === "identifier" && arrays.has(obj.text)) {
                    const offsetName = offsets.get(obj.text);
                    if (offsetName && hasNonConstantIncrement(fn, offsetName)) {
                      findings.push({
                        startIndex: sizeArg.startIndex,
                        endIndex: sizeArg.endIndex,
                        message:
                          `${obj.text}.size() envía el array completo, pero ${offsetName} se usó para ` +
                          `escribir dentro de ${obj.text} con al menos un incremento que no es constante ` +
                          `— probablemente querías enviar solo ${offsetName} bytes, no ${obj.text}.size().`,
                      });
                    }
                  }
                }
              }
            }
          }
          for (const child of n.namedChildren) walk(child);
        }
        walk(fn);
      }
    }
    for (const child of fn.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
