import Parser from "web-tree-sitter";

// Regla: si dentro de la misma función hay dos (o más) llamadas a memcpy
// que escriben literalmente en el mismo destino (misma expresión de texto,
// p.ej. `mensaje.data()`), sin que la expresión cambie con aritmética de
// punteros entre medias (`+1`, `+offset`...), lo más probable es que se
// haya olvidado desplazar el puntero para el siguiente campo y la segunda
// escritura esté pisando la primera.
//
// Heurística deliberadamente conservadora: solo compara texto del destino
// tal cual aparece escrito. Si el offset se expresa de otra forma (variable
// distinta, índice, etc.) el texto ya no coincide y no se avisa — prefiere
// callarse a dar un falso positivo ruidoso.
//
// CORRECCIÓN 1: si el texto del destino termina en "+ variable" o "[variable]"
// (p.ej. "pdu.data() + pos"), el texto es idéntico en cada llamada aunque
// `pos` cambie de valor real entre medias mediante `pos += N`. El patrón
// "offset += tamaño_de_campo; siguiente_memcpy" es exactamente la forma
// idiomática de construir un PDU de tamaño fijo campo a campo — antes esta
// regla lo marcaba como falso positivo. Ahora, si detecta ese patrón de
// variable de offset al final del texto, comprueba si hubo una reasignación
// a esa variable entre las dos llamadas; si la hubo, no es una repetición
// real y no se avisa.
//
// CORRECCIÓN 2: la comparación era por función entera, sin noción de
// ámbito/bloque. Si una variable se REDECLARA en un bloque anidado (p.ej.
// `char pdu[6];` al principio de main(), y otro `char pdu[6];` distinto
// dentro de un if/else más adelante en la misma función — dos objetos
// distintos que comparten nombre por "shadowing"), la regla los confundía
// y marcaba repetición falsa entre memcpy de una PDU y memcpy de la otra,
// sin relación real. Corregido: si hay una nueva declaración del nombre
// base entre dos llamadas con el mismo texto de destino, no se considera
// repetición — es una variable distinta, no la misma sin desplazar.

// CORRECCIÓN 3: la comprobación de reasignación solo miraba el offset
// cuando aparecía como sufijo de la expresión de destino ("buffer.data()
// + pos"). Si el destino es directamente un puntero que se avanza en
// sentencias propias más adelante (`uint8_t *ptr = buffer.data(); ...
// ptr += sizeof(v);`), el texto de destino de cada memcpy es literalmente
// solo "ptr" — sin ningún sufijo que buscar — y la reasignación de "ptr"
// se pasaba por alto. Corregido: ahora también se comprueba la
// reasignación del nombre base completo, no solo del offset final.

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

// Patrón de identificador C++ Unicode-consciente: los estudiantes son
// españoles y usan `tamaño`, `posición`, `número`… La `ñ` y las vocales
// acentuadas NO casan con `[A-Za-z_]\w*` (ni `\w` incluye no-ASCII), así
// que con la regex antigua `trailingOffsetVarName("almacen.data()+tamaño")`
// devolvía null y NO se comprobaba la reasignación del offset (`tamaño +=
// 2`) → falso positivo real (alumno_020). Con `\p{L}` y el flag /u sí casa.
const IDENT = "[\\p{L}_][\\p{L}\\p{N}_]*";

/** Si el texto del destino termina en "+ variable" o "[variable]", devuelve el nombre de esa variable. */
function trailingOffsetVarName(dstText: string): string | null {
  const plus = dstText.match(new RegExp(`\\+\\s*(${IDENT})\\s*$`, "u"));
  if (plus) return plus[1];
  const bracket = dstText.match(new RegExp(`\\[\\s*(${IDENT})\\s*\\]$`, "u"));
  if (bracket) return bracket[1];
  return null;
}

/** El identificador base de la expresión de destino (p.ej. "pdu" tanto en
 * "pdu" como en "pdu+1" o "pdu[pos]"). */
function baseVarName(dstText: string): string | null {
  const m = dstText.match(new RegExp(`^(${IDENT})`, "u"));
  return m ? m[1] : null;
}

/** ¿Hubo una NUEVA declaración de `name` con posición en (fromIndex, toIndex)?
 * Esto cubre "shadowing": una variable local declarada de nuevo en un
 * bloque anidado (p.ej. un `char pdu[6];` distinto dentro de un `if`/`else`
 * posterior) es un objeto DISTINTO aunque comparta nombre con uno anterior
 * de la misma función — no tiene sentido comparar sus memcpy entre sí. */
function declaredBetween(fn: Parser.SyntaxNode, name: string, fromIndex: number, toIndex: number): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.startIndex <= fromIndex || n.startIndex >= toIndex) {
      for (const child of n.namedChildren) walk(child);
      return;
    }
    if (n.type === "declaration") {
      const declNode = n.childForFieldName("declarator");
      let cur: Parser.SyntaxNode | null = declNode ?? null;
      while (cur && cur.type !== "identifier") {
        cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
      }
      if (cur?.text === name) {
        found = true;
        return;
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return found;
}

/** ¿Hubo una reasignación a `name` con posición en (fromIndex, toIndex)? */
function reassignedBetween(fn: Parser.SyntaxNode, name: string, fromIndex: number, toIndex: number): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.startIndex <= fromIndex || n.startIndex >= toIndex) {
      for (const child of n.namedChildren) walk(child);
      return;
    }
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      if (left?.type === "identifier" && left.text === name) found = true;
    }
    if (n.type === "update_expression") {
      // offset++ / ++offset
      const arg = n.namedChildren[0];
      if (arg?.type === "identifier" && arg.text === name) found = true;
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return found;
}

/** Si `node` es IDENT, &IDENT o IDENT.data(), devuelve IDENT; si no, null. */
function identBehind(node: Parser.SyntaxNode): string | null {
  if (node.type === "identifier") return node.text;
  if (node.type === "pointer_expression") {
    const t = node.childForFieldName("argument");
    return t?.type === "identifier" ? t.text : null;
  }
  if (node.type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func?.type === "field_expression") {
      const obj = func.childForFieldName("argument");
      const field = func.childForFieldName("field");
      if (field?.text === "data" && obj?.type === "identifier") return obj.text;
    }
  }
  return null;
}

const SEND_FUNCS = ["write", "write_n", "send", "sendto"];

/** ¿Se pasó `name` (como IDENT, &IDENT o IDENT.data()) a alguna de las
 * funciones de envío, con posición en (fromIndex, toIndex)? Cubre el
 * patrón "rellena, envía, vuelve a rellenar" (sin bucle, o dentro de un
 * bucle donde el envío ocurre antes del siguiente relleno) — una vez
 * enviado, reutilizar el mismo buffer para el siguiente mensaje es
 * legítimo, no una repetición sin desplazar. */
function sentBetween(fn: Parser.SyntaxNode, name: string, fromIndex: number, toIndex: number): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.startIndex <= fromIndex || n.startIndex >= toIndex) {
      for (const child of n.namedChildren) walk(child);
      return;
    }
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (bare && SEND_FUNCS.includes(bare)) {
        const args = n.childForFieldName("arguments");
        for (const arg of args?.namedChildren ?? []) {
          if (identBehind(arg) === name) {
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

export function findRepeatedDestinationIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(MEMCPY_QUERY);
  const matches = query.matches(tree.rootNode);

  interface Call {
    fnStart: number;
    dstText: string;
    dstNode: Parser.SyntaxNode;
    callStart: number;
  }

  const calls: Call[] = [];

  for (const match of matches) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    const fn = enclosingFunction(callNode);
    if (!fn) continue;

    calls.push({
      fnStart: fn.startIndex,
      dstText: arg0.text.trim(),
      dstNode: arg0,
      callStart: callNode.startIndex,
    });
  }

  // Agrupa por función y ordena por posición en el fichero.
  const byFunction = new Map<number, Call[]>();
  for (const c of calls) {
    const list = byFunction.get(c.fnStart) ?? [];
    list.push(c);
    byFunction.set(c.fnStart, list);
  }

  const findings: Finding[] = [];

  for (const list of byFunction.values()) {
    list.sort((a, b) => a.callStart - b.callStart);
    const seen = new Map<string, Call>(); // dstText -> última aparición relevante

    for (const c of list) {
      const previous = seen.get(c.dstText);
      if (previous) {
        const offsetName = trailingOffsetVarName(c.dstText);
        const fn = enclosingFunction(c.dstNode);
        const baseName = baseVarName(c.dstText);
        // Se comprueba la reasignación tanto del offset "final" (patrón
        // "buffer.data() + pos") como del nombre base completo (patrón
        // "ptr += sizeof(v)" cuando el destino ES directamente el
        // puntero, sin ninguna expresión compuesta alrededor — el caso
        // real que se nos escapaba: un puntero que avanza con += en
        // sentencias propias, no como sufijo de la expresión de destino).
        const reassigned =
          !!(offsetName && fn && reassignedBetween(fn, offsetName, previous.callStart, c.callStart)) ||
          !!(baseName && fn && reassignedBetween(fn, baseName, previous.callStart, c.callStart));
        const redeclarada =
          baseName && fn && declaredBetween(fn, baseName, previous.callStart, c.callStart);
        const enviada =
          baseName && fn && sentBetween(fn, baseName, previous.callStart, c.callStart);
        if (reassigned || redeclarada || enviada) {
          // El offset avanzó de verdad, la variable se redeclaró
          // (shadowing), o el buffer se envió entre medias — en ninguno
          // de los tres casos es una repetición real, aunque el texto
          // sea idéntico. Se actualiza el punto de referencia para
          // seguir comparando contra este.
          seen.set(c.dstText, c);
          continue;
        }
        findings.push({
          startIndex: c.dstNode.startIndex,
          endIndex: c.dstNode.endIndex,
          message:
            `Este memcpy escribe en el mismo destino que otro memcpy anterior en la misma función ` +
            `("${c.dstText}"), sin desplazamiento de por medio. ¿Has olvidado avanzar el puntero ` +
            `para no pisar lo que ya habías escrito?`,
        });
      } else {
        seen.set(c.dstText, c);
      }
    }
  }

  return findings;
}
