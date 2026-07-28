import Parser from "web-tree-sitter";
import { identificadorBase } from "./memcpyRepeatedDestination";

// Regla: `memcpy` con los argumentos INVERTIDOS al extraer un campo de un
// buffer recibido de la red — `memcpy(almacen.data(), &tam, 2)` en vez de
// `memcpy(&tam, almacen.data(), 2)`. El efecto es doble y silencioso: la
// variable nunca recibe el campo, y los datos que llegaron del otro extremo se
// machacan con lo que hubiera en la variable.
//
// El informe de corrección manual de Evaluacion2 lo marca [crítico] en SIETE
// alumnos (007, 016, 031, 043, 046, 070, 071), once ficheros. Hasta ahora solo
// se cazaba de refilón: `byteswap-uso-local-incorrecto` avisaba en algunas de
// esas líneas hablando del orden de bytes, que no es la causa.
//
// ---------------------------------------------------------------------------
// LAS TRES CONDICIONES, Y POR QUÉ NINGUNA JUZGA INTENCIONES
// ---------------------------------------------------------------------------
//
// El peligro de esta regla es evidente: `memcpy(buffer, &x, n)` es TAMBIÉN la
// forma correcta de construir un mensaje para enviarlo. Lo que distingue al bug
// no es la forma de la llamada, sino el papel del buffer y el de la variable.
//
//  (1) El DESTINO es un buffer que se leyó de la red ANTES de este punto
//      (read/read_n/recv/recvfrom). Sin esto quedan 351 sitios en el corpus:
//      todos los memcpy de construcción de mensajes, que son correctos.
//
//  (2) El DESTINO no se envía DESPUÉS (write/write_n/send/sendto). Reutilizar
//      el buffer recibido para montar la respuesta encima es legítimo y
//      frecuente; si se envía luego, la escritura tenía sentido y se calla.
//      Caso real que lo exige: alumno_026 de Evaluacion1, que lee la
//      suscripción en `buffer` y reutiliza `buffer` para el NOTIFY que envía.
//      OJO: "algún envío posterior", no "el primer envío" — un buffer puede
//      enviarse antes y después (alumno_021 de Evaluacion1 manda una PDU de
//      SUBSCRIBE y luego otra de UNSUBSCRIBE en el mismo buffer).
//
//  (3) Y hay evidencia mecánica de que la variable no está haciendo de origen
//      de datos. DOS formas, y basta una:
//
//      (3a) Es un PARÁMETRO POR REFERENCIA no-const de la función y no se le
//           ha escrito nada antes. Un `espera_evento(int fd, uint16_t &seq)`
//           que copia `seq` HACIA el buffer termina sin cumplir su contrato:
//           el llamante se queda sin el campo. No hay nada que interpretar —
//           un parámetro no tiene inicializador que valorar.
//
//      (3b) La variable se LEE después de este memcpy sin ninguna escritura en
//           medio. Es una disyunción cerrada: o el memcpy iba al revés, o esa
//           lectura está leyendo un valor que el memcpy no ha tocado. Las dos
//           ramas son bug, así que no hace falta saber cuál pensaba el alumno.
//
// La condición (3) se planteó primero como "la variable no se ha escrito
// antes, y un inicializador trivial (`= 0`) no cuenta como escritura". Se
// DESCARTÓ (decisión del profesor, 2026-07-28): un `= 0` puede ser
// perfectamente el valor que se quiere escribir en el buffer, así que esa
// versión acusaba leyendo la intención del alumno. Y resultó innecesaria: los
// seis sitios del corpus que dependían de aquella excepción —los `= 0` de
// alumno_043 y el `tipo` de alumno_007— entran solos por (3b), porque el
// código los vuelve a leer justo después. La prueba no es de dónde vino el
// valor, sino que el programa se comporta como si el memcpy lo hubiera traído.
//
// MEDIDO sobre los tres corpus (519 ficheros): 25 sitios en 11 ficheros, que
// son EXACTAMENTE los once que el informe manual marca como memcpy invertido.
// Cero avisos fuera de esa lista, cero en las soluciones del profesor, cero en
// Evaluacion1 y Evaluacion3 (ahí el patrón no aparece).
//
// LÍMITES ACEPTADOS:
//  - Solo `&identificador` como origen. `&pdu.campo` o `texto.data()` quedan
//    fuera: el corpus no tiene ningún caso del primero, y el segundo (un
//    `std::string` nunca rellenado, alumno_071:133) es otra forma del mismo
//    despiste que se medirá aparte antes de decidir si entra.
//  - Se pierde alguna línea suelta dentro de un fichero que sí se detecta:
//    alumno_043 ej1:148 copia `tipo_PDU`, que ni es parámetro ni se lee
//    después. Sus dos hermanas (150 y 152) sí avisan, en el mismo bloque.
//  - Todo es intra-función, como el resto del catálogo.
//  - La inversión del lado del ENVÍO (`memcpy(&TIPO, mensaje.data(), 1)` sobre
//    un buffer que aún no se ha rellenado, alumno_015 de Evaluacion1) NO entra
//    aquí: la caza `envio-de-buffer-sin-rellenar` por la consecuencia.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const COPY_FUNCS = ["memcpy", "mempcpy"];
const READ_FUNCS = ["read", "read_n", "readn", "recv", "recvfrom"];
const SEND_FUNCS = ["write", "write_n", "send", "sendto"];

/** Nombre de función sin `std::` ni espacios. */
function pelado(node: Parser.SyntaxNode | null): string {
  return node ? node.text.replace(/\s+/g, "").replace(/^.*::/, "") : "";
}

function anota<T>(m: Map<string, T[]>, k: string, v: T) {
  const lista = m.get(k);
  if (lista) lista.push(v);
  else m.set(k, [v]);
}

/** Parámetros por referencia NO const de una función definida.
 * (Comprobado sobre el árbol real: `reference_declarator` no tiene campo
 * `declarator`; su identificador es `namedChildren[0]`.) */
function parametrosPorReferencia(fnDef: Parser.SyntaxNode): Set<string> {
  const nombres = new Set<string>();
  const declarator = fnDef.childForFieldName("declarator");
  const lista =
    declarator?.childForFieldName("parameters") ??
    declarator?.namedChildren.find((c) => c.type === "parameter_list");
  for (const pd of lista?.namedChildren ?? []) {
    if (pd.type !== "parameter_declaration") continue;
    if (/\bconst\b/.test(pd.text)) continue;
    const dec = pd.childForFieldName("declarator");
    if (dec?.type !== "reference_declarator") continue;
    const id = dec.namedChildren[0];
    if (id?.type === "identifier") nombres.add(id.text);
  }
  return nombres;
}

interface Escritura {
  pos: number;
  nodo: Parser.SyntaxNode;
}

export function findMemcpyInvertidoAlExtraerIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  const funciones: Parser.SyntaxNode[] = [];
  (function recoge(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") funciones.push(n);
    for (const c of n.namedChildren) recoge(c);
  })(tree.rootNode);

  for (const fn of funciones) {
    const refParams = parametrosPorReferencia(fn);
    const lecturasDeRed = new Map<string, number[]>();
    const envios = new Map<string, number[]>();
    const escrituras = new Map<string, Escritura[]>();
    const apariciones = new Map<string, number[]>();

    (function recoge(n: Parser.SyntaxNode) {
      if (n.type === "call_expression") {
        const nombre = pelado(n.childForFieldName("function"));
        const args = n.childForFieldName("arguments")?.namedChildren ?? [];
        if (READ_FUNCS.includes(nombre) && args[1]) {
          const b = identificadorBase(args[1]);
          if (b) {
            anota(lecturasDeRed, b, n.startIndex);
            anota(escrituras, b, { pos: n.startIndex, nodo: n });
          }
        }
        if (SEND_FUNCS.includes(nombre) && args[1]) {
          const b = identificadorBase(args[1]);
          if (b) anota(envios, b, n.startIndex);
        }
        if (COPY_FUNCS.includes(nombre) && args[0]) {
          const b = identificadorBase(args[0]);
          if (b) anota(escrituras, b, { pos: n.startIndex, nodo: n });
        }
      }
      if (n.type === "assignment_expression") {
        const b = identificadorBase(n.childForFieldName("left"));
        if (b) anota(escrituras, b, { pos: n.startIndex, nodo: n });
      }
      if (n.type === "init_declarator") {
        const b = identificadorBase(n.childForFieldName("declarator"));
        if (b) anota(escrituras, b, { pos: n.startIndex, nodo: n });
      }
      if (n.type === "update_expression") {
        const arg = n.childForFieldName("argument") ?? n.namedChildren[0];
        const b = arg ? identificadorBase(arg) : null;
        if (b) anota(escrituras, b, { pos: n.startIndex, nodo: n });
      }
      if (n.type === "identifier") anota(apariciones, n.text, n.startIndex);
      for (const c of n.namedChildren) recoge(c);
    })(fn);

    (function busca(n: Parser.SyntaxNode) {
      if (n.type === "call_expression") {
        const nombre = pelado(n.childForFieldName("function"));
        const args = n.childForFieldName("arguments")?.namedChildren ?? [];
        if (COPY_FUNCS.includes(nombre) && args.length >= 2) {
          const origen = args[1];
          // Origen estrictamente `&identificador`: un escalar, no un buffer.
          const idOrigen =
            origen.type === "pointer_expression" ? origen.childForFieldName("argument") : null;
          if (idOrigen?.type === "identifier") {
            const escalar = idOrigen.text;
            const destino = identificadorBase(args[0]);
            if (destino) {
              const inicio = n.startIndex;
              const fin = n.endIndex;

              // (1) el destino se leyó de la red antes de este punto
              const leidoAntes = (lecturasDeRed.get(destino) ?? []).some((p) => p < inicio);
              // (2) y no se envía después
              const enviadoDespues = (envios.get(destino) ?? []).some((p) => p > fin);

              // (3a) parámetro por referencia todavía sin escribir
              const escritoAntes = (escrituras.get(escalar) ?? []).some((e) => e.pos < inicio);
              const esSalidaSinRellenar = refParams.has(escalar) && !escritoAntes;

              // (3b) se lee después sin escritura en medio. Una escritura que
              // CONTIENE esa lectura (`x = byteswap(x)`) no cuenta: lee antes
              // de escribir.
              const posteriores = (apariciones.get(escalar) ?? []).filter((p) => p > fin);
              let seLeeDespues = false;
              if (posteriores.length > 0) {
                const primera = Math.min(...posteriores);
                seLeeDespues = !(escrituras.get(escalar) ?? []).some(
                  (e) =>
                    e.pos > fin &&
                    e.pos < primera &&
                    !(primera >= e.nodo.startIndex && primera <= e.nodo.endIndex)
                );
              }

              if (leidoAntes && !enviadoDespues && (esSalidaSinRellenar || seLeeDespues)) {
                const porQue = esSalidaSinRellenar
                  ? `${escalar} es un parámetro por referencia que esta función tenía que rellenar, ` +
                    `y al volver se queda sin su campo`
                  : `${escalar} se usa justo después como si este memcpy la hubiera rellenado`;
                findings.push({
                  startIndex: inicio,
                  endIndex: fin,
                  message:
                    `Los argumentos de este memcpy parecen invertidos: el destino es ${destino}, ` +
                    `el buffer que se acaba de leer de la red, y el origen es ${escalar}. ` +
                    `Así se escribe ${escalar} ENCIMA de los datos recibidos, que se pierden; ` +
                    `además, ${porQue}. Para extraer el campo hay que copiar en el otro sentido: ` +
                    `${escalar} de destino y ${destino} de origen.`,
                });
              }
            }
          }
        }
      }
      for (const c of n.namedChildren) busca(c);
    })(fn);
  }

  return findings;
}
