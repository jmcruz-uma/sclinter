import Parser from "web-tree-sitter";

// Regla de NORMATIVA de la asignatura, no de detección de bug: escribir
// con memcpy en std::string.data() está prohibido siempre, exista o no
// riesgo real de desbordamiento. Motivo (criterio del profesor, no una
// limitación técnica): std::string está pensado para gestionar su
// terminador y su tamaño internamente; escribir en su buffer por detrás
// con memcpy es un fallo de concepto sobre para qué existe el contenedor,
// independientemente de si en este caso concreto "funcionaría".
//
// A diferencia de otras reglas del catálogo, esta no intenta estimar si
// hay peligro real (no mira si hubo resize() antes) — dispara siempre
// que ve el patrón, porque la política es "no se hace, punto".
//
// Solo se comprueba el DESTINO (arg0), no el origen. Corregido: la
// primera versión también prohibía usar .data() como ORIGEN de memcpy
// (leer de un string ya poblado para copiarlo a otro sitio), pero eso
// no tiene el mismo riesgo — no requiere resize() previo, solo se lee
// contenido que ya existe. Prohibirlo ahí no tenía base técnica, era
// aplicar la norma "por igual" sin pensar en qué rol jugaba el string.

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

/** Nombres declarados como std::string dentro de la función. */
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

/** Si `node` es (una cadena de) aritmética de punteros +/- alrededor de una
 * llamada, devuelve esa llamada interior; si no hay aritmética, devuelve
 * `node` tal cual. Cubre almacen.data()+1, almacen.data()-1, etc. — el
 * patrón IDENT.data() no cambia de "peligro" solo porque se le sume un
 * desplazamiento; de hecho normalmente lo empeora. */
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

/** Si `node` es el resultado de IDENT.data() con IDENT en `strings`, devuelve IDENT. */
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

export function findMemcpyStringDataProhibitedIssues(
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
    const strings = stringVarNames(fn);

    // Solo se comprueba el destino — ver comentario de cabecera.
    const name = stringDataCallTarget(arg0, strings);
    if (name) {
      findings.push({
        startIndex: arg0.startIndex,
        endIndex: arg0.endIndex,
        message:
          `memcpy con ${name}.data() como destino está prohibido en esta asignatura, ` +
          `independientemente de si el tamaño cuadra. std::string gestiona su terminador y su ` +
          `tamaño internamente — usa los métodos propios del contenedor (resize, assign, append, ` +
          `operator+=) en vez de escribir sobre su buffer a bajo nivel.`,
      });
    }
  }

  return findings;
}
