import Parser from "web-tree-sitter";

// Regla: en read/read_n/recv/recvfrom/write/write_n/send/sendto, el
// buffer de datos es SIEMPRE el segundo argumento (posición 1), aunque
// el número total de argumentos varíe según la función. Pasar &variable
// de un std::string o std::vector ahí sobreescribe la representación
// interna del objeto, no su contenido — mismo problema que ya cubre
// memcpy-direccion-contenedor, aplicado ahora a estas ocho funciones.
//
// read_n/write_n son funciones propias del curso (envuelven read/write
// para garantizar N bytes exactos) — no se detectan "gratis" por llamar
// internamente a read/write: hay que reconocerlas explícitamente aquí,
// porque el checker solo mira el código del estudiante, no sigue la
// implementación de las funciones que llama.
//
// std::array queda fuera de esta regla a propósito (mismo motivo que en
// memcpy-direccion-contenedor: &arr == arr.data(), no es un bug) — ver
// ioArrayAddressStyle.ts para la versión de estilo.

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

/** Nombres declarados como std::string o std::vector<T> dentro de la función, con su tipo. */
function heapBackedVarNames(functionNode: Parser.SyntaxNode): Map<string, string> {
  const names = new Map<string, string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        const typeText = typeNode.text.replace(/\s+/g, "");
        const isString = typeText === "std::string" || typeText === "string";
        const isVector = /^(std::)?vector<.+>$/.test(typeText);
        if (isString || isVector) {
          let cur: Parser.SyntaxNode | null = declNode;
          while (cur && cur.type !== "identifier") {
            cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
          }
          if (cur) names.set(cur.text, isString ? "std::string" : "std::vector");
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return names;
}

export function findIoContainerAddressIssues(
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
            if (fn) {
              const vars = heapBackedVarNames(fn);
              const type = vars.get(target.text);
              if (type) {
                const consejo =
                  type === "std::vector"
                    ? `Usa ${target.text}.data() sobre contenido ya reservado (tras resize()).`
                    : `En esta asignatura, además, usar memcpy o E/S directa sobre .data() de un std::string ` +
                      `también está restringido — usa los métodos propios del contenedor.`;
                findings.push({
                  startIndex: buf.startIndex,
                  endIndex: buf.endIndex,
                  message:
                    `${bare}(..., &${target.text}, ...) sobreescribe/lee la representación interna del ` +
                    `${type}, no su contenido — su contenido vive en otra dirección. ${consejo}`,
                });
              }
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
