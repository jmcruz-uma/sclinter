import Parser from "web-tree-sitter";

// Regla: memcpy(&variable, ..., n) donde `variable` es un std::string o
// un std::vector. Esto NO escribe en el contenido — sobreescribe la
// representación interna del objeto (punteros a heap, tamaño, capacidad),
// lo cual es comportamiento indefinido casi con toda seguridad.
//
// Comprobado empíricamente (no es una suposición): &variable y
// variable.data() son direcciones DISTINTAS tanto para std::string como
// para std::vector (el contenido vive en heap, el objeto en la pila).
//
// std::array queda deliberadamente FUERA de esta regla: para std::array,
// &variable y variable.data() son la MISMA dirección (no tiene punteros
// ni estado oculto, es literalmente un array de C envuelto), así que
// memcpy(&arr, ...) es el patrón correcto para volcar bytes de tamaño
// fijo, no un bug. Incluirlo aquí generaría falsos positivos sobre
// código válido.

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

/** Nombres declarados como std::string o std::vector<T> dentro de la función, con su tipo. */
function heapBackedVarNames(functionNode: Parser.SyntaxNode): Map<string, string> {
  const names = new Map<string, string>();

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        const typeText = typeNode.text.replace(/\s+/g, "");
        const isString = typeText === "std::string" || typeText === "string";
        const isVector = /^(std::)?vector<.+>$/.test(typeText);
        if (isString || isVector) {
          // El declarator puede ser directamente el identificador, o
          // envolver uno (referencia, puntero...) — bajamos hasta encontrarlo.
          let cur: Parser.SyntaxNode | null = declNode;
          while (cur && cur.type !== "identifier") {
            cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
          }
          if (cur) names.set(cur.text, isString ? "std::string" : "std::vector");
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }

  walk(functionNode);
  return names;
}

export function findMemcpyContainerAddressDestinationIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(MEMCPY_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    // Buscamos el patrón &identificador como destino.
    if (arg0.type !== "pointer_expression") continue;
    const target = arg0.childForFieldName("argument");
    if (!target || target.type !== "identifier") continue;

    const fn = enclosingFunction(callNode);
    if (!fn) continue;

    const vars = heapBackedVarNames(fn);
    const type = vars.get(target.text);
    if (type) {
      const consejo =
        type === "std::vector"
          ? `Usa ${target.text}.data() sobre contenido ya reservado (tras resize()), no la dirección del objeto en sí.`
          : `En esta asignatura, además, escribir con memcpy en un std::string está prohibido incluso vía .data() — usa los métodos propios del contenedor.`;
      findings.push({
        startIndex: arg0.startIndex,
        endIndex: arg0.endIndex,
        message:
          `memcpy sobre &${target.text} sobreescribe la representación interna del ${type}, ` +
          `no su contenido — esto es comportamiento indefinido casi seguro (su contenido vive en ` +
          `otra dirección, no en el propio objeto). ${consejo}`,
      });
    }
  }

  return findings;
}
