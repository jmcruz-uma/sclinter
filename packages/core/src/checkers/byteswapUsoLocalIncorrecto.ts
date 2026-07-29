import Parser from "web-tree-sitter";
import { LECTURAS, ES_COMPLETA } from "./funcionesDeES";

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
//
// ---------------------------------------------------------------------------
// PASE DE REVISIÓN DEL CORPUS (2026-07-27)
// ---------------------------------------------------------------------------
//
// Los 44 avisos que esta regla daba sobre el corpus de exámenes se revisaron
// uno a uno y se cruzaron con el informe de corrección MANUAL
// (`Evaluacion2/anonimos/evaluacion.txt`), que es la verdad de referencia.
// Los 44 caían todos en Evaluacion2, en 26 ficheros y 32 pares
// (fichero, variable) — 12 avisos son usos repetidos de la misma variable.
// Quedaron así:
//
//  A) 28 avisos — emisor canónico: valor de origen local (strlen/.size()/argc)
//     convertido para enviarlo y reutilizado localmente como tamaño, límite de
//     bucle u offset. Aciertos limpios; el informe manual los describe con las
//     mismas palabras ("el bucle for usa numero_textos ya en big-endian como
//     límite"). Es el caso para el que existe la regla. Nada que tocar.
//
//  B) 10 avisos — `memcpy` con los argumentos INVERTIDOS al extraer del buffer
//     de red (`memcpy(almacen.data(), &tam, 2)`). La variable nunca se rellena,
//     así que la regla la ve como origen local y acierta el veredicto, pero
//     señala la causa equivocada: el fallo está en el orden de los argumentos,
//     no en las conversiones. El informe manual marca ese bug como [crítico] en
//     MÁS ficheros de los que vemos, así que hay hueco para una regla propia
//     (destino = buffer leído de red, origen = `&escalar` no escrito antes).
//     Se deja como tarea aparte: no se toca esta regla por ello.
//
//  C) 5 avisos — variable SIN INICIALIZAR sobre la que se aplica la conversión.
//     El aviso es correcto pero el defecto primario es otro, y dos de los cinco
//     tienen además un error de anchura muy nítido (`htonl` sobre un `uint16_t`,
//     `std::byteswap` sobre un `uint8_t`, que es un no-op). Material para
//     ampliar la regla 34, no para ésta. Se dejan como están.
//
//  D) 1 aviso — ÚNICO falso positivo, ya corregido: una recepción correcta
//     escrita con `mempcpy` (ver `EXTRACT_FUNCS` y `PAPELES_DE_ARGUMENTO`). El informe
//     manual coincide: "mempcpy en vez de memcpy — extensión GNU; el valor de
//     retorno se descarta, funciona igual".
//
// Conclusión: fuera del `mempcpy`, la regla no tenía falsos positivos sobre el
// corpus.
//
// ---------------------------------------------------------------------------
// POR QUÉ NO SE LEVANTA `swaps >= 1` (debatido y MEDIDO el 2026-07-29)
// ---------------------------------------------------------------------------
//
// La tentación es evidente: un valor que llega de la red y se usa en local SIN
// convertir también está mal, y el informe de corrección de Evaluacion4 lo
// penaliza en cinco alumnos ("no pasa a formato de host la métrica recibida").
// Se probó a levantarlo, exigiendo además anchura multibyte demostrada para
// dejar fuera los campos de un byte. Resultado del barrido: +56 avisos, y
// CUATRO de ellos sobre la solución oficial del profesor (Evaluacion2,
// ejemplo_soluciones_cpp/ejercicio3.cpp, líneas 129 y 147-153). El motivo es su
// idioma portable:
//
//     std::uint16_t longitud;
//     if (std::endian::native == std::endian::little) longitud = std::byteswap(longitud_be);
//     else                                            longitud = longitud_be;   // 0 conversiones
//     std::vector<char> almacen(longitud);                                      // y aquí se usa
//
// En una máquina big-endian el orden de red y el de host SON EL MISMO, así que
// esa rama es correcta. Es decir: `swaps == 0` no significa "sin convertir",
// significa "no consta que hiciera falta convertir".
//
// Y el fondo del asunto, que es lo que hay que recordar: con `swaps >= 1` es el
// PROPIO PROGRAMA el que aporta la prueba — al escribir una conversión, el
// estudiante declara que ese campo la necesita, y a partir de ahí la regla solo
// tiene que contar la paridad, sin saber qué significa el campo. Con
// `swaps == 0` no hay ninguna prueba, y afirmar que falta una conversión exige
// saber qué es ese dato. El contraejemplo está en el propio corpus: el ej1 de
// Evaluacion3 recibe una IP `uint32_t` de la red y hace `addr.s_addr = ip` SIN
// convertir, porque convertirla sería el error — misma forma exacta que los
// cinco alumnos de Evaluacion4 y veredicto opuesto. Lo único que las distingue
// es el significado del campo, que no está en el código.
//
// Contraejemplo del profesor, en la misma línea: un proxy que recibe un dato y
// lo retransmite tal cual por otro socket es correcto y no convierte nada. Hoy
// no salta por cobertura (el valor retransmitido es el argumento *buffer*, no
// el de tamaño), pero eso es suerte, no un argumento.
//
// CONCLUSIÓN: los cinco alumnos que el informe penaliza por esto NO son
// detectables con análisis sintáctico sin el enunciado, igual que la lógica de
// la FIFO o del temporizador del ejercicio 5. No es una carencia que arreglar.
//
// ---------------------------------------------------------------------------
// DOBLE BYTESWAP: por qué se puede acusar sin saber qué rama corrió
// ---------------------------------------------------------------------------
//
// El helper del enunciado rellena el parámetro de la red y lo convierte, así
// que lo entrega en orden de host; si el llamante vuelve a convertirlo, queda
// otra vez en orden de red. Detectarlo se aplazó porque el resumen del callee
// se diseñó para justificar SILENCIO y aquí pasa a justificar una ACUSACIÓN, y
// el relleno del helper es CONDICIONAL: en la solución oficial vive dentro de
// un `else if (pfd[1].revents)` y de sus diez salidas solo tres tocan el
// parámetro. Lo demostrable no es "al volver está en host" sino "SI lo tocó,
// quedó en host". Apoyarse en el invariante del enunciado ("evento válido ⟹
// campos rellenos") se descartó explícitamente: la herramienta no lo comprueba.
//
// Lo que cierra el hueco es dar el veredicto en el LLAMANTE y unir los dos
// caminos, en vez de exigir certeza al callee:
//
//   - si el helper lo tocó  → orden de host (rellenó de red y convirtió);
//   - si no lo tocó         → la variable conserva lo que tuviera antes, y una
//                             variable local que nunca fue destino de red nace
//                             en orden de host (convenio ya usado por la regla
//                             para la mayoría de sus avisos).
//
// Los dos caminos coinciden, así que el byteswap del llamante la deja en orden
// de red SEA CUAL SEA la rama ejecutada, y no hay que suponer nada. Y esto no
// es suerte: es la forma del bug. Con el idioma correcto —helper que rellena
// crudo, llamante que convierte una vez— los dos caminos son `red` y `host`,
// discrepan, y se sigue callando. La disyunción solo se cierra cuando el
// helper ya dejó el dato en host, que es justo el caso con bug.
//
// Control (comprobado): la solución oficial del ej1 de Evaluacion2, que tiene
// ese helper, sigue dando CERO avisos; inyectándole un segundo byteswap tras
// la llamada, avisa en `if (ack == 1)`. Sobre los tres corpus (519 ficheros,
// 494 avisos) el cambio no mueve ni un aviso: el patrón no aparece en ninguna
// entrega, la fase se hizo por lo que pueda venir en convocatorias futuras.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SWAP_FUNCS = ["htons", "ntohs", "htonl", "ntohl", "byteswap"];
// Ya no hay una lista aparte de "funciones con tamaño": la única fuente de
// verdad es PAPELES_DE_ARGUMENTO, más abajo. Antes existía un SIZE_FUNCS con
// solo memcpy/read_n/write_n —así desde el commit inicial del proyecto y sin
// razón documentada— que dejaba fuera a read/write/send/recv/sendto/recvfrom;
// eso hacía que `sendto(sd, b, l1+l2, ...)` avisara y `sendto(sd, b, l1, ...)`
// no, que es una incoherencia difícil de explicar a un estudiante.
/** Funciones que EXTRAEN un valor de un buffer con la firma `(dst, src, n)`:
 * ver `memcpy(&longitud, almacen, 2)` es lo que permite saber que `longitud`
 * salió de un buffer leído de la red. `mempcpy` es la extensión GNU de
 * `memcpy` — misma firma, solo cambia el valor de retorno (devuelve `dst + n`
 * en vez de `dst`), así que a efectos de esta regla es idéntica. Se añadió
 * tras encontrar un falso positivo en el corpus: una recepción correcta
 * escrita con `mempcpy` se leía como "origen local" porque el nombre no
 * estaba en esta lista.
 *
 * `memccpy` NO entra, aunque el nombre se parezca: su firma es
 * `(dst, src, c, n)` — el tercer argumento es un carácter de parada, no un
 * tamaño. Tratarla como `memcpy` sería acertar de casualidad en las llamadas
 * de tres argumentos (que además están mal escritas) y equivocarse en las
 * bien escritas.
 *
 * Que aquí se reconozca `mempcpy` NO significa que se acepte: la regla
 * `mempcpy-extension-gnu` la prohíbe por normativa. Reconocerla es lo que
 * evita acusar de un error de orden de bytes a quien lo tiene bien. */
const EXTRACT_FUNCS = ["memcpy", "mempcpy"];
const READ_FUNCS = LECTURAS;
const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="];

/** Para las funciones cuya firma conocemos, qué papel juega cada posición de
 * argumento: `buffer` es una dirección (una suma ahí es un DESPLAZAMIENTO) y
 * `tamano` es una cuenta de bytes (una suma ahí es parte del TAMAÑO).
 *
 * Va por POSICIÓN a propósito. La versión anterior buscaba cualquier `+`
 * dentro de un `argument_list` y daba por buffer a cualquier identificador que
 * hubiera a la izquierda; con `mensaje+2` acertaba, pero con
 * `sendto(sd, m, long1+long2+4, ...)` habría llamado buffer a `long1` y dicho
 * "desplazamiento dentro de un buffer" sobre un tamaño. Saber la posición
 * quita la ambigüedad de raíz. */
const PAPELES_DE_ARGUMENTO: Record<string, { buffer: number[]; tamano: number }> = {
  memcpy: { buffer: [0, 1], tamano: 2 },
  mempcpy: { buffer: [0, 1], tamano: 2 },
  // Las funciones de E/S comparten firma en lo que aquí importa: el buffer va
  // en la posición 1 y el tamaño en la 2. Se generan desde la única fuente de
  // verdad de nombres para que las variantes de los helpers (`readn`, `readN`,
  // `read_N`...) no haya que repetirlas aquí.
  ...Object.fromEntries(ES_COMPLETA.map((f) => [f, { buffer: [1], tamano: 2 }])),
};

/** Quita los envoltorios que no cambian el valor: paréntesis y casts. Sin
 * esto, `(size_t)longitud` o `(2 + tam)` no se reconocen y el aviso se pierde
 * — casos reales del corpus. */
function desenvuelve(n: Parser.SyntaxNode): Parser.SyntaxNode {
  let e = n;
  while (e.type === "parenthesized_expression" || e.type === "cast_expression") {
    const sig = e.childForFieldName("value") ?? e.namedChildren[e.namedChildren.length - 1];
    if (!sig) break;
    e = sig;
  }
  return e;
}

/** Operandos de una cadena aditiva, en orden textual: `a+b-c` -> [a,b,c].
 * La gramática asocia por la izquierda (comprobado), así que `a+b-c` es
 * `(a+b)-c` y hay que bajar por el lado izquierdo. Los paréntesis se
 * atraviesan, de modo que `base+(2+tam+1)` aporta también `tam`. Si el nodo no
 * es una suma ni una resta, devuelve solo ese nodo.
 *
 * La RESTA cuenta igual que la suma, y el signo da lo mismo: lo que importa es
 * que un valor en orden de red intervenga en la cuenta. Si una longitud de 10
 * vale 2560 por estar convertida, `base + total - longitud` queda tan mal como
 * `base + longitud`. Se añadió de forma PREVENTIVA, a petición del profesor:
 * hay PDUs que se construyen del final hacia el principio y ahí la posición se
 * resta. No hay ningún caso así en los tres corpus de examen (comprobado: cero
 * restas en aritmética de buffer dentro de una llamada), así que su único
 * control vive en sample18. */
function operandosAditivos(n: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const e = desenvuelve(n);
  if (e.type === "binary_expression") {
    const op = e.childForFieldName("operator")?.text;
    if (op === "+" || op === "-") {
      const izq = e.childForFieldName("left");
      const der = e.childForFieldName("right");
      if (izq && der) return [...operandosAditivos(izq), ...operandosAditivos(der)];
    }
  }
  return [e];
}

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
  /** Cuerpo de cada función definida en el fichero, por nombre. Permite
   * calcular el RESUMEN del efecto de un callee sobre su parámetro. */
  funcs: Map<string, Parser.SyntaxNode>;
  /** Caché de resúmenes `nombreFuncion#posicionParametro`. "en-curso"
   * marca una recursión en marcha (recursión mutua → desconocido). */
  resumenes: Map<string, Resumen | "en-curso">;
  /** Nodo del uso que se está evaluando, para descartar mutaciones que
   * viven en una rama mutuamente excluyente con él. */
  useNode?: Parser.SyntaxNode;
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

/** Cada función DEFINIDA en el fichero, por nombre. Sin distinguir
 * sobrecargas (misma limitación que `nonConstRefParamsByFunction`). */
function functionDefinitionsByName(root: Parser.SyntaxNode): Map<string, Parser.SyntaxNode> {
  const map = new Map<string, Parser.SyntaxNode>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const name = functionDeclName(n.childForFieldName("declarator"));
      if (name && !map.has(name)) map.set(name, n);
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return map;
}

// ---------------------------------------------------------------------------
// Resúmenes de función (trazado interprocedural acotado)
// ---------------------------------------------------------------------------
//
// El límite general del proyecto es el análisis intra-función, y sigue en pie
// (ver CLAUDE.md). Aquí se hace una excepción MUY acotada, y conviene entender
// por qué no la contradice: la regla de `entradaSalidaConSocketEscucha` no
// puede ser interprocedural porque "¿es peligroso este descriptor?" depende de
// QUIÉN llama — no es una propiedad de la función. En cambio "¿esta función
// rellena su parámetro desde la red? ¿se lo convierte?" SÍ es una propiedad
// estática del callee, idéntica para todos sus llamantes. Son problemas
// distintos, y solo el segundo admite un resumen.
//
// Por eso, en vez de entrar recursivamente en el callee desde cada sitio de
// llamada, se calcula UNA vez por (función, posición de parámetro) un resumen
// del efecto sobre ese parámetro por referencia no-const, y se cachea.
//
// REGLA DE ORO: esto solo puede REFINAR el `unknown` que hoy hace callar a la
// regla; nunca inventar certeza. Ante la mínima ambigüedad (unas ramas
// rellenan y otras no, el parámetro se pasa a algo opaco, se le hace algo que
// no modelamos...) el resumen es `desconocido` y se sigue callando, igual que
// hoy. Así el cambio es monótono respecto al comportamiento anterior salvo
// donde hay certeza.
//
// El resumen compone SECUENCIAS (`memcpy(&v,...); v = byteswap(v);` es un solo
// efecto encadenado, no dos veredictos que reconciliar) y sigue exigiendo
// acuerdo entre ALTERNATIVAS (ramas excluyentes que dejan órdenes distintas →
// `desconocido`). Cuando el efecto no se demuestra incondicional, el resumen
// es `condicional` y lo resuelve el llamante uniendo los dos caminos.

type Resumen =
  /** El callee no toca el parámetro: la llamada es irrelevante y se ignora. */
  | { kind: "intacto" }
  /** El orden final es el ENTRANTE alternado `swaps` veces (`x = byteswap(x)`). */
  | { kind: "relativo"; swaps: number }
  /** El orden final no depende del entrante (`x = htons(strlen(s))`, o lectura de red). */
  | { kind: "absoluto"; orden: Orden }
  /** SI el callee tocó el parámetro, lo dejó en `orden`; si no, lo dejó como
   * estaba. Lo resuelve el llamante (ver el join en `analyze`). */
  | { kind: "condicional"; orden: Orden }
  | { kind: "desconocido" };

function mismoResumen(a: Resumen, b: Resumen): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "relativo" && b.kind === "relativo") return a.swaps === b.swaps;
  if ((a.kind === "absoluto" || a.kind === "condicional") && "orden" in b) {
    return a.orden.order === b.orden.order && a.orden.swaps === b.orden.swaps;
  }
  return true;
}

/** Nombre del parámetro en la posición `pos` de una función definida.
 * OJO (comprobado sobre el árbol real): `reference_declarator` NO tiene campo
 * `declarator`; su identificador es `namedChildren[0]`. */
function nombreParametro(fnDef: Parser.SyntaxNode, pos: number): string | null {
  const declarator = fnDef.childForFieldName("declarator");
  const paramList =
    declarator?.childForFieldName("parameters") ??
    declarator?.namedChildren.find((c) => c.type === "parameter_list");
  const pd = paramList?.namedChildren.filter((c) => c.type === "parameter_declaration")[pos];
  if (!pd) return null;
  return functionDeclName(pd.childForFieldName("declarator"));
}

/** TODAS las apariciones de `param` en el cuerpo que podrían modificarlo.
 *
 * Deliberadamente sobre-aproximada: ante la duda incluye la aparición. Tiene
 * dos usos, y en ambos el exceso empuja hacia el silencio:
 *  - lista vacía  → nadie lo toca → resumen `intacto` (la única afirmación).
 *  - lista no vacía → cada aparición debe quedar CUBIERTA por una mutación de
 *    las que sí sabemos interpretar; si sobra alguna, el resumen se calcularía
 *    sobre media película, así que se devuelve `desconocido`. */
function aparicionesModificadoras(
  cuerpo: Parser.SyntaxNode,
  param: string,
  refParams: Map<string, Set<number>>
): Parser.SyntaxNode[] {
  // Métodos que no pueden modificar el objeto. Cualquier otro método sobre el
  // parámetro (data(), resize(), push_back()...) cuenta como modificación.
  const METODOS_SOLO_LECTURA = ["size", "length", "empty", "c_str"];
  const apariciones: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    // x = ..., x += ..., x.campo = ..., x[i] = ...
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      if (left && bufferBaseName(left) === param) apariciones.push(n);
    }
    // ++x / x--
    if (n.type === "update_expression") {
      const arg = n.childForFieldName("argument") ?? n.namedChildren[0];
      if (arg && bufferBaseName(arg) === param) apariciones.push(n);
    }
    // &x, &x.campo — se toma su dirección: podría escribirse a través de ella.
    if (n.type === "pointer_expression" && bufferBaseName(n) === param) apariciones.push(n);
    // auto& r = x;  /  auto* p = x;  — se crea un alias mutable.
    if (n.type === "init_declarator") {
      const d = n.childForFieldName("declarator");
      const v = n.childForFieldName("value");
      if (
        (d?.type === "reference_declarator" || d?.type === "pointer_declarator") &&
        v &&
        anyIdentifierIn(v, new Set([param]))
      ) {
        apariciones.push(n);
      }
    }
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      // x.metodo(...) con un método que no sea de solo lectura.
      if (func?.type === "field_expression") {
        const metodo = func.childForFieldName("field")?.text;
        const obj = func.childForFieldName("argument");
        if (obj && bufferBaseName(obj) === param && !METODOS_SOLO_LECTURA.includes(metodo ?? "")) {
          apariciones.push(n);
        }
      }
      // Se lo pasa a OTRA función propia en una posición por referencia
      // no-const: esa podría rellenarlo (se trata aparte, como desconocido).
      const b = bare(func);
      const positions = b ? refParams.get(b) : undefined;
      if (positions) {
        const args = n.childForFieldName("arguments")?.namedChildren ?? [];
        for (let i = 0; i < args.length; i++) {
          if (positions.has(i) && bufferBaseName(args[i]) === param) apariciones.push(n);
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(cuerpo);
  return apariciones;
}

/** Efecto de una expresión (el RHS de una asignación al parámetro) sobre el
 * orden de bytes, distinguiendo si depende del valor ENTRANTE o no. */
function efectoDeExpr(
  calleeFn: Parser.SyntaxNode,
  expr: Parser.SyntaxNode,
  index: number,
  ctx: Ctx,
  param: string,
  depth: number
): Resumen {
  if (depth > 40) return { kind: "desconocido" };
  let e = expr;
  while (e.type === "parenthesized_expression" || e.type === "cast_expression") {
    const sig = e.childForFieldName("value") ?? e.namedChildren[e.namedChildren.length - 1];
    if (!sig) break;
    e = sig;
  }
  const swapArg = isSwapCall(e);
  if (swapArg) {
    const r = efectoDeExpr(calleeFn, swapArg, index, ctx, param, depth + 1);
    if (r.kind === "relativo") return { kind: "relativo", swaps: r.swaps + 1 };
    if (r.kind === "absoluto") {
      return {
        kind: "absoluto",
        orden: { order: toggle(r.orden.order), swaps: r.orden.swaps + 1 },
      };
    }
    return { kind: "desconocido" };
  }
  if (e.type === "identifier" && e.text === param) {
    // Es el propio parámetro: su efecto es el de la cadena de mutaciones que
    // lo preceden DENTRO del callee. Si no hay ninguna, es el valor ENTRANTE.
    return efectoEn(calleeFn, param, index, ctx, depth + 1);
  }
  const orden = analyzeExpr(calleeFn, e, index, ctx, depth + 1);
  if (orden.order === "unknown") return { kind: "desconocido" };
  return { kind: "absoluto", orden };
}

function efectoDeMutacion(
  calleeFn: Parser.SyntaxNode,
  param: string,
  m: Mutacion,
  ctx: Ctx,
  depth: number
): Resumen {
  const DE_RED: Resumen = { kind: "absoluto", orden: { order: "network", swaps: 0 } };
  if (m.kind === "read") return DE_RED;
  if (m.kind === "memcpy") {
    const src = m.node.childForFieldName("arguments")?.namedChildren[1];
    if (src && anyIdentifierIn(src, ctx.readBufs)) return DE_RED;
    return { kind: "desconocido" };
  }
  // Se lo pasa a su vez a otra función por referencia: no lo perseguimos.
  if (m.kind === "refpass") return { kind: "desconocido" };
  return efectoDeExpr(calleeFn, m.node, m.pos, ctx, param, depth);
}

/** Efecto acumulado sobre `param` de todo lo que ocurre ANTES de `index`
 * dentro del callee: se sigue la última mutación hacia atrás, encadenando,
 * igual que hace `analyze` dentro de una función. Sin mutación previa, el
 * valor es el ENTRANTE (`relativo` con 0 conversiones).
 *
 * Esto es lo que compone SECUENCIAS: `memcpy(&v, buf, 2); v = byteswap(v);`
 * es "de red y luego convertido", no dos veredictos que haya que reconciliar. */
function efectoEn(
  calleeFn: Parser.SyntaxNode,
  param: string,
  index: number,
  ctx: Ctx,
  depth: number
): Resumen {
  if (depth > 40) return { kind: "desconocido" };
  const previa = mostRecentMutation(calleeFn, param, index, ctx);
  if (!previa) return { kind: "relativo", swaps: 0 };
  return efectoDeMutacion(calleeFn, param, previa, ctx, depth + 1);
}

/** Las mutaciones que pueden ser la ÚLTIMA en algún camino de ejecución.
 *
 * Una mutación queda PISADA si más adelante hay otra que no está en una rama
 * mutuamente excluyente con ella: entonces no puede decidir el valor final y
 * no debe entrar en la comparación. Las que sobreviven son alternativas de
 * verdad (ramas excluyentes), y ahí sí se exige que coincidan.
 *
 * Misma convención léxica que el análisis intra-función (ver
 * `ramasMutuamenteExcluyentes`): una mutación dentro de un `if` cuenta como
 * ejecutada para lo que venga después del `if`, que es justo el patrón
 * `if (little) v = byteswap(v);`. */
function mutacionesFinales(muts: Mutacion[]): Mutacion[] {
  return muts.filter(
    (m) => !muts.some((otra) => otra.pos > m.pos && !ramasMutuamenteExcluyentes(m.node, otra.node))
  );
}

/** Resumen del efecto de `fname` sobre su parámetro por referencia no-const
 * en la posición `argPos`. Cacheado; recursión acotada. */
function resumenParametro(ctx: Ctx, fname: string, argPos: number, depth: number): Resumen {
  const clave = `${fname}#${argPos}`;
  const cacheado = ctx.resumenes.get(clave);
  if (cacheado) return cacheado === "en-curso" ? { kind: "desconocido" } : cacheado;
  if (depth > 8) return { kind: "desconocido" };

  const calleeFn = ctx.funcs.get(fname);
  const param = calleeFn ? nombreParametro(calleeFn, argPos) : null;
  const cuerpo = calleeFn?.childForFieldName("body");
  if (!calleeFn || !param || !cuerpo) return { kind: "desconocido" };

  ctx.resumenes.set(clave, "en-curso");
  const ctxCallee: Ctx = { ...ctx, readBufs: readBufferNames(calleeFn), useNode: undefined };

  let r: Resumen;
  const apariciones = aparicionesModificadoras(cuerpo, param, ctx.refParams);
  if (apariciones.length === 0) {
    r = { kind: "intacto" };
  } else {
    const muts = collectMutations(calleeFn, param, calleeFn.endIndex, ctxCallee);
    // Nuestra detección de mutaciones es INCOMPLETA: hay formas de escribir un
    // parámetro que no modelamos (`mempcpy`, a través de un puntero, un campo
    // suelto, un método del contenedor...). Mientras el resumen solo servía
    // para callar, eso daba como mucho silencio de más. En cuanto sirve para
    // dar un veredicto, un callee con DOS escrituras —una que reconocemos y
    // otra que no— nos haría concluir sobre media película. Así que se exige
    // que toda aparición modificadora caiga dentro de una mutación conocida;
    // si sobra una sola, no hay resumen.
    const cubiertas = apariciones.every((a) => muts.some((m) => contiene(m.cover, a)));
    if (!cubiertas) {
      r = { kind: "desconocido" };
    } else {
      // Solo las mutaciones que pueden quedar las últimas deciden el valor de
      // salida, y cada una se calcula ENCADENANDO hacia atrás. Si sobrevive
      // más de una son ramas alternativas y se sigue exigiendo que coincidan.
      const finales = mutacionesFinales(muts);
      const efectos = finales.map((m) => efectoDeMutacion(calleeFn, param, m, ctxCallee, depth + 1));
      r = efectos.every((e) => mismoResumen(e, efectos[0])) ? efectos[0] : { kind: "desconocido" };
    }
  }

  // Un resumen que deja el parámetro en orden de HOST tras convertir es el
  // helper del enunciado: rellena de red y entrega el dato "ya en formato
  // nativo" (`memcpy(&seq,...); seq = byteswap(seq);`). Es justo el que
  // habilita el DOBLE byteswap — si el llamante vuelve a convertir, el valor
  // queda otra vez en orden de red.
  //
  // Pero aquí NO se puede afirmar "al volver está en orden de host": el
  // relleno casi siempre es CONDICIONAL (en la solución oficial vive dentro de
  // un `else if (pfd[1].revents)`, y de las diez salidas de la función solo
  // tres tocan el parámetro). Lo demostrable es más débil: "SI lo tocó, quedó
  // en host". Por eso el resumen se marca `condicional` y quien decide es el
  // llamante, que es el único que sabe qué había en la variable antes de la
  // llamada. Ver el join en `analyze`.
  if (r.kind === "absoluto" && r.orden.order === "host" && r.orden.swaps >= 1) {
    r = { kind: "condicional", orden: r.orden };
  }

  ctx.resumenes.set(clave, r);
  return r;
}

/** ¿Se pasó `name` como argumento en una posición de referencia no-const de
 * una función propia, en una posición ANTERIOR a beforeIndex? Si es así, esa
 * función pudo rellenarlo (p.ej. de la red) y su orden es desconocido.
 * Se ignoran las llamadas cuyo resumen demuestra que no tocan el parámetro. */
function wasRefPassedBefore(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number,
  ctx: Ctx
): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "call_expression" && n.startIndex < beforeIndex) {
      const fname = bare(n.childForFieldName("function"));
      const positions = fname ? ctx.refParams.get(fname) : undefined;
      if (positions && fname) {
        const args = n.childForFieldName("arguments")?.namedChildren ?? [];
        for (let i = 0; i < args.length; i++) {
          if (positions.has(i) && args[i].type === "identifier" && args[i].text === name) {
            // Si el resumen demuestra que el callee no toca ese parámetro,
            // la llamada no puede haber cambiado nada: se ignora. En los
            // demás casos se mantiene el desconocimiento — aquí `name` es el
            // objeto base de un campo (`mensaje` en `mensaje.num`) y el
            // resumen es del objeto entero, granularidad demasiado gruesa
            // para dar por bueno un veredicto concreto.
            if (resumenParametro(ctx, fname, i, 0).kind === "intacto") continue;
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

/** ¿El rango de `a` contiene al de `n`? */
function contiene(a: Parser.SyntaxNode, n: Parser.SyntaxNode): boolean {
  return n.startIndex >= a.startIndex && n.endIndex <= a.endIndex;
}

/** Rama de `ifStmt` en la que cae `node`: "cons" (then), "alt" (else, que
 * en una cadena else-if envuelve al if siguiente CON su condición) o null. */
function ramaDe(ifStmt: Parser.SyntaxNode, node: Parser.SyntaxNode): "cons" | "alt" | null {
  const cons = ifStmt.childForFieldName("consequence");
  const alt = ifStmt.childForFieldName("alternative");
  if (cons && contiene(cons, node)) return "cons";
  if (alt && contiene(alt, node)) return "alt";
  return null;
}

/** ¿Están la mutación y el uso en ramas DISTINTAS del MISMO if/else
 * (incluidas cadenas else-if)? Entonces nunca se ejecutan las dos, y esa
 * mutación no puede haber afectado al valor que se usa: hay que ignorarla.
 *
 * Caso real que motivó esto (examen): en la rama `if` se reconvierte la
 * longitud a orden de red para enviarla, y en el `else if` hermano se
 * compara la misma variable — que ahí sigue en orden de host, porque esa
 * rama no se ejecutó. Antes se avisaba en el `else if` (falso positivo).
 *
 * IMPORTANTE — es una comprobación puramente LÉXICA de ancestros, no un
 * modelado de flujo de control: solo descarta ramas hermanas del mismo
 * if/else. Una mutación dentro de un `if` cuyo uso viene DESPUÉS del
 * if completo sigue contando (patrón `if(little) x = byteswap(x);` y
 * luego usar x, que sí es un bug real y debe seguir avisando). */
function ramasMutuamenteExcluyentes(mut: Parser.SyntaxNode, use: Parser.SyntaxNode): boolean {
  let n: Parser.SyntaxNode | null = mut;
  while (n) {
    const p: Parser.SyntaxNode | null = n.parent;
    if (p?.type === "if_statement") {
      const rMut = ramaDe(p, mut);
      const rUse = ramaDe(p, use);
      if (rMut && rUse && rMut !== rUse) return true;
    }
    n = p;
  }
  return false;
}

// `cover` es la sentencia/llamada COMPLETA que produce la mutación (`node` es
// solo el RHS en el caso 'assign'). Sirve para comprobar que cada aparición
// modificadora del parámetro cae dentro de alguna mutación que sí sabemos
// interpretar — ver `aparicionesModificadoras`.
type Mutacion =
  | { kind: "read" | "memcpy" | "assign"; node: Parser.SyntaxNode; pos: number; cover: Parser.SyntaxNode }
  /** `callee`/`argPos` identifican a qué parámetro se pasó, para poder pedir
   * su RESUMEN en vez de rendirse con un `unknown` genérico. */
  | {
      kind: "refpass";
      node: Parser.SyntaxNode;
      pos: number;
      cover: Parser.SyntaxNode;
      callee: string;
      argPos: number;
    };

/** Todas las mutaciones de `name` con posición < beforeIndex:
 *  - 'read'    : name fue destino de una lectura de red → empieza en orden de red.
 *  - 'memcpy'  : name se extrajo con memcpy(&name, ...) de un buffer leído de red.
 *  - 'assign'  : name = RHS (o declaración con inicializador) → hereda de RHS.
 *  - 'refpass' : name se pasó por referencia no-const a una función propia.
 * El nodo es el RHS para 'assign' y la llamada para los demás.
 *
 * Las llamadas cuyo resumen dice `intacto` NO generan mutación: el callee no
 * toca el parámetro, así que la llamada no debe enmascarar una mutación
 * anterior que sí importa. */
function collectMutations(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number,
  ctx: Ctx
): Mutacion[] {
  const refParams = ctx.refParams;
  const encontradas: Mutacion[] = [];
  function consider(cand: Mutacion) {
    if (cand.pos >= beforeIndex) return;
    // Una mutación en una rama hermana del uso nunca se ejecutó con él:
    // no puede haber cambiado el valor que se está evaluando.
    if (ctx.useNode && ramasMutuamenteExcluyentes(cand.node, ctx.useNode)) return;
    if (cand.kind === "refpass") {
      if (resumenParametro(ctx, cand.callee, cand.argPos, 0).kind === "intacto") return;
    }
    encontradas.push(cand);
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const b = bare(n.childForFieldName("function"));
      const args = n.childForFieldName("arguments");
      if (b && READ_FUNCS.includes(b)) {
        const buf = args?.namedChildren[1];
        if (buf && identOf(buf) === name) consider({ kind: "read", node: n, pos: n.startIndex, cover: n });
      }
      if (b && EXTRACT_FUNCS.includes(b)) {
        const dst = args?.namedChildren[0];
        if (dst && identOf(dst) === name) consider({ kind: "memcpy", node: n, pos: n.startIndex, cover: n });
      }
      // Paso por referencia no-const a una función propia: el efecto sobre
      // `name` lo decide el RESUMEN de ese parámetro del callee.
      const positions = b ? refParams.get(b) : undefined;
      if (positions && b) {
        const as = args?.namedChildren ?? [];
        for (let i = 0; i < as.length; i++) {
          if (positions.has(i) && as[i].type === "identifier" && as[i].text === name) {
            consider({ kind: "refpass", node: n, pos: n.startIndex, cover: n, callee: b, argPos: i });
          }
        }
      }
    }
    if (n.type === "init_declarator") {
      const decl = n.childForFieldName("declarator");
      const value = n.childForFieldName("value");
      if (decl?.type === "identifier" && decl.text === name && value) {
        consider({ kind: "assign", node: value, pos: n.startIndex, cover: n });
      }
    }
    if (n.type === "assignment_expression" && n.childForFieldName("operator")?.text === "=") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "identifier" && left.text === name && right) {
        consider({ kind: "assign", node: right, pos: n.startIndex, cover: n });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return encontradas;
}

/** La mutación más reciente de `name` anterior a `beforeIndex`. */
function mostRecentMutation(
  fn: Parser.SyntaxNode,
  name: string,
  beforeIndex: number,
  ctx: Ctx
): Mutacion | null {
  let best: Mutacion | null = null;
  for (const m of collectMutations(fn, name, beforeIndex, ctx)) {
    if (!best || m.pos > best.pos) best = m;
  }
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
  const m = mostRecentMutation(fn, name, index, ctx);
  if (!m) return HOST0; // parámetro / declaración con origen local / sin rastro → orden de host
  if (m.kind === "read") return { order: "network", swaps: 0 };
  if (m.kind === "refpass") {
    // El callee tocó el parámetro (si no, `collectMutations` ya lo habría
    // descartado). Su RESUMEN decide; `desconocido` mantiene el silencio
    // que había antes de existir los resúmenes.
    const r = resumenParametro(ctx, m.callee, m.argPos, 0);
    if (r.kind === "absoluto") return r.orden;
    if (r.kind === "condicional") {
      // Dos caminos posibles: o el callee tocó el parámetro (y lo dejó en
      // `r.orden`) o no lo tocó (y sigue lo que hubiera antes de la llamada).
      // No sabemos cuál corrió, así que solo hay veredicto si los DOS coinciden
      // en el orden — el join de siempre: si los dos cuernos dicen lo mismo, no
      // hace falta saber qué rama se ejecutó.
      //
      // Y eso ocurre EXACTAMENTE en el patrón que interesa: cuando el helper
      // deja el dato en orden de host, "no haberlo tocado" también es orden de
      // host (una variable local que nunca fue destino de red nace en host,
      // ver el `return HOST0` de arriba), así que las dos ramas coinciden y un
      // byteswap posterior del llamante lo pone en orden de red por los dos
      // caminos. En cambio, con el idioma correcto —el helper lo rellena crudo
      // y el llamante convierte— los cuernos son `red` y `host`, discrepan, y
      // se sigue callando. La disyunción solo se cierra en el caso con bug.
      const previo = analyze(fn, name, m.pos, ctx, depth + 1);
      if (previo.order !== r.orden.order) return UNKNOWN0;
      // Conversiones garantizadas: las del camino que menos haga.
      return { order: previo.order, swaps: Math.min(previo.swaps, r.orden.swaps) };
    }
    if (r.kind === "relativo") {
      // El callee alternó el orden del valor ENTRANTE: hay que saber en qué
      // orden entró, y eso se resuelve donde siempre, en el llamante.
      const previo = analyze(fn, name, m.pos, ctx, depth + 1);
      let order = previo.order;
      for (let i = 0; i < r.swaps; i++) order = toggle(order);
      return { order, swaps: previo.swaps + r.swaps };
    }
    return UNKNOWN0;
  }
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
    if (base && wasRefPassedBefore(fn, base, index, ctx)) return UNKNOWN0;
  }
  // Una cadena aditiva arrastra el desorden de CUALQUIERA de sus operandos: si
  // uno está en orden de red, la cuenta entera queda mal. Esto es lo que
  // permite seguir el rastro a través de una variable intermedia:
  //   int total = 8 + tam1 + tam2;   // tam1/tam2 ya convertidas
  //   write_n(sd, buffer.data(), total);
  // El informe de corrección marca ese `total` como crítico y antes se perdía,
  // porque una `binary_expression` caía directamente en el `return HOST0` de
  // abajo. Se toma el orden del primer operando que esté en orden de red.
  //
  // Matiz de honestidad: `8 + 2560` no está literalmente "en orden de red", es
  // un número corrompido. El veredicto (no sirve para usarlo localmente) es el
  // correcto y el mensaje se aproxima; afinar más exigiría un tercer estado.
  const operandos = operandosAditivos(e);
  if (operandos.length > 1) {
    for (const op of operandos) {
      const o = analyzeExpr(fn, op, index, ctx, depth + 1);
      if (o.order === "network" && o.swaps >= 1) return o;
    }
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
  // Paréntesis y casts alrededor del uso no cambian el valor: `(size_t)tam`
  // es tan sospechoso como `tam`. Se señala el identificador de dentro, que es
  // de lo que habla el mensaje.
  const objetivo = desenvuelve(target);
  if (objetivo.type !== "identifier") return;
  // El nodo del uso viaja en el contexto para poder descartar mutaciones
  // que estén en una rama mutuamente excluyente con él.
  const chk: Ctx = { ...ctx, useNode: objetivo };
  const { order, swaps } = analyze(fn, objetivo.text, objetivo.startIndex, chk, 0);
  // Solo se avisa si en el punto de uso el valor está en orden de RED y llegó
  // ahí por AL MENOS UNA conversión. Ese `swaps >= 1` es la pieza que sostiene
  // toda la regla, y la razón no es la que estuvo escrita aquí mucho tiempo
  // ("un campo de 1 byte, donde el orden da igual"), que es incompleta. Ver la
  // sección "POR QUÉ NO SE LEVANTA `swaps >= 1`" en la cabecera antes de
  // tocar esta línea: ya se intentó, con medición, y rompe la solución oficial.
  if (order === "network" && swaps >= 1) {
    findings.push({
      startIndex: objetivo.startIndex,
      endIndex: objetivo.endIndex,
      message:
        `${objetivo.text} se usa aquí ${contexto}, pero en este punto está en orden de red ` +
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
  // del fichero, y las propias definiciones — se calculan una vez y son
  // comunes a todas las funciones, igual que la caché de resúmenes.
  const refParams = nonConstRefParamsByFunction(tree.rootNode);
  const funcs = functionDefinitionsByName(tree.rootNode);
  const resumenes = new Map<string, Resumen | "en-curso">();

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const ctx: Ctx = { readBufs: readBufferNames(fn), refParams, funcs, resumenes };

      function walk(n: Parser.SyntaxNode) {
        // 1) el argumento de tamaño, cuando es un nombre suelto. Qué posición
        // ocupa lo dice la MISMA tabla que usa el punto 4, así que las dos
        // comprobaciones no pueden discrepar sobre qué es un tamaño.
        if (n.type === "call_expression") {
          const b = bare(n.childForFieldName("function"));
          const p = b ? PAPELES_DE_ARGUMENTO[b] : undefined;
          if (p) {
            const args = n.childForFieldName("arguments");
            const sizeArg = args?.namedChildren[p.tamano];
            if (sizeArg) flagIfNetwork(fn, ctx, sizeArg, findings, `como tamaño de ${b}()`);
          }
        }
        // 2) cualquier comparación — cubre for/while/do-while/if y comparaciones
        // sueltas. Cada lado se descompone en su cadena aditiva: el límite de un
        // bucle escrito como `i < cap1 + cap2 + 2` es tan sospechoso como
        // `i < cap1`, y antes se perdía por tener una suma en vez de un nombre.
        if (n.type === "binary_expression") {
          const op = n.childForFieldName("operator")?.text;
          if (op && COMPARISON_OPS.includes(op)) {
            for (const lado of ["left", "right"] as const) {
              const nodo = n.childForFieldName(lado);
              if (!nodo) continue;
              for (const operando of operandosAditivos(nodo)) {
                flagIfNetwork(fn, ctx, operando, findings, "en una comparación");
              }
            }
          }
        }
        // 3) offset += X y offset -= X, incluido `offset += longitud + 1`.
        // Cada operando cuenta: si uno está en orden de red, el offset se mueve
        // mal. (Caso real del corpus que el informe de corrección marca como
        // crítico y que antes se perdía por ser una suma y no un nombre.)
        if (n.type === "assignment_expression") {
          const op = n.childForFieldName("operator")?.text;
          const right = n.childForFieldName("right");
          if ((op === "+=" || op === "-=") && right) {
            const contexto =
              op === "+=" ? "para avanzar un offset (+=)" : "para retroceder un offset (-=)";
            for (const operando of operandosAditivos(right)) {
              flagIfNetwork(fn, ctx, operando, findings, contexto);
            }
          }
        }
        // 4) sumas en las posiciones de argumento cuyo papel conocemos:
        //    - en posición de BUFFER, todo lo que se suma a la base es un
        //      desplazamiento: `memcpy(mensaje + 2 + long1, ...)`.
        //    - en posición de TAMAÑO, cada sumando forma parte de la cuenta de
        //      bytes: `sendto(sd, m, long1 + long2 + 4, ...)`.
        //  Las dos formas salieron de entregas reales en las que el estudiante
        //  convierte la longitud para enviarla y luego la reutiliza en la
        //  aritmética del buffer: escribe y envía muy fuera de rango (una
        //  longitud de 10 byteswapeada vale 2560).
        //
        //  El tamaño solo se mira aquí cuando es una SUMA; el caso del
        //  identificador suelto ya lo cubre el punto 1 con esa misma tabla, y así
        //  no se avisa dos veces de lo mismo.
        if (n.type === "call_expression") {
          const papeles = bare(n.childForFieldName("function"));
          const p = papeles ? PAPELES_DE_ARGUMENTO[papeles] : undefined;
          if (p) {
            const args = n.childForFieldName("arguments")?.namedChildren ?? [];
            for (const pos of p.buffer) {
              const arg = args[pos];
              // El primer operando es la base (el propio buffer); lo que se le
              // suma o resta son los desplazamientos. La base se salta POR
              // POSICIÓN, así que da igual su forma: `mensaje`, `buf.data()`,
              // un cast o un campo de struct funcionan igual.
              if (arg) {
                for (const op of operandosAditivos(arg).slice(1)) {
                  flagIfNetwork(fn, ctx, op, findings, "como desplazamiento dentro de un buffer");
                }
              }
            }
            const argTam = args[p.tamano];
            if (argTam) {
              const operandos = operandosAditivos(argTam);
              if (operandos.length > 1) {
                for (const op of operandos) {
                  flagIfNetwork(fn, ctx, op, findings, `como parte del tamaño de ${papeles}()`);
                }
              }
            }
          }
        }
        // 5) índice de un array: array[X], incluido `mensaje[i - cap - 2]`.
        if (n.type === "subscript_expression") {
          const idxList = n.namedChildren.find((c) => c.type === "subscript_argument_list");
          const idx = idxList?.namedChildren[0];
          if (idx) {
            for (const operando of operandosAditivos(idx)) {
              flagIfNetwork(fn, ctx, operando, findings, "como índice de un array ([X])");
            }
          }
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
