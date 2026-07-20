import Parser from "web-tree-sitter";

// Regla: una variable que NUNCA fue destino de read/read_n/recv/recvfrom
// (es decir, nació en orden de host, no llegó de la red) se usa como
// tamaño de memcpy/read_n/write_n, en un incremento de offset (+=), como
// desplazamiento dentro de un buffer (.data() + X o array[X]), o en
// CUALQUIER comparación (==, !=, <, <=, >, >=) — lo que cubre de una
// sola pasada los límites de for/while/do-while, las condiciones de if,
// y comparaciones sueltas — después de un número IMPAR de conversiones
// con htons/ntohs/htonl/ntohl/std::byteswap.
//
// El razonamiento (validado con el profesor): estas conversiones son
// involuciones — aplicarlas dos veces devuelve el valor original. Por
// eso lo que importa no es qué función se llamó (htons/ntohs son
// funcionalmente idénticas en esta arquitectura, el nombre no es una
// señal fiable) sino CUÁNTAS veces se aplicó una de ellas antes del
// uso: impar = todavía en orden de red, par (incluido cero) = ya está
// en orden de host, listo para uso local.
//
// Las variables que SÍ fueron destino de read/recv se excluyen del todo
// — para ellas, un número impar de conversiones antes de usarlas
// localmente es exactamente lo correcto, no un error.
//
// NOTA DE DISEÑO: la comprobación de comparación general SUSTITUYE a una
// versión anterior que solo miraba explícitamente el límite de un `for`.
// Se comprobó (antes de escribir esta versión) que `for`, `while` e `if`
// envuelven su condición en un nodo `condition_clause`, pero `do-while`
// la envuelve en un `parenthesized_expression` distinto — por eso, en
// vez de tres comprobaciones específicas por tipo de bucle, se busca
// directamente cualquier `binary_expression` de comparación en toda la
// función, que ya cubre los cuatro casos (y las comparaciones sueltas)
// sin tener que conocer el nodo contenedor.
//
// Es un conteo de sentencias de asignación en orden textual, no un
// análisis de flujo de control real (no modela bucles ni ramas) —
// mismo nivel de rigor que zombies-sin-reap/hijo-sin-terminar.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SWAP_FUNCS = ["htons", "ntohs", "htonl", "ntohl", "byteswap"];
const SIZE_FUNCS = ["memcpy", "read_n", "write_n"];
const READ_FUNCS = ["read", "read_n", "readn", "recv", "recvfrom"];
const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="];

function bare(func: Parser.SyntaxNode | null | undefined): string | null {
  if (!func) return null;
  return func.text.replace(/\s+/g, "").replace(/^.*::/, "");
}

function isSwapCall(n: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null {
  if (!n || n.type !== "call_expression") return null;
  const b = bare(n.childForFieldName("function"));
  if (b && SWAP_FUNCS.includes(b)) {
    return n.childForFieldName("arguments")?.namedChildren[0] ?? null;
  }
  return null;
}

/** Identificador destino de una expresión de buffer: `x`, `&x`, `x.data()`. */
function identOf(node: Parser.SyntaxNode): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "pointer_expression") {
    const t = node.childForFieldName("argument");
    return t?.type === "identifier" ? t.text : null;
  }
  if (node.type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func?.type === "field_expression") {
      const obj = func.childForFieldName("argument");
      if (func.childForFieldName("field")?.text === "data" && obj?.type === "identifier") return obj.text;
    }
  }
  return null;
}

/** Identificador raíz de una expresión de buffer, atravesando `&`, `.f`,
 * `[i]` y `.data()`: `&mensaje.num` → "mensaje", `almacen.data()+k` no (eso
 * es una suma), pero `almacen.data()` → "almacen", `&x` → "x". Sirve para
 * saber a qué objeto pertenece un dato leído de la red, incluso cuando se
 * lee directamente sobre un campo de una struct. */
function bufferBaseName(node: Parser.SyntaxNode): string | null {
  switch (node.type) {
    case "identifier":
      return node.text;
    case "pointer_expression":
    case "field_expression":
    case "subscript_expression": {
      const arg = node.childForFieldName("argument");
      return arg ? bufferBaseName(arg) : null;
    }
    case "call_expression": {
      const func = node.childForFieldName("function");
      if (func?.type === "field_expression" && func.childForFieldName("field")?.text === "data") {
        const obj = func.childForFieldName("argument");
        return obj ? bufferBaseName(obj) : null;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Nombres de contenedores/variables que en algún punto son destino
 * (2º argumento) de una lectura de red. Semilla del "origen de red":
 * cubre lectura directa (`&x`), buffer de contenedor (`buf.data()`) y
 * lectura sobre un campo de struct (`&mensaje.num` → "mensaje"). Incluye
 * el helper `readn` además de read/read_n/recv/recvfrom, porque el
 * objetivo es rastrear el origen del dato, no penalizar el nombre. */
function readBufferNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const b = bare(n.childForFieldName("function"));
      if (b && READ_FUNCS.includes(b)) {
        const buf = n.childForFieldName("arguments")?.namedChildren[1];
        const name = buf ? bufferBaseName(buf) : null;
        if (name) names.add(name);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return names;
}

function anyIdentifierIn(node: Parser.SyntaxNode, names: Set<string>): boolean {
  if (node.type === "identifier" && names.has(node.text)) return true;
  for (const c of node.namedChildren) if (anyIdentifierIn(c, names)) return true;
  return false;
}

type Orden = { order: "host" | "network"; swaps: number };
const HOST0: Orden = { order: "host", swaps: 0 };
function toggle(o: "host" | "network"): "host" | "network" {
  return o === "host" ? "network" : "host";
}

/** Mutación más reciente de `name` con posición < beforeIndex:
 *  - 'read'   : name fue destino de una lectura de red → empieza en orden de red.
 *  - 'memcpy' : name se extrajo con memcpy(&name, ...) de un buffer leído de red.
 *  - 'assign' : name = RHS (o declaración con inicializador) → hereda de RHS.
 * Devuelve el nodo relevante (RHS para 'assign', la llamada para 'memcpy'). */
function mostRecentMutation(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number
): { kind: "read" | "memcpy" | "assign"; node: Parser.SyntaxNode; pos: number } | null {
  let best: { kind: "read" | "memcpy" | "assign"; node: Parser.SyntaxNode; pos: number } | null = null;
  function consider(cand: { kind: "read" | "memcpy" | "assign"; node: Parser.SyntaxNode; pos: number }) {
    if (cand.pos < beforeIndex && (!best || cand.pos > best.pos)) best = cand;
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const b = bare(n.childForFieldName("function"));
      const args = n.childForFieldName("arguments");
      if (b && READ_FUNCS.includes(b)) {
        const buf = args?.namedChildren[1];
        if (buf && identOf(buf) === name) consider({ kind: "read", node: n, pos: n.startIndex });
      }
      if (b === "memcpy") {
        const dst = args?.namedChildren[0];
        if (dst && identOf(dst) === name) consider({ kind: "memcpy", node: n, pos: n.startIndex });
      }
    }
    if (n.type === "init_declarator") {
      const decl = n.childForFieldName("declarator");
      const value = n.childForFieldName("value");
      if (decl?.type === "identifier" && decl.text === name && value) {
        consider({ kind: "assign", node: value, pos: n.startIndex });
      }
    }
    if (n.type === "assignment_expression" && n.childForFieldName("operator")?.text === "=") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "identifier" && left.text === name && right) {
        consider({ kind: "assign", node: right, pos: n.startIndex });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return best;
}

/** Orden de bytes (host/network) y nº de conversiones del valor de `name`
 * en `index`, siguiendo hacia atrás su cadena de asignaciones. */
function analyze(
  fn: Parser.SyntaxNode,
  name: string,
  index: number,
  readBufs: Set<string>,
  depth: number
): Orden {
  if (depth > 40) return HOST0;
  const m = mostRecentMutation(fn, name, index);
  if (!m) return HOST0; // parámetro / declaración con origen local / sin rastro → orden de host
  if (m.kind === "read") return { order: "network", swaps: 0 };
  if (m.kind === "memcpy") {
    const src = m.node.childForFieldName("arguments")?.namedChildren[1];
    if (src && anyIdentifierIn(src, readBufs)) return { order: "network", swaps: 0 };
    return HOST0;
  }
  return analyzeExpr(fn, m.node, m.pos, readBufs, depth + 1);
}

function analyzeExpr(
  fn: Parser.SyntaxNode,
  expr: Parser.SyntaxNode,
  index: number,
  readBufs: Set<string>,
  depth: number
): Orden {
  if (depth > 40) return HOST0;
  let e = expr;
  while (e.type === "parenthesized_expression" || e.type === "cast_expression") {
    e = e.childForFieldName("value") ?? e.namedChildren[e.namedChildren.length - 1] ?? e;
    if (!e) return HOST0;
  }
  const swapArg = isSwapCall(e);
  if (swapArg) {
    const r = analyzeExpr(fn, swapArg, index, readBufs, depth + 1);
    return { order: toggle(r.order), swaps: r.swaps + 1 };
  }
  if (e.type === "identifier") return analyze(fn, e.text, index, readBufs, depth + 1);
  // Acceso a un campo/elemento cuyo objeto se leyó de la red
  // (`mensaje.num`, `mensaje.textos[i].lon` con `mensaje` leído): el dato
  // viene de la red, en orden de red y sin conversiones todavía.
  if (e.type === "field_expression" || e.type === "subscript_expression") {
    const base = bufferBaseName(e);
    if (base && readBufs.has(base)) return { order: "network", swaps: 0 };
  }
  // strlen(...), .size(), literales, argc, aritmética local... → orden de host, 0 conversiones.
  return HOST0;
}

function flagIfNetwork(
  fn: Parser.SyntaxNode,
  readBufs: Set<string>,
  target: Parser.SyntaxNode,
  findings: Finding[],
  contexto: string
) {
  if (target.type !== "identifier") return;
  const { order, swaps } = analyze(fn, target.text, target.startIndex, readBufs, 0);
  // Solo se avisa si en el punto de uso el valor está en orden de RED y
  // llegó ahí por al menos una conversión de orden de bytes. Un valor de
  // red usado SIN convertir (swaps === 0), como un campo de 1 byte, no es
  // asunto de esta regla y no se marca.
  if (order === "network" && swaps >= 1) {
    findings.push({
      startIndex: target.startIndex,
      endIndex: target.endIndex,
      message:
        `${target.text} se usa aquí ${contexto}, pero en este punto está en orden de red ` +
        `(big-endian), no en orden de host: revisa las conversiones de orden de bytes ` +
        `(htons/ntohs/htonl/ntohl/std::byteswap) aplicadas antes de usarlo localmente.`,
    });
  }
}

export function findByteswapUsoLocalIncorrectoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const readBufs = readBufferNames(fn);

      function walk(n: Parser.SyntaxNode) {
        // 1) tercer argumento de memcpy/read_n/write_n
        if (n.type === "call_expression") {
          const func = n.childForFieldName("function");
          const b = bare(func);
          if (func && b && SIZE_FUNCS.includes(b)) {
            const args = n.childForFieldName("arguments");
            const sizeArg = args?.namedChildren[2];
            if (sizeArg) flagIfNetwork(fn, readBufs, sizeArg, findings, `como tamaño de ${b}()`);
          }
        }
        // 2) cualquier comparación — cubre for/while/do-while/if y comparaciones sueltas
        if (n.type === "binary_expression") {
          const op = n.childForFieldName("operator")?.text;
          if (op && COMPARISON_OPS.includes(op)) {
            const left = n.childForFieldName("left");
            const right = n.childForFieldName("right");
            if (left) flagIfNetwork(fn, readBufs, left, findings, "en una comparación");
            if (right) flagIfNetwork(fn, readBufs, right, findings, "en una comparación");
          }
        }
        // 3) offset += X
        if (n.type === "assignment_expression") {
          const op = n.childForFieldName("operator")?.text;
          const right = n.childForFieldName("right");
          if (op === "+=" && right) {
            flagIfNetwork(fn, readBufs, right, findings, "para avanzar un offset (+=)");
          }
        }
        // 4) desplazamiento dentro de un buffer: array.data() + X, o buffer + X
        // (puntero plano), pero solo cuando la suma se pasa directamente como
        // argumento de una llamada (memcpy/read/write...) — así se evita
        // confundirlo con aritmética normal no relacionada con buffers.
        if (
          n.type === "binary_expression" &&
          n.childForFieldName("operator")?.text === "+" &&
          n.parent?.type === "argument_list"
        ) {
          const left = n.childForFieldName("left");
          const right = n.childForFieldName("right");
          const isDataCall = (node: Parser.SyntaxNode | null) => {
            if (node?.type !== "call_expression") return false;
            const f = node.childForFieldName("function");
            return f?.type === "field_expression" && f.childForFieldName("field")?.text === "data";
          };
          if ((isDataCall(left ?? null) || left?.type === "identifier") && right) {
            flagIfNetwork(fn, readBufs, right, findings, "como desplazamiento dentro de un buffer (+)");
          }
        }
        // 5) índice de un array: array[X]
        if (n.type === "subscript_expression") {
          const idxList = n.namedChildren.find((c) => c.type === "subscript_argument_list");
          const idx = idxList?.namedChildren[0];
          if (idx) flagIfNetwork(fn, readBufs, idx, findings, "como índice de un array ([X])");
        }
        for (const child of n.namedChildren) walk(child);
      }
      walk(fn);
    }
    for (const child of fn.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
