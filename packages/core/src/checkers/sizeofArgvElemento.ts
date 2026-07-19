import Parser from "web-tree-sitter";

// Regla: sizeof(argv[N]) siempre da el tamaño de un puntero (8 bytes en
// x86-64) porque argv es char**/char*[], así que argv[N] es char* — sin
// importar la longitud real de la cadena a la que apunta. Se necesita
// strlen(argv[N]) para eso. A diferencia de otras reglas del catálogo
// no depende de rastrear tipos declarados: argv siempre es char**, por
// definición de main(), así que no hace falta comprobar nada más.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

export function findSizeofArgvElementoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "sizeof_expression") {
      let value = n.childForFieldName("value");
      if (value?.type === "parenthesized_expression") value = value.namedChildren[0] ?? value;
      if (value?.type === "subscript_expression") {
        const arr = value.childForFieldName("argument");
        if (arr?.type === "identifier" && arr.text === "argv") {
          findings.push({
            startIndex: n.startIndex,
            endIndex: n.endIndex,
            message:
              `sizeof(${value.text}) da el tamaño de un puntero (char*, normalmente 8 bytes), no la ` +
              `longitud de la cadena. Usa strlen(${value.text}) para eso.`,
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
