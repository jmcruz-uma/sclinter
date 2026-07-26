import Parser from "web-tree-sitter";

// Regla: si dentro de la misma función hay dos (o más) llamadas a memcpy
// que escriben en el mismo destino, sin que la expresión cambie con
// aritmética de punteros entre medias (`+1`, `+offset`...), lo más probable
// es que se haya olvidado desplazar el puntero para el siguiente campo y la
// segunda escritura esté pisando la primera.
//
// Heurística deliberadamente conservadora: compara el texto del destino
// tal cual aparece escrito (salvo los envoltorios que no cambian la
// dirección, ver CORRECCIÓN 5). Si el offset se expresa de otra forma
// (variable distinta, índice, etc.) el texto ya no coincide y no se avisa
// — prefiere callarse a dar un falso positivo ruidoso.
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
//
// CORRECCIÓN 4 (nombre base sobre el ÁRBOL, no con expresión regular): el
// nombre base se sacaba con una regex anclada al principio del texto, y
// devolvía null en cuanto el destino no empezaba por el identificador:
// `&sec` → null, `*ptr` → null, `(uint8_t*)&pdu` → null, y
// `std::addressof(sec)` → "std" (basura silenciosa, peor que fallar).
// Con el nombre base a null, las TRES excepciones de arriba quedaban
// muertas para cualquier destino en forma de dirección — causa raíz de
// buena parte de los falsos positivos del sondeo de 2026-07-26. Ahora se
// resuelve recorriendo el árbol (`identificadorBase`), que además cubre
// gratis `pdu->buf`, `buf[i]` y los casts de C++. OJO con estos últimos:
// `static_cast<T*>(x)` NO es un `cast_expression`, es un `call_expression`
// cuyo `function` es un `template_function` — comprobado con sonda, cae en
// la misma rama que `.data()` y que `addressof`, y hay que distinguirlos
// por la forma del `function`.
//
// CORRECCIÓN 5 (normalización antes de comparar): la comparación textual
// dejaba escapar un falso negativo real — `memcpy((uint8_t*)&pdu, ...)` y
// `memcpy(&pdu, ...)` escriben en el MISMO sitio, pero como textos son
// distintos y nunca se comparaban entre sí. Ahora, antes de comparar, se
// quitan los envoltorios que NO cambian la dirección: casts (de C y de
// C++), paréntesis redundantes y `std::addressof(x)` → `&x`. No se
// normaliza `arr.data()` ↔ `&arr`: para un std::array son la misma
// dirección, pero para std::string/vector no lo son, y distinguirlo
// exigiría saber el tipo.
//
// CORRECCIÓN 6 (discriminador de origen): dos memcpy con el mismo destino
// pero que copian LO MISMO DESDE EL MISMO SITIO no pisan nada — la segunda
// copia deja el destino exactamente igual que la primera. Es el patrón de
// la misma extracción repetida en dos ramas excluyentes de un if/else, que
// producía 11 falsos positivos. Si destino y origen coinciden, se calla.
// COLETILLA IMPRESCINDIBLE: el origen también se compara por texto, así que
// `memcpy(&x, buf.data()+off, 2); off += 2; memcpy(&x, buf.data()+off, 2);`
// tiene el mismo texto de origen y sin embargo son dos campos DISTINTOS
// (bug real). Por eso solo se calla si además el offset del origen NO se ha
// reasignado entre las dos llamadas.
//
// CORRECCIÓN 7 (cuarta excepción, destino escalar con orígenes de buffers
// distintos): reutilizar una variable de paso para extraer de DOS mensajes
// distintos es normal (`memcpy(&INFO, mensaje.data()+2, 4)` en la rama del
// teclado y `memcpy(&INFO, almacen+2, 4)` en la del socket). Lo que sí es
// bug es extraer dos campos del MISMO buffer sobre la misma variable
// (alumno_028: `&ack` desde `almacen+1` y desde `almacen+3`, cuando el
// primero debía ser `&seq`). La regla pregunta "¿has olvidado avanzar
// dentro del mismo mensaje?" — si los orígenes son mensajes distintos, la
// pregunta no aplica.
//
// "Destino escalar" se decide por la FORMA SINTÁCTICA, no por el tipo:
// `&x` o `std::addressof(x)` (tras quitar casts) es dirección de una
// variable; `x.data()`, `x`, `x+n`, `x[i]` es buffer. Así no hace falta
// inferir tipos, y un `&pdu` de un struct entero cae en el lado correcto:
// tampoco se avanza un puntero dentro de él.
//
// CORRECCIÓN 8 (mensaje partido): "¿has olvidado avanzar el puntero?" no
// tiene sentido cuando el destino es una variable — nadie avanza un puntero
// dentro de un uint16_t. Con destino en forma de dirección se emite un
// mensaje propio, que además puede afirmar "del mismo buffer" sin riesgo
// porque la excepción de la CORRECCIÓN 7 ya se ha llevado por delante los
// casos de buffers distintos.

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

/** Si el texto termina en "+ variable" o "[variable]", devuelve el nombre de
 * esa variable. Sigue siendo textual a propósito: buscar un offset al final
 * de la expresión es un patrón de texto por naturaleza, ya es unicode-safe
 * y funciona. Se usa tanto para el destino como para el origen. */
function trailingOffsetVarName(texto: string): string | null {
  const plus = texto.match(new RegExp(`\\+\\s*(${IDENT})\\s*$`, "u"));
  if (plus) return plus[1];
  const bracket = texto.match(new RegExp(`\\[\\s*(${IDENT})\\s*\\]$`, "u"));
  if (bracket) return bracket[1];
  return null;
}

const CASTS_CPP = ["static_cast", "reinterpret_cast", "const_cast", "dynamic_cast"];

function nombrePelado(node: Parser.SyntaxNode | null): string {
  return node ? node.text.replace(/\s+/g, "").replace(/^.*::/, "") : "";
}

/** ¿Es este nodo un cast de C++ (`static_cast<T>(x)` y compañía)? Sonda del
 * árbol: NO son `cast_expression`, son `call_expression` con
 * `function: template_function`. */
function esCastCpp(node: Parser.SyntaxNode): boolean {
  if (node.type !== "call_expression") return false;
  const func = node.childForFieldName("function");
  if (func?.type !== "template_function") return false;
  return CASTS_CPP.includes(nombrePelado(func.childForFieldName("name")));
}

/** ¿Es una llamada a std::addressof(x)? */
function esAddressof(node: Parser.SyntaxNode): boolean {
  return (
    node.type === "call_expression" &&
    nombrePelado(node.childForFieldName("function")) === "addressof"
  );
}

function primerArgumento(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return node.childForFieldName("arguments")?.namedChildren[0] ?? null;
}

/** Quita los envoltorios que NO cambian la dirección: paréntesis, cast de C
 * y cast de C++. Deja intacto todo lo demás. */
function sinEnvoltorios(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let n = node;
  for (;;) {
    if (n.type === "parenthesized_expression" && n.namedChildren[0]) {
      n = n.namedChildren[0];
      continue;
    }
    if (n.type === "cast_expression") {
      const valor = n.childForFieldName("value");
      if (valor) {
        n = valor;
        continue;
      }
    }
    if (esCastCpp(n)) {
      const arg = primerArgumento(n);
      if (arg) {
        n = arg;
        continue;
      }
    }
    return n;
  }
}

/** Texto canónico del destino/origen para poder comparar dos llamadas:
 * se quitan los envoltorios que no cambian la dirección y `addressof(x)` se
 * escribe como `&x`. Así `(uint8_t*)&pdu`, `static_cast<void*>(&pdu)`,
 * `std::addressof(pdu)` y `&pdu` se reconocen como el mismo destino. */
function textoNormalizado(node: Parser.SyntaxNode): string {
  const n = sinEnvoltorios(node);
  if (esAddressof(n)) {
    const arg = primerArgumento(n);
    if (arg) return `&${textoNormalizado(arg)}`;
  }
  return n.text.trim();
}

/** ¿El destino tiene forma de DIRECCIÓN DE UNA VARIABLE (`&x`,
 * `std::addressof(x)`) en vez de forma de buffer (`x`, `x.data()`, `x+n`,
 * `x[i]`)? Criterio sintáctico a propósito: no hace falta inferir tipos. */
function esDireccionDeVariable(node: Parser.SyntaxNode): boolean {
  const n = sinEnvoltorios(node);
  if (esAddressof(n)) return true;
  return n.type === "pointer_expression" && n.child(0)?.text === "&";
}

/** El identificador base de una expresión, resuelto sobre el ÁRBOL (ver
 * CORRECCIÓN 4). Devuelve "pdu" tanto en `pdu` como en `&pdu`, `*pdu`,
 * `pdu.data()`, `pdu->campo`, `pdu[i]`, `pdu + 2`, `(uint8_t*)&pdu`,
 * `static_cast<void*>(&pdu)` o `std::addressof(pdu)`. */
function identificadorBase(node: Parser.SyntaxNode | null): string | null {
  if (!node) return null;
  const n = sinEnvoltorios(node);

  if (n.type === "identifier" || n.type === "field_identifier") return n.text;

  // &x, *x
  if (n.type === "pointer_expression") return identificadorBase(n.childForFieldName("argument"));

  // x.campo, x->campo  → nos interesa el objeto, no el campo
  if (n.type === "field_expression") return identificadorBase(n.childForFieldName("argument"));

  // x[i] → x
  if (n.type === "subscript_expression") return identificadorBase(n.childForFieldName("argument"));

  // x + 2 → x
  if (n.type === "binary_expression") return identificadorBase(n.childForFieldName("left"));

  if (n.type === "call_expression") {
    // std::addressof(x) → x
    if (esAddressof(n)) return identificadorBase(primerArgumento(n));
    // x.data() → x
    const func = n.childForFieldName("function");
    if (func?.type === "field_expression") return identificadorBase(func.childForFieldName("argument"));
  }

  return null;
}

/** Todos los identificadores declarados por una `declaration`. OJO:
 * `uint8_t TIPO, id_SLOT;` produce DOS campos `declarator` hermanos
 * (comprobado con sonda), y `childForFieldName("declarator")` devuelve solo
 * el primero — por eso `id_SLOT` era invisible como redeclaración. También
 * cubre `uint8_t a = 1, b = 2;`, donde los hijos son `init_declarator`. */
function nombresDeclarados(declaration: Parser.SyntaxNode): string[] {
  const nombres: string[] = [];
  for (let i = 0; i < declaration.childCount; i++) {
    if (declaration.fieldNameForChild(i) !== "declarator") continue;
    let cur: Parser.SyntaxNode | null = declaration.child(i);
    while (cur && cur.type !== "identifier") {
      cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
    }
    if (cur) nombres.push(cur.text);
  }
  return nombres;
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
    if (n.type === "declaration" && nombresDeclarados(n).includes(name)) {
      found = true;
      return;
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

const SEND_FUNCS = ["write", "write_n", "send", "sendto"];

/** ¿Se pasó `name` a alguna de las funciones de envío, con posición en
 * (fromIndex, toIndex)? Cubre el patrón "rellena, envía, vuelve a rellenar"
 * — una vez enviado, reutilizar el mismo buffer para el siguiente mensaje
 * es legítimo, no una repetición sin desplazar. */
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
          if (identificadorBase(arg) === name) {
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

function mensajeBuffer(dstText: string): string {
  return (
    `Este memcpy escribe en el mismo destino que otro memcpy anterior en la misma función ` +
    `("${dstText}"), sin desplazamiento de por medio. ¿Has olvidado avanzar el puntero ` +
    `para no pisar lo que ya habías escrito?`
  );
}

function mensajeEscalar(dstText: string): string {
  return (
    `Este memcpy y otro anterior extraen del mismo buffer sobre la misma variable ` +
    `("${dstText}"), con desplazamientos distintos: el segundo pisa el valor del primero. ` +
    `¿Querías dos variables distintas?`
  );
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
    srcText: string;
    srcNode: Parser.SyntaxNode;
    callStart: number;
  }

  const calls: Call[] = [];

  for (const match of matches) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !arg1 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    const fn = enclosingFunction(callNode);
    if (!fn) continue;

    calls.push({
      fnStart: fn.startIndex,
      dstText: textoNormalizado(arg0),
      dstNode: arg0,
      srcText: textoNormalizado(arg1),
      srcNode: arg1,
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
      if (!previous) {
        seen.set(c.dstText, c);
        continue;
      }

      const fn = enclosingFunction(c.dstNode);
      const offsetName = trailingOffsetVarName(c.dstText);
      const baseName = identificadorBase(c.dstNode);

      // Se comprueba la reasignación tanto del offset "final" (patrón
      // "buffer.data() + pos") como del nombre base completo (patrón
      // "ptr += sizeof(v)" cuando el destino ES directamente el puntero).
      const reassigned =
        !!(offsetName && fn && reassignedBetween(fn, offsetName, previous.callStart, c.callStart)) ||
        !!(baseName && fn && reassignedBetween(fn, baseName, previous.callStart, c.callStart));
      const redeclarada =
        !!(baseName && fn && declaredBetween(fn, baseName, previous.callStart, c.callStart));
      const enviada =
        !!(baseName && fn && sentBetween(fn, baseName, previous.callStart, c.callStart));

      // CORRECCIÓN 6: mismo origen textual y el origen no se ha movido de
      // verdad entre las dos llamadas → la segunda copia deja el destino
      // igual que la primera, no pisa nada.
      const offsetOrigen = trailingOffsetVarName(c.srcText);
      const origenSeMovio = !!(
        offsetOrigen &&
        fn &&
        reassignedBetween(fn, offsetOrigen, previous.callStart, c.callStart)
      );
      const mismaCopia = c.srcText === previous.srcText && !origenSeMovio;

      // CORRECCIÓN 7: destino en forma de dirección de variable y orígenes
      // que vienen de buffers base distintos → extracciones sin relación.
      const destinoEsVariable = esDireccionDeVariable(c.dstNode);
      const baseOrigenActual = identificadorBase(c.srcNode);
      const baseOrigenPrevio = identificadorBase(previous.srcNode);
      const origenesDeBuffersDistintos =
        destinoEsVariable &&
        baseOrigenActual !== null &&
        baseOrigenPrevio !== null &&
        baseOrigenActual !== baseOrigenPrevio;

      if (reassigned || redeclarada || enviada || mismaCopia || origenesDeBuffersDistintos) {
        // No es una repetición real, aunque el texto del destino coincida.
        // Se actualiza el punto de referencia para seguir comparando
        // contra este.
        seen.set(c.dstText, c);
        continue;
      }

      findings.push({
        startIndex: c.dstNode.startIndex,
        endIndex: c.dstNode.endIndex,
        message: destinoEsVariable ? mensajeEscalar(c.dstText) : mensajeBuffer(c.dstText),
      });
    }
  }

  return findings;
}
