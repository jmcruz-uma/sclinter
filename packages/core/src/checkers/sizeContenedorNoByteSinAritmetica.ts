import Parser from "web-tree-sitter";
import { ES_COMPLETA } from "./funcionesDeES";

// Regla: contenedor.size() a pelo (sin ninguna aritmética alrededor)
// como tercer argumento de memcpy o de las ocho funciones de E/S, donde
// `contenedor` es std::array<T,N>/std::vector<T> y T NO es un tipo de
// 1 byte (std::byte, char, unsigned char, signed char, uint8_t, int8_t,
// char8_t, y los spellings BSD/GNU u_int8_t y u_char). .size() da el
// número de ELEMENTOS, no de bytes — si cada elemento ocupa más de 1
// byte, se envían/leen menos bytes de los necesarios.
//
// "A pelo" es literal: si el argumento es contenedor.size() envuelto en
// cualquier operación (contenedor.size() * sizeof(T), + 1, lo que sea),
// NO se avisa — a propósito. En cuanto hay aritmética de por medio, ya
// no se puede asumir que el estudiante confundió elementos con bytes;
// podría estar corrigiendo el propio problema que esta regla busca.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const FUNCS = ["memcpy", ...ES_COMPLETA];
const ONE_BYTE_TYPES = new Set([
  "std::byte", "byte",
  "char", "unsignedchar", "signedchar",
  "uint8_t", "int8_t", "char8_t",
  // spellings BSD/GNU, también de 1 byte (sys/types.h)
  "u_int8_t", "u_char",
]);

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Tipo de elemento de un `std::array<T,N>` / `std::vector<T>`, resuelto
 * SOBRE EL ÁRBOL: el tipo es un `template_type` cuyo `arguments` es un
 * `template_argument_list` cuyo PRIMER hijo con nombre es el `type_descriptor`
 * del elemento; lo que venga detrás (el tamaño) da igual y no se mira.
 *
 * Antes esto se sacaba con una expresión regular sobre el texto del tipo, con
 * el tamaño escrito como `,\s*\d+` — es decir, SOLO un literal decimal. Con
 * cualquier otra forma de tamaño (`sizeof(...)`, una constante con nombre,
 * aritmética) el grupo opcional no casaba, el `.+?` perezoso se tragaba la
 * coma y el "tipo de elemento" salía como `char,sizeof(argv[3])` — que no
 * está en ONE_BYTE_TYPES, así que la regla avisaba sobre contenedores de
 * `char`, justo los que nunca debe marcar. Falso positivo real del corpus.
 * Es la misma lección que en `memcpy-destino-repetido`: para leer la
 * estructura del código, el árbol; la regex es para texto. */
function tipoDeElemento(typeNode: Parser.SyntaxNode): string | null {
  // `std::array<...>` llega como qualified_identifier que envuelve al
  // template_type; `array<...>` a secas (tras `using namespace std`) llega
  // como template_type directamente.
  let plantilla: Parser.SyntaxNode | null = typeNode;
  if (plantilla.type === "qualified_identifier") {
    plantilla = plantilla.childForFieldName("name");
  }
  if (plantilla?.type !== "template_type") return null;

  const nombre = plantilla.childForFieldName("name")?.text;
  if (nombre !== "array" && nombre !== "vector") return null;

  const args = plantilla.childForFieldName("arguments");
  const primero = args?.namedChildren[0];
  if (primero?.type !== "type_descriptor") return null;
  return primero.text.replace(/\s+/g, "");
}

/** Nombre -> tipo de elemento (normalizado) para std::array<T,N>/std::vector<T> declarados en la función. */
function containerElementTypes(functionNode: Parser.SyntaxNode): Map<string, string> {
  const result = new Map<string, string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration" || n.type === "parameter_declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode) {
        const elemento = tipoDeElemento(typeNode);
        if (elemento) {
          let cur: Parser.SyntaxNode | null = declNode;
          while (cur && cur.type !== "identifier") {
            cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
          }
          if (cur) result.set(cur.text, elemento);
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return result;
}

export function findSizeContenedorNoByteSinAritmeticaIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const elementTypes = containerElementTypes(fn);
      if (elementTypes.size > 0) {
        function walk(n: Parser.SyntaxNode) {
          if (n.type === "call_expression") {
            const func = n.childForFieldName("function");
            const bare = func?.text.replace(/^.*::/, "");
            if (func && bare && FUNCS.includes(bare)) {
              const args = n.childForFieldName("arguments");
              const sizeArg = args?.namedChildren[2];
              if (sizeArg?.type === "call_expression") {
                const sizeFunc = sizeArg.childForFieldName("function");
                if (sizeFunc?.type === "field_expression") {
                  const obj = sizeFunc.childForFieldName("argument");
                  const field = sizeFunc.childForFieldName("field");
                  if (field?.text === "size" && obj?.type === "identifier") {
                    const elemType = elementTypes.get(obj.text);
                    if (elemType && !ONE_BYTE_TYPES.has(elemType)) {
                      findings.push({
                        startIndex: sizeArg.startIndex,
                        endIndex: sizeArg.endIndex,
                        message:
                          `${obj.text}.size() da el número de ELEMENTOS (tipo ${elemType}, no de 1 byte), ` +
                          `no el número de bytes. En ${bare}() aquí hace falta la cuenta de bytes.`,
                      });
                    }
                  }
                }
              }
            }
          }
          for (const child of n.namedChildren) walk(child);
        }
        walk(fn);
      }
    }
    for (const child of fn.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
