import Parser from "web-tree-sitter";

// Regla: se llama a std::byteswap() con un valor cuyo TIPO no está a la
// vista — un literal entero desnudo, o una macro que se expande a uno.
//
// El fondo del asunto es una asimetría entre las dos formas de convertir
// que se usan en la asignatura:
//
//   htons(PORT)          seguro:  el prototipo es uint16_t htons(uint16_t),
//                                 así que el argumento se convierte solo.
//   std::byteswap(PORT)  roto:    es una plantilla, DEDUCE el tipo del
//                                 argumento. Un literal entero es `int`.
//
// Con `#define PORT 54321`, `std::byteswap(PORT)` intercambia los 4 bytes
// de un int (0x0000D431 → 0x31D40000) y al guardarlo en un uint16_t se
// trunca a 0. Comprobado compilando: el puerto acaba siendo 0 y ni
// `-Wall -Wextra` dicen nada. Es un bug perfectamente silencioso.
//
// IMPORTANTE — esta regla NO persigue macros. Persigue "byteswap sobre un
// valor sin tipo visible", y por eso incluye también el literal desnudo
// `std::byteswap(54321)`, que tiene exactamente el mismo bug sin macro
// alguna de por medio. La distinción importa: en la asignatura hay
// profesores que usan macros para tamaños de arrays y similares, y ese uso
// es perfectamente legítimo — nadie escribe `byteswap(TAM)`, y quien lo
// hiciera tendría este mismo bug y querría saberlo.
//
// EXCEPCIÓN: si el cuerpo de la macro deja el tipo a la vista (un cast, un
// `static_cast`, un nombre de tipo entero), no se avisa. Ahí el autor fue
// explícito y la deducción ya no es un accidente. No se comprueba si el
// tipo elegido es el correcto — sería aritmética de suerte; basta con que
// la decisión de tipo esté escrita y no delegada al preprocesador.
//
// Límite conocido: solo se ven las macros definidas con #define en el
// PROPIO fichero. Una macro que venga de una cabecera incluida no aparece
// en el árbol y no se puede clasificar; se calla, coherente con "ante la
// duda, silencio antes que ruido".

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

/** Nombres de macro definidas con #define en este fichero → su cuerpo textual.
 * Sonda del árbol: `#define PORT (htons(54321))` da un `preproc_def` con
 * `name: identifier` y `value: preproc_arg`, y el cuerpo es TEXTO CRUDO
 * (el preprocesador no se ejecuta, así que no hay subárbol que recorrer:
 * sobre `preproc_arg` solo caben comprobaciones de texto). */
export function macrosDelFichero(root: Parser.SyntaxNode): Map<string, string> {
  const macros = new Map<string, string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "preproc_def" || n.type === "preproc_function_def") {
      const name = n.childForFieldName("name");
      const value = n.childForFieldName("value");
      if (name?.type === "identifier") macros.set(name.text, value?.text ?? "");
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return macros;
}

/** ¿El cuerpo de la macro deja el tipo a la vista? Un cast en C
 * (`(uint16_t)54321`), un cast funcional (`uint16_t(54321)`), un
 * `static_cast<...>` o cualquier nombre de tipo entero escrito.
 * OJO: un sufijo de literal (54321u, 54321L) NO cuenta — ningún sufijo
 * produce un tipo de 16 bits, así que el bug seguiría estando. */
const TIPO_A_LA_VISTA =
  /\b(u_?int(8|16|32|64)_t|uint\d+_t|unsigned|signed|short|long|char|size_t|ssize_t)\b|\b(static_cast|reinterpret_cast)\s*</;

function desenvuelveParentesis(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let n = node;
  while (n.type === "parenthesized_expression" && n.namedChildren[0]) n = n.namedChildren[0];
  return n;
}

const CONSEJO =
  "Dale un tipo explícito al valor: una constante con tipo " +
  "(`const uint16_t PUERTO = 54321;`) en vez de una macro, o haz el casting en el propio argumento.";

export function findByteswapSobreValorSinTipoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const macros = macrosDelFichero(tree.rootNode);

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      // Se normaliza el espacio ANTES de recortar el namespace: un estudiante
      // puede escribir `std :: byteswap` (mismo motivo que en sinPortNoHtons).
      const bare = func?.text.replace(/\s+/g, "").replace(/^.*::/, "");
      const args = n.childForFieldName("arguments");
      if (bare === "byteswap" && args && args.namedChildren.length === 1) {
        const arg = desenvuelveParentesis(args.namedChildren[0]);

        if (arg.type === "number_literal") {
          findings.push({
            startIndex: arg.startIndex,
            endIndex: arg.endIndex,
            message:
              `std::byteswap deduce el tipo de su argumento, y un literal entero como ${arg.text} es ` +
              `un int: aquí se intercambian 4 bytes, no 2. Al guardar el resultado en un uint16_t se ` +
              `trunca en silencio (el compilador no avisa). ${CONSEJO}`,
          });
        } else if (arg.type === "identifier" && macros.has(arg.text)) {
          const cuerpo = (macros.get(arg.text) ?? "").trim();
          if (!TIPO_A_LA_VISTA.test(cuerpo)) {
            findings.push({
              startIndex: arg.startIndex,
              endIndex: arg.endIndex,
              message:
                `std::byteswap deduce el tipo de su argumento, y ${arg.text} es una macro sin tipo ` +
                `(#define ${arg.text} ${cuerpo}): el preprocesador la sustituye por un literal, que es un int, ` +
                `así que se intercambian 4 bytes en vez de 2 y el resultado se trunca en silencio ` +
                `(el compilador no avisa). ${CONSEJO}`,
            });
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
