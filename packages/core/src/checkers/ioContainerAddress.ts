import Parser from "web-tree-sitter";
import { declaracionVigente, textoDelTipo } from "./scopeResolution";

// Regla: en read/read_n/recv/recvfrom/write/write_n/send/sendto, el
// buffer de datos es SIEMPRE el segundo argumento (posición 1), aunque
// el número total de argumentos varíe según la función. Pasar &variable
// de un std::string o std::vector ahí sobreescribe la representación
// interna del objeto, no su contenido — mismo problema que ya cubre
// memcpy-direccion-contenedor, aplicado ahora a estas ocho funciones.
//
// read_n/write_n son funciones propias del curso (envuelven read/write
// para garantizar N bytes exactos) — no se detectan "gratis" por llamar
// internamente a read/write: hay que reconocerlas explícitamente aquí,
// porque el checker solo mira el código del estudiante, no sigue la
// implementación de las funciones que llama.
//
// std::array queda fuera de esta regla a propósito (mismo motivo que en
// memcpy-direccion-contenedor: &arr == arr.data(), no es un bug) — ver
// ioArrayAddressStyle.ts para la versión de estilo.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const IO_FUNCS = ["read", "read_n", "recv", "recvfrom", "write", "write_n", "send", "sendto"];

/** Si el nombre corresponde, EN ESE PUNTO, a un std::string o a un
 * std::vector, devuelve cuál de los dos; si no, null. Se resuelve la
 * declaración vigente (ver checkers/scopeResolution.ts) en vez de recoger
 * nombres de la función entera: dos variables distintas pueden compartir
 * nombre si una sombrea a la otra dentro de un bloque. */
function contenedorEnEsePunto(
  useNode: Parser.SyntaxNode,
  name: string
): "std::string" | "std::vector" | null {
  const decl = declaracionVigente(useNode, name);
  if (!decl) return null;
  const tipo = textoDelTipo(decl);
  if (tipo === "std::string" || tipo === "string") return "std::string";
  if (/^(std::)?vector<.+>$/.test(tipo)) return "std::vector";
  return null;
}

export function findIoContainerAddressIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (func && bare && IO_FUNCS.includes(bare)) {
        const args = n.childForFieldName("arguments");
        const buf = args?.namedChildren[1];
        if (buf?.type === "pointer_expression") {
          const target = buf.childForFieldName("argument");
          if (target?.type === "identifier") {
            const type = contenedorEnEsePunto(buf, target.text);
            if (type) {
              const consejo =
                type === "std::vector"
                  ? `Usa ${target.text}.data() sobre contenido ya reservado (tras resize()).`
                  : `En esta asignatura, además, usar memcpy o E/S directa sobre .data() de un std::string ` +
                    `también está restringido — usa los métodos propios del contenedor.`;
              findings.push({
                startIndex: buf.startIndex,
                endIndex: buf.endIndex,
                message:
                  `${bare}(..., &${target.text}, ...) sobreescribe/lee la representación interna del ` +
                  `${type}, no su contenido — su contenido vive en otra dirección. ${consejo}`,
              });
            }
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
