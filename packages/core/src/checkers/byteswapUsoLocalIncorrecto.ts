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

type Byteorder = "host" | "network" | "unknown";
type Orden = { order: Byteorder; swaps: number };
const HOST0: Orden = { order: "host", swaps: 0 };
const UNKNOWN0: Orden = { order: "unknown", swaps: 0 };
function toggle(o: Byteorder): Byteorder {
  if (o === "host") return "network";
  if (o === "network") return "host";
  return "unknown"; // desconocido tras cualquier conversión sigue desconocido
}

// Contexto de análisis por función: buffers leídos de red (para el rastreo
// de origen) y, a nivel de fichero, qué posiciones de parámetro de cada
// función DEFINIDA por el estudiante son referencias NO-const (posibles
// parámetros de salida que pueden rellenar la variable, p.ej. desde la red).
interface Ctx {
  readBufs: Set<string>;
  refParams: Map<string, Set<number>>;
}

/** ¿Es este parámetro una referencia NO-const (`T&` sin `const`)? Una
 * referencia const (`const T&`) es solo lectura y NO cuenta. */
function isNonConstRefParam(paramDecl: Parser.SyntaxNode): boolean {
  const decl = paramDecl.childForFieldName("declarator");
  if (decl?.type !== "reference_declarator") return false;
  return !/\bconst\b/.test(paramDecl.text);
}

/** Nombre de función (identificador) de un function_declarator. */
function functionDeclName(declarator: Parser.SyntaxNode | null): string | null {
  let cur: Parser.SyntaxNode | null = declarator;
  while (cur && cur.type !== "identifier") {
    cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
  }
  return cur?.type === "identifier" ? cur.text : null;
}

/** Para cada función DEFINIDA en el fichero, el conjunto de posiciones de
 * parámetro que son referencias no-const. Se usa para saber si una
 * variable pudo ser rellenada (p.ej. de la red) al pasarla a esa función. */
function nonConstRefParamsByFunction(root: Parser.SyntaxNode): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const declarator = n.childForFieldName("declarator");
      const name = functionDeclName(declarator);
      const paramList =
        declarator?.childForFieldName("parameters") ??
        declarator?.namedChildren.find((c) => c.type === "parameter_list");
      if (name && paramList) {
        const positions = new Set<number>();
        paramList.namedChildren
          .filter((c) => c.type === "parameter_declaration")
          .forEach((pd, i) => {
            if (isNonConstRefParam(pd)) positions.add(i);
          });
        if (positions.size > 0) map.set(name, positions);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return map;
}

/** ¿Se pasó `name` como argumento en una posición de referencia no-const de
 * una función propia, en una posición ANTERIOR a beforeIndex? Si es así, esa
 * función pudo rellenarlo (p.ej. de la red) y su orden es desconocido. */
function wasRefPassedBefore(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number,
  refParams: Map<string, Set<number>>
): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "call_expression" && n.startIndex < beforeIndex) {
      const fname = bare(n.childForFieldName("function"));
      const positions = fname ? refParams.get(fname) : undefined;
      if (positions) {
        const args = n.childForFieldName("arguments")?.namedChildren ?? [];
        for (let i = 0; i < args.length; i++) {
          if (positions.has(i) && args[i].type === "identifier" && args[i].text === name) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return found;
}

type Mutacion = { kind: "read" | "memcpy" | "assign" | "refpass"; node: Parser.SyntaxNode; pos: number };

/** Mutación más reciente de `name` con posición < beforeIndex:
 *  - 'read'    : name fue destino de una lectura de red → empieza en orden de red.
 *  - 'memcpy'  : name se extrajo con memcpy(&name, ...) de un buffer leído de red.
 *  - 'assign'  : name = RHS (o declaración con inicializador) → hereda de RHS.
 *  - 'refpass' : name se pasó por referencia no-const a una función propia → orden desconocido.
 * Devuelve el nodo relevante (RHS para 'assign', la llamada para los demás). */
function mostRecentMutation(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number,
  refParams: Map<string, Set<number>>
): Mutacion | null {
  let best: Mutacion | null = null;
  function consider(cand: Mutacion) {
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
      // Paso por referencia no-const a una función propia: pudo rellenar
      // `name` (p.ej. de la red) → su orden pasa a ser desconocido.
      const positions = b ? refParams.get(b) : undefined;
      if (positions) {
        const as = args?.namedChildren ?? [];
        for (let i = 0; i < as.length; i++) {
          if (positions.has(i) && as[i].type === "identifier" && as[i].text === name) {
            consider({ kind: "refpass", node: n, pos: n.startIndex });
          }
        }
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
  ctx: Ctx,
  depth: number
): Orden {
  if (depth > 40) return HOST0;
  const m = mostRecentMutation(fn, name, index, ctx.refParams);
  if (!m) return HOST0; // parámetro / declaración con origen local / sin rastro → orden de host
  if (m.kind === "read") return { order: "network", swaps: 0 };
  if (m.kind === "refpass") return UNKNOWN0; // pudo rellenarlo una función propia → desconocido
  if (m.kind === "memcpy") {
    const src = m.node.childForFieldName("arguments")?.namedChildren[1];
    if (src && anyIdentifierIn(src, ctx.readBufs)) return { order: "network", swaps: 0 };
    return HOST0;
  }
  return analyzeExpr(fn, m.node, m.pos, ctx, depth + 1);
}

function analyzeExpr(
  fn: Parser.SyntaxNode,
  expr: Parser.SyntaxNode,
  index: number,
  ctx: Ctx,
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
    const r = analyzeExpr(fn, swapArg, index, ctx, depth + 1);
    return { order: toggle(r.order), swaps: r.swaps + 1 };
  }
  if (e.type === "identifier") return analyze(fn, e.text, index, ctx, depth + 1);
  // Acceso a un campo/elemento (`mensaje.num`, `mensaje.textos[i].lon`).
  if (e.type === "field_expression" || e.type === "subscript_expression") {
    const base = bufferBaseName(e);
    // Si el objeto se leyó de la red aquí → orden de red, 0 conversiones.
    if (base && ctx.readBufs.has(base)) return { order: "network", swaps: 0 };
    // Si el objeto se pasó por referencia no-const a una función propia (que
    // pudo rellenarlo, p.ej. de la red en un helper) → orden desconocido.
    if (base && wasRefPassedBefore(fn, base, index, ctx.refParams)) return UNKNOWN0;
  }
  // strlen(...), .size(), literales, argc, aritmética local... → orden de host, 0 conversiones.
  return HOST0;
}

function flagIfNetwork(
  fn: Parser.SyntaxNode,
  ctx: Ctx,
  target: Parser.SyntaxNode,
  findings: Finding[],
  contexto: string
) {
  if (target.type !== "identifier") return;
  const { order, swaps } = analyze(fn, target.text, target.startIndex, ctx, 0);
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

  // Posiciones de parámetro por referencia no-const de cada función propia
  // del fichero — se calcula una vez y es común a todas las funciones.
  const refParams = nonConstRefParamsByFunction(tree.rootNode);

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const ctx: Ctx = { readBufs: readBufferNames(fn), refParams };

      function walk(n: Parser.SyntaxNode) {
        // 1) tercer argumento de memcpy/read_n/write_n
        if (n.type === "call_expression") {
          const func = n.childForFieldName("function");
          const b = bare(func);
          if (func && b && SIZE_FUNCS.includes(b)) {
            const args = n.childForFieldName("arguments");
            const sizeArg = args?.namedChildren[2];
            if (sizeArg) flagIfNetwork(fn, ctx, sizeArg, findings, `como tamaño de ${b}()`);
          }
        }
        // 2) cualquier comparación — cubre for/while/do-while/if y comparaciones sueltas
        if (n.type === "binary_expression") {
          const op = n.childForFieldName("operator")?.text;
          if (op && COMPARISON_OPS.includes(op)) {
            const left = n.childForFieldName("left");
            const right = n.childForFieldName("right");
            if (left) flagIfNetwork(fn, ctx, left, findings, "en una comparación");
            if (right) flagIfNetwork(fn, ctx, right, findings, "en una comparación");
          }
        }
        // 3) offset += X
        if (n.type === "assignment_expression") {
          const op = n.childForFieldName("operator")?.text;
          const right = n.childForFieldName("right");
          if (op === "+=" && right) {
            flagIfNetwork(fn, ctx, right, findings, "para avanzar un offset (+=)");
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
            flagIfNetwork(fn, ctx, right, findings, "como desplazamiento dentro de un buffer (+)");
          }
        }
        // 5) índice de un array: array[X]
        if (n.type === "subscript_expression") {
          const idxList = n.namedChildren.find((c) => c.type === "subscript_argument_list");
          const idx = idxList?.namedChildren[0];
          if (idx) flagIfNetwork(fn, ctx, idx, findings, "como índice de un array ([X])");
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
