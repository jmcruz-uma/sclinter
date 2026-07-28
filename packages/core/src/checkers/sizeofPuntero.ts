import Parser from "web-tree-sitter";

// Regla: sizeof(X) donde X es un puntero — o bien una expresión &algo
// (siempre puntero, sin excepción en C++), o bien un identificador cuyo
// tipo declarado contiene un `*` en cualquier nivel (char*, void*,
// int**, ...). Da el tamaño del puntero (normalmente 8 bytes en
// x86-64), nunca el tamaño de lo que hay detrás.
//
// SIN restricción de dónde aparece — no solo dentro de memcpy ni de las
// funciones de E/S. Sustituye por completo a memcpy-sizeof-puntero
// (regla original más estrecha, solo miraba parámetros dentro de
// memcpy): esta versión es más general y la cubre entera, así que la
// antigua se retira en vez de mantener las dos en paralelo.
//
// No cubre argv[i] (eso lo hace sizeof-argv-elemento, con su propia
// lógica: argv es char** por definición del lenguaje, no hace falta
// mirar ningún tipo declarado) ni parámetros con sintaxis de array
// (char arr[10]) — sintácticamente se representan como array_declarator,
// no como pointer_declarator, aunque semánticamente decaigan a puntero;
// deliberadamente fuera de alcance por ahora.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** ¿El tipo declarado de `name` en la función contiene un pointer_declarator en algún nivel? */
/** Qué clase de puntero se declaró, para que el mensaje diga la verdad:
 *  - "puntero": `char* p;` — `sizeof` da el tamaño del puntero, 8 bytes.
 *  - "array-de-punteros": `char *cadena[N];` — `sizeof` da N*8, NO 8, y lo que
 *    está mal casi seguro es la declaración, no el `sizeof`.
 *
 * CUIDADO con la distinción, que es la razón de separar los dos casos: como
 * PARÁMETRO, `char *argv[]` decae a `char**` y ahí `sizeof` sí vale 8, así que
 * el segundo mensaje sería falso. Por eso "array-de-punteros" solo se devuelve
 * para declaraciones locales (`declaration`), nunca para
 * `parameter_declaration`. En el corpus `char *argv[]` aparece 314 veces. */
type ClaseDePuntero = "puntero" | "array-de-punteros";

function declaredTypeIsPointer(
  functionNode: Parser.SyntaxNode,
  name: string
): ClaseDePuntero | null {
  let result: ClaseDePuntero | null = null;
  function walk(n: Parser.SyntaxNode) {
    if (result) return;
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const declNode = n.childForFieldName("declarator");
      if (declNode) {
        let cur: Parser.SyntaxNode | null = declNode;
        let sawPointer = false;
        let sawArray = false;
        while (cur && cur.type !== "identifier") {
          if (cur.type === "pointer_declarator") sawPointer = true;
          if (cur.type === "array_declarator") sawArray = true;
          cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
        }
        if (cur?.text === name && sawPointer) {
          result = sawArray && n.type === "declaration" ? "array-de-punteros" : "puntero";
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return result;
}

export function findSizeofPunteroIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "sizeof_expression") {
      let value = n.childForFieldName("value");
      if (value?.type === "parenthesized_expression") value = value.namedChildren[0] ?? value;

      if (value?.type === "pointer_expression") {
        findings.push({
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          message:
            `sizeof(${value.text}) mide el puntero (normalmente 8 bytes), no el objeto al que apunta. ` +
            `¿Querías el tamaño de lo que realmente hay ahí?`,
        });
      } else if (value?.type === "identifier") {
        const fn = enclosingFunction(n);
        const clase = fn ? declaredTypeIsPointer(fn, value.text) : null;
        if (clase === "puntero") {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              `sizeof(${value.text}) mide el puntero (normalmente 8 bytes), no lo que apunta — ` +
              `${value.text} está declarado como puntero. ¿Querías el tamaño real de lo que hay detrás?`,
          });
        } else if (clase === "array-de-punteros") {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              `${value.text} está declarado como un array de punteros (${value.text}[...] con *), ` +
              `no como un buffer de caracteres, así que sizeof(${value.text}) mide todos esos ` +
              `punteros juntos. Si lo que querías es guardar una secuencia de caracteres, la ` +
              `declaración es char ${value.text}[...].`,
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
