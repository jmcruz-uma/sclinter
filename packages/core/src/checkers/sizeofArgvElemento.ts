import Parser from "web-tree-sitter";

// Regla: sizeof(argv[N]) siempre da el tamaño de un puntero (8 bytes en
// x86-64) porque argv es char**/char*[], así que argv[N] es char* — sin
// importar la longitud real de la cadena a la que apunta. Se necesita
// strlen(argv[N]) para eso. A diferencia de otras reglas del catálogo
// no depende de rastrear tipos declarados: argv siempre es char**, por
// definición de main(), así que no hace falta comprobar nada más.
//
// SOBRE EL MENSAJE: el patrón aparece en dos contextos, y el mensaje tiene
// que servir para los dos. Además de usarse como tamaño o como valor
// (`sendto(sd, argv[3], sizeof(argv[3]), ...)`), en las entregas aparece como
// DIMENSIÓN de un array (`std::array<char, sizeof(argv[3])> dominio;`). Por
// eso el mensaje no ordena "usa strlen aquí" —que en la dimensión ni siquiera
// compilaría, porque strlen no es una expresión constante— sino que dice de
// dónde sale la longitud y por qué no se conoce al compilar. Se valoró partir
// el mensaje en dos según el contexto y se decidió que no hacía falta.

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
              `longitud de la cadena. La longitud de un argumento no se conoce hasta que el programa ` +
              `se ejecuta; para obtenerla hace falta strlen(${value.text}).`,
          });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
