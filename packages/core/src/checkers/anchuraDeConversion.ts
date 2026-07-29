import Parser from "web-tree-sitter";
import { declaracionVigente, textoDelTipo } from "./scopeResolution";

// Regla: la conversión de orden de bytes no encaja con la anchura del dato.
// Seis formas, todas silenciosas hoy y todas medidas sobre los cuatro corpus
// (611 ficheros). Las tres primeras destruyen datos, las tres últimas son
// fallos de concepto que hoy funcionan.
//
//   (A) red = htons(red);            // red es uint32_t: htons convierte 2 de
//                                    // sus 4 bytes y los otros dos SE PIERDEN.
//   (B) cabecera = htons(cabecera);  // cabecera es uint8_t: htons devuelve 2
//                                    // bytes y al guardarlos SE TRUNCA. Caso
//                                    // real (Eval3): htons(5)=1280 → cabecera
//                                    // vale 0 y la línea siguiente lee ese 0
//                                    // como longitud del payload.
//   (D1) sin_port = std::byteswap(puerto);  // puerto es int: la PLANTILLA
//                                    // deduce int, intercambia 4 bytes y al
//                                    // guardarlo en un campo de 2 queda 0.
//   (C) tipo = std::byteswap(tipo);  // tipo es de 1 byte: NO HACE NADA.
//   (D2) sin_port = htons(puerto);   // puerto es int: FUNCIONA, pero por el
//                                    // prototipo, no por diseño.
//   (D3) int l = htons(nt);          // el resultado en un int: funciona en
//                                    // little-endian por casualidad.
//
// ---------------------------------------------------------------------------
// EL CRITERIO, Y LAS TRES VECES QUE EL CORPUS LO CORRIGIÓ
// ---------------------------------------------------------------------------
//
// 1er intento: "el tipo del ARGUMENTO no cuadra". Falso positivo inmediato:
//    `uint16_t n = htons(argc)` es correcto y `argc` es int.
// 2º intento: "la anchura del DESTINO no cuadra". Mejor —explicaba por qué
//    `sin_port = htons(puerto)` calla sin excepciones— pero `int l = htons(nt)`
//    con `nt` de 2 bytes no pierde nada, solo ensancha: ese aviso sería falso.
// 3er intento: mirar LAS DOS PUNTAS y avisar solo con pérdida demostrable.
//    Correcto para (A) y (B), pero dejaba fuera el caso más grave de todos.
//
// Lo que faltaba lo señaló el profesor: los tipos SIN anchura declarada. Y ahí
// hay dos cosas distintas que conviene no confundir, comprobadas compilando
// con -Wall -Wextra, que no dice una palabra:
//
//     int puerto = 4950;
//     a.sin_port = std::byteswap(puerto);   →  sin_port = 0      DESTRUCTIVO
//     b.sin_port = htons(puerto);           →  sin_port = 22035  correcto
//
// Es la MISMA asimetría que motivó `byteswap-sobre-valor-sin-tipo`: `htons`
// tiene prototipo `uint16_t htons(uint16_t)` y estrecha el argumento solo;
// `std::byteswap` es una plantilla y deduce. Aquella regla persigue el caso en
// que el tipo NO SE VE (literal desnudo o macro); este es el caso en que el
// tipo se ve perfectamente y es el equivocado, así que no lo cubría.
//
// (D2) y (D3) no rompen nada, y entran igual por decisión del profesor: un
// `htons` sobre un `int` no distingue entre "quería dos bytes" y "quería
// cuatro y me equivoqué de función", así que oculta el desastre conceptual
// aunque suene la flauta. Su mensaje NO puede hablar de pérdida de datos,
// porque no la hay: dice que `int` no tiene un tamaño conocido de antemano y
// que los campos de un protocolo se declaran con enteros de longitud fija.
//
// SOLO SON DE ANCHURA CONOCIDA los `uintN_t`/`intN_t` y `char` (que mide 1 por
// definición). `int`, `short`, `long` y sus variantes sin signo no lo son —
// el estándar solo fija mínimos—, y son justo las que disparan (D1/D2/D3).
//
// Un campo de un struct del sistema (`sin_port`) no se puede resolver: como
// destino no cuenta y se calla. Ante la duda, silencio.
//
// CONTROL: las soluciones oficiales del profesor siguen a CERO. No es
// casualidad — declaran siempre la anchura (`uint16_t puerto = std::stoi(...)`,
// `const uint16_t PUERTO = 4321`, `uint32_t info`, `uint8_t tipo`), que es
// exactamente la doctrina que esta regla defiende.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

/** Tipos cuya anchura está fijada por el propio nombre. `char` entra porque
 * `sizeof(char)` es 1 por definición. */
const ANCHURA_CONOCIDA: Record<string, number> = {
  uint8_t: 1,
  int8_t: 1,
  char: 1,
  signedchar: 1,
  unsignedchar: 1,
  uint16_t: 2,
  int16_t: 2,
  uint32_t: 4,
  int32_t: 4,
  uint64_t: 8,
  int64_t: 8,
};

/** Tipos enteros cuya anchura el estándar no fija (solo pone mínimos). */
const ANCHURA_NO_DECLARADA = new Set([
  "int",
  "signed",
  "signedint",
  "unsigned",
  "unsignedint",
  "short",
  "shortint",
  "unsignedshort",
  "long",
  "longint",
  "unsignedlong",
  "longlong",
  "size_t",
  "ssize_t",
]);

const ANCHURA_DE_LA_CONVERSION: Record<string, number> = {
  htons: 2,
  ntohs: 2,
  htonl: 4,
  ntohl: 4,
};

const CONSEJO = "Para los campos del protocolo usa enteros de longitud fija (uint16_t, uint32_t).";

function pelado(node: Parser.SyntaxNode | null): string {
  return node ? node.text.replace(/\s+/g, "").replace(/^.*::/, "") : "";
}

/** Tipo declarado de `nombre` en el punto `uso`, normalizado. */
function tipoDeclarado(uso: Parser.SyntaxNode, nombre: string): string | null {
  const decl = declaracionVigente(uso, nombre);
  if (!decl) return null;
  return textoDelTipo(decl).replace(/^std::/, "") || null;
}

/** Variable a la que se asigna el resultado: `x = conv(...)` o `T x = conv(...)`.
 * Solo identificadores — un campo de un struct del sistema no se resuelve. */
function destinoDe(llamada: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = llamada;
  while (n?.parent?.type === "parenthesized_expression" || n?.parent?.type === "cast_expression") {
    n = n.parent;
  }
  const p = n?.parent;
  if (p?.type === "assignment_expression" && p.childForFieldName("operator")?.text === "=") {
    const izq = p.childForFieldName("left");
    return izq?.type === "identifier" ? izq : null;
  }
  if (p?.type === "init_declarator") {
    const d = p.childForFieldName("declarator");
    return d?.type === "identifier" ? d : null;
  }
  return null;
}

export function findAnchuraDeConversionIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const avisar = (n: Parser.SyntaxNode, message: string) =>
    findings.push({ startIndex: n.startIndex, endIndex: n.endIndex, message });

  (function recorre(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const fn = pelado(n.childForFieldName("function"));
      const arg = n.childForFieldName("arguments")?.namedChildren[0];
      const esIdent = arg?.type === "identifier";
      const tipoArg = esIdent ? tipoDeclarado(arg, arg.text) : null;
      const anchoArg = tipoArg ? ANCHURA_CONOCIDA[tipoArg] : undefined;

      if (fn === "byteswap" && esIdent && tipoArg) {
        if (anchoArg === 1) {
          // (C) No-op: un byte no tiene orden.
          avisar(
            n,
            `${arg.text} ocupa un solo byte, así que no tiene orden de bytes que cambiar: ` +
              `esta conversión no hace nada. El orden de bytes solo importa en los campos de ` +
              `2 bytes o más.`
          );
        } else if (ANCHURA_NO_DECLARADA.has(tipoArg)) {
          // (D1) La plantilla deduce el tipo: intercambia los 4 bytes de un int.
          avisar(
            n,
            `std::byteswap deduce el tipo de su argumento, y ${arg.text} es ${tipoArg}: ` +
              `intercambia los 4 bytes del entero, no los del campo. Al guardarlo en un campo ` +
              `de 2 bytes el valor se pierde entero (queda 0). ${CONSEJO}`
          );
        }
        for (const h of n.namedChildren) recorre(h);
        return;
      }

      const anchoConv = ANCHURA_DE_LA_CONVERSION[fn];
      if (anchoConv && esIdent && arg) {
        const destino = destinoDe(n);
        const tipoDest = destino ? tipoDeclarado(destino, destino.text) : null;
        const anchoDest = tipoDest ? ANCHURA_CONOCIDA[tipoDest] : undefined;

        if (anchoArg !== undefined && anchoArg > anchoConv) {
          // (A) El argumento se trunca ANTES de convertir.
          avisar(
            n,
            `${arg.text} ocupa ${anchoArg} bytes, pero ${fn}() solo convierte ${anchoConv}: ` +
              `los otros ${anchoArg - anchoConv} se pierden por el camino. Para un campo de ` +
              `${anchoArg} bytes la conversión que toca es la de ${anchoArg} bytes ` +
              `(${anchoConv === 2 ? "htonl/ntohl" : "htons/ntohs"}).`
          );
        } else if (anchoDest !== undefined && anchoDest < anchoConv) {
          // (B) El resultado no cabe en el destino.
          avisar(
            n,
            `${fn}() devuelve ${anchoConv} bytes y ${destino!.text} solo tiene ${anchoDest}, ` +
              `así que el valor se trunca al guardarlo. ` +
              (anchoDest === 1
                ? "Un campo de un byte no necesita conversión de orden de bytes."
                : `Para un campo de ${anchoDest} bytes usa la conversión de ${anchoDest} bytes.`)
          );
        } else if (tipoArg && ANCHURA_NO_DECLARADA.has(tipoArg)) {
          // (D2) Funciona por el prototipo, no por diseño.
          avisar(
            n,
            `${arg.text} es de tipo ${tipoArg}, que no tiene un tamaño conocido de antemano, ` +
              `así que no se ve si la conversión que corresponde es ${fn}() u otra de distinto ` +
              `tamaño. ${CONSEJO}`
          );
        } else if (tipoDest && ANCHURA_NO_DECLARADA.has(tipoDest)) {
          // (D3) El resultado convertido acaba en un entero sin anchura declarada.
          avisar(
            n,
            `el resultado de ${fn}() se guarda en ${destino!.text}, de tipo ${tipoDest}, que no ` +
              `tiene un tamaño conocido de antemano: cuántos de sus bytes son el campo y en qué ` +
              `posición quedan depende de la máquina. ${CONSEJO}`
          );
        }
      }
    }
    for (const hijo of n.namedChildren) recorre(hijo);
  })(tree.rootNode);

  return findings;
}
