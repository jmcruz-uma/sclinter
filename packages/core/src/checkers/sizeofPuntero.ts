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
function declaredTypeIsPointer(functionNode: Parser.SyntaxNode, name: string): boolean {
  let result = false;
  function walk(n: Parser.SyntaxNode) {
    if (result) return;
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const declNode = n.childForFieldName("declarator");
      if (declNode) {
        let cur: Parser.SyntaxNode | null = declNode;
        let sawPointer = false;
        while (cur && cur.type !== "identifier") {
          if (cur.type === "pointer_declarator") sawPointer = true;
          cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
        }
        if (cur?.text === name && sawPointer) result = true;
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
        if (fn && declaredTypeIsPointer(fn, value.text)) {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              `sizeof(${value.text}) mide el puntero (normalmente 8 bytes), no lo que apunta — ` +
              `${value.text} está declarado como puntero. ¿Querías el tamaño real de lo que hay detrás?`,
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
