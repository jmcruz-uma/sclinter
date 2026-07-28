import Parser from "web-tree-sitter";
import { declaracionVigente, textoDelTipo } from "./scopeResolution";

// Regla: memcpy/write_n/read_n/send/sendto/recv/recvfrom/read/write sobre
// &variable, donde `variable` es de un tipo struct/class DEFINIDO EN EL
// FICHERO que tiene algún campo std::string o std::vector. Volcar los
// bytes crudos del struct completo serializa punteros internos al heap,
// no el contenido — mismo problema de fondo que memcpy-direccion-contenedor
// e io-container-direccion, pero ahí solo se detectaba la variable
// std::string/std::vector directa, no un struct propio que la contiene.
//
// Requiere que el struct esté definido en el propio fichero (no puede
// mirar dentro de una struct declarada en una cabecera que no ve).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const FUNCS = ["memcpy", "read", "read_n", "recv", "recvfrom", "write", "write_n", "send", "sendto"];

/** Por qué un struct no se puede volcar entero: porque tiene un contenedor
 * (que guarda un puntero al heap) o porque tiene un PUNTERO CRUDO. El motivo
 * viaja hasta el mensaje, que no puede decir lo mismo en los dos casos. */
type Motivo = "contenedor" | "puntero";

/** Nombres de struct/class definidos en el fichero que NO se pueden enviar
 * enteros, con el motivo. Además de `std::string`/`std::vector`, cuenta un
 * campo puntero crudo (`char* dom;`): enviarlo manda la dirección, que al otro
 * lado no significa nada — es el mismo error, y en un examen se vio escrito de
 * las dos formas. Un campo ARRAY (`char buf[10]`) sí se puede enviar y no
 * cuenta: se distingue por el declarador (`pointer_declarator` frente a
 * `array_declarator`, comprobado sobre el árbol). El contenedor manda cuando
 * hay de los dos, porque su mensaje es el más específico. */
function riskyStructNames(root: Parser.SyntaxNode): Map<string, Motivo> {
  const names = new Map<string, Motivo>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "struct_specifier" || n.type === "class_specifier") {
      const name = n.childForFieldName("name")?.text;
      const body = n.childForFieldName("body");
      if (name && body) {
        let motivo: Motivo | null = null;
        for (const field of body.namedChildren) {
          if (field.type !== "field_declaration") continue;
          const typeText = field.childForFieldName("type")?.text.replace(/\s+/g, "") ?? "";
          if (
            typeText === "std::string" ||
            typeText === "string" ||
            /^(std::)?vector<.+>$/.test(typeText)
          ) {
            motivo = "contenedor";
            break;
          }
          // `char* dom;` y `char *a, *b;` — basta con que alguno de los
          // declaradores del campo sea un puntero.
          if (field.namedChildren.some((c) => c.type === "pointer_declarator")) {
            motivo = "puntero";
          }
        }
        if (motivo) names.set(name, motivo);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return names;
}

/** Tipo de `name` según la declaración VIGENTE en el punto de uso (texto
 * normalizado), o null si no hay ninguna visible. Se resuelve el ámbito
 * (ver checkers/scopeResolution.ts) en vez de quedarse con la primera
 * declaración que aparezca en la función: dos variables distintas pueden
 * compartir nombre si una sombrea a la otra dentro de un bloque. */
function tipoEnEsePunto(useNode: Parser.SyntaxNode, name: string): string | null {
  const decl = declaracionVigente(useNode, name);
  return decl ? textoDelTipo(decl) : null;
}

export function findStructConContenedorDireccionIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const riskyStructs = riskyStructNames(tree.rootNode);
  if (riskyStructs.size === 0) return findings;

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (func && bare && FUNCS.includes(bare)) {
        const args = n.childForFieldName("arguments");
        for (const arg of args?.namedChildren ?? []) {
          if (arg.type !== "pointer_expression") continue;
          const target = arg.childForFieldName("argument");
          if (target?.type !== "identifier") continue;
          const type = tipoEnEsePunto(arg, target.text);
          const motivo = type ? riskyStructs.get(type) : undefined;
          if (type && motivo) {
            findings.push({
              startIndex: arg.startIndex,
              endIndex: arg.endIndex,
              message:
                motivo === "contenedor"
                  ? `&${target.text} es un ${type}, que tiene algún campo std::string/std::vector — ` +
                    `${bare}() volcará los punteros internos de ese campo, no su contenido de texto. ` +
                    `Hay que serializar/deserializar campo a campo, no el struct entero de una vez.`
                  : `&${target.text} es un ${type}, que tiene algún campo puntero — ${bare}() enviará ` +
                    `la dirección que guarda ese puntero, no lo que hay detrás, y esa dirección no ` +
                    `significa nada en el otro extremo. Hay que serializar/deserializar campo a campo, ` +
                    `no el struct entero de una vez.`,
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
