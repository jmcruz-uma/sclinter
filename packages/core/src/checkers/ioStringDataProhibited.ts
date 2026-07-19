import Parser from "web-tree-sitter";

// Regla de NORMATIVA (no heurística), hermana de memcpy-string-data-prohibido
// pero para read/read_n/recv/recvfrom/write/write_n/send/sendto: el
// buffer (siempre segundo argumento) no puede ser std::string.data(),
// da igual que el string se haya redimensionado antes o no.
//
// Motivo del profesor: en el contexto de la asignatura es especialmente
// peligroso porque el alumnado no maneja bien resize() ni el problema
// del terminador de cadena — exactamente el mismo motivo que llevó a
// prohibirlo para memcpy.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const IO_FUNCS = ["read", "read_n", "recv", "recvfrom"];
// Solo se prohíbe donde el string es DESTINO (algo escribe dentro de su
// buffer). En write/write_n/send/sendto el string es ORIGEN: solo se lee
// para mandarlo, no requiere resize() previo ni arrastra el mismo riesgo
// — ahí SÍ está permitido .data(). (Corregido: la primera versión
// prohibía las ocho por igual, sin justificación técnica para las
// cuatro de escritura.)

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

function stringVarNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        const typeText = typeNode.text.replace(/\s+/g, "");
        if (typeText === "std::string" || typeText === "string") {
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

/** Ver comentario gemelo en memcpyStringDataProhibited.ts. */
function unwrapPointerArithmetic(node: Parser.SyntaxNode): Parser.SyntaxNode {
  if (node.type === "binary_expression") {
    const op = node.childForFieldName("operator")?.text;
    if (op === "+" || op === "-") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (left?.type === "call_expression" || left?.type === "binary_expression") {
        return unwrapPointerArithmetic(left);
      }
      if (right?.type === "call_expression" || right?.type === "binary_expression") {
        return unwrapPointerArithmetic(right);
      }
    }
  }
  return node;
}

/** Si `node` es IDENT.data() con IDENT en `strings`, devuelve IDENT. */
function stringDataCallTarget(node: Parser.SyntaxNode, strings: Set<string>): string | null {
  node = unwrapPointerArithmetic(node);
  if (node.type !== "call_expression") return null;
  const func = node.childForFieldName("function");
  if (func?.type !== "field_expression") return null;
  const obj = func.childForFieldName("argument");
  const field = func.childForFieldName("field");
  if (field?.text !== "data" || obj?.type !== "identifier") return null;
  return strings.has(obj.text) ? obj.text : null;
}

export function findIoStringDataProhibitedIssues(
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
        if (buf) {
          const fn = enclosingFunction(n);
          if (fn) {
            const strings = stringVarNames(fn);
            const name = stringDataCallTarget(buf, strings);
            if (name) {
              findings.push({
                startIndex: buf.startIndex,
                endIndex: buf.endIndex,
                message:
                  `${bare}(..., ${name}.data(), ...) está prohibido en esta asignatura, ` +
                  `independientemente de si el tamaño cuadra. Usa los métodos propios del contenedor ` +
                  `en vez de escribir/leer sobre su buffer a bajo nivel.`,
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
