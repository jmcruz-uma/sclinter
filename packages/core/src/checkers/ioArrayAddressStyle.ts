import Parser from "web-tree-sitter";
import { declaracionVigente, textoDelTipo } from "./scopeResolution";
import { ES_COMPLETA } from "./funcionesDeES";

// Regla de ESTILO (no de bug), hermana de memcpy-array-direccion-estilo
// pero para read/read_n/recv/recvfrom/write/write_n/send/sendto: pasar
// &arr como buffer con un std::array es correcto (&arr == arr.data()),
// pero se marca igual por consistencia de hábito con std::string/vector.
//
// CORRECCIÓN (falso positivo real, alumno_021 Evaluacion2): antes se
// recogían los nombres declarados como std::array en la FUNCIÓN ENTERA y se
// preguntaba solo "¿este nombre está en el conjunto?", sin noción de
// ámbito. Con dos variables distintas del mismo nombre —un
// `std::array<char,10> buffer` de la función y un `char buffer` declarado
// dentro de un if que lo sombrea— se avisaba sobre el `char`, recomendando
// `buffer.data()` sobre algo que no tiene .data(): un consejo que ni
// siquiera compila. Ahora se resuelve la declaración VIGENTE en el punto de
// uso (ver checkers/scopeResolution.ts) y se mira su tipo.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const IO_FUNCS = ES_COMPLETA;

/** ¿El nombre usado en `useNode` corresponde, EN ESE PUNTO, a un std::array? */
function esArrayEnEsePunto(useNode: Parser.SyntaxNode, name: string): boolean {
  const decl = declaracionVigente(useNode, name);
  if (!decl) return false;
  return /^(std::)?array<.+>$/.test(textoDelTipo(decl));
}

export function findIoArrayAddressStyleIssues(
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
            if (esArrayEnEsePunto(buf, target.text)) {
              findings.push({
                startIndex: buf.startIndex,
                endIndex: buf.endIndex,
                message:
                  `[estilo, no error] &${target.text} funciona correctamente aquí — para std::array, ` +
                  `&variable y variable.data() son la misma dirección. Aun así, en esta asignatura se usa ` +
                  `siempre ${target.text}.data(), por consistencia con std::string y std::vector.`,
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
