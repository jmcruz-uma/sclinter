import Parser from "web-tree-sitter";

// Módulo compartido de rastreo de alias intra-función, usado por
// lecturaConSocketEscucha.ts y pipeExtremosInvertidos.ts.
//
// Deliberadamente conservador: solo sigue copias DIRECTAS de un
// identificador a otro (`int x = riesgo;` o `x = riesgo;`), nunca a
// través de una expresión, cálculo, o llamada a función — eso ya se
// consideró análisis de flujo de datos demasiado ambicioso para esta
// herramienta (ver discusión sobre trazar el descriptor A TRAVÉS de una
// llamada a otra función: eso queda fuera a propósito).

/** A partir de un conjunto de nombres ya considerados "peligrosos", amplía
 * el conjunto con copias directas de identificador a identificador que
 * aparezcan en la función DESPUÉS de `afterIndex`. Iterativo: si x es
 * alias, y luego aparece `y = x;`, y también se añade (encadenado). */
export function ampliarConAlias(
  fn: Parser.SyntaxNode,
  raices: Set<string>,
  afterIndex: number
): Set<string> {
  const resultado = new Set(raices);
  let changed = true;
  while (changed) {
    changed = false;
    function walk(n: Parser.SyntaxNode) {
      if (n.type === "init_declarator") {
        const decl = n.childForFieldName("declarator");
        const value = n.childForFieldName("value");
        if (
          decl?.type === "identifier" &&
          value?.type === "identifier" &&
          resultado.has(value.text) &&
          n.startIndex > afterIndex &&
          !resultado.has(decl.text)
        ) {
          resultado.add(decl.text);
          changed = true;
        }
      }
      if (n.type === "assignment_expression") {
        const left = n.childForFieldName("left");
        const right = n.childForFieldName("right");
        if (
          left?.type === "identifier" &&
          right?.type === "identifier" &&
          resultado.has(right.text) &&
          n.startIndex > afterIndex &&
          !resultado.has(left.text)
        ) {
          resultado.add(left.text);
          changed = true;
        }
      }
      for (const child of n.namedChildren) walk(child);
    }
    walk(fn);
  }
  return resultado;
}

/** Nombres de funciones DEFINIDAS en el fichero (tienen un
 * function_definition), no solo declaradas/prototipadas. Las funciones de
 * biblioteca (close, poll, setsockopt...) nunca tienen definición en el
 * fichero del examen, así que nunca aparecen aquí — es justo lo que
 * permite distinguir "función propia del estudiante" sin necesitar una
 * lista de exclusión de funciones de sistema. */
export function funcionesDefinidasEnFichero(root: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const declNode = n.childForFieldName("declarator");
      if (declNode?.type === "function_declarator") {
        const nameNode = declNode.childForFieldName("declarator");
        if (nameNode?.type === "identifier") names.add(nameNode.text);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return names;
}
