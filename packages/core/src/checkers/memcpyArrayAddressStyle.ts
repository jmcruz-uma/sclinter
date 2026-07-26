import Parser from "web-tree-sitter";
import { declaracionVigente, textoDelTipo } from "./scopeResolution";

// Regla de ESTILO, no de bug: memcpy(&arr, ...) o memcpy(..., &arr, ...)
// donde `arr` es un std::array es código correcto (comprobado: para
// std::array, &arr == arr.data(), no tiene representación interna oculta,
// a diferencia de std::string/std::vector — ver memcpyContainerAddressDestination.ts).
//
// Se marca de todas formas por decisión pedagógica del profesor: un único
// hábito ("siempre .data() sobre un contenedor, nunca &contenedor") que
// generaliza bien a todos los contenedores de la STL, en vez de que el
// estudiante tenga que recordar cuáles son "seguros" con & y cuáles no.
// El mensaje debe dejar claro que es una norma de estilo, NO un error de
// comportamiento indefinido — sería falso decir lo segundo.

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

/** ¿El nombre usado en `useNode` corresponde, EN ESE PUNTO, a un std::array?
 * Se resuelve la declaración vigente (ver checkers/scopeResolution.ts) en vez
 * de recoger nombres de la función entera: dos variables distintas pueden
 * compartir nombre si una sombrea a la otra dentro de un bloque. */
function esArrayEnEsePunto(useNode: Parser.SyntaxNode, name: string): boolean {
  const decl = declaracionVigente(useNode, name);
  if (!decl) return false;
  return /^(std::)?array<.+>$/.test(textoDelTipo(decl));
}

export function findMemcpyArrayAddressStyleIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(MEMCPY_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    const callNode = match.captures.find((c) => c.name === "call")?.node;
    if (!funcNode || !arg0 || !arg1 || !callNode) continue;
    if (!/(^|::)memcpy$/.test(funcNode.text)) continue;

    for (const [argNode, rol] of [
      [arg0, "destino"],
      [arg1, "origen"],
    ] as const) {
      if (argNode.type !== "pointer_expression") continue;
      const target = argNode.childForFieldName("argument");
      if (!target || target.type !== "identifier") continue;
      if (!esArrayEnEsePunto(argNode, target.text)) continue;

      findings.push({
        startIndex: argNode.startIndex,
        endIndex: argNode.endIndex,
        message:
          `[estilo, no error] &${target.text} funciona correctamente aquí como ${rol} — para ` +
          `std::array, &variable y variable.data() son la misma dirección. Aun así, en esta ` +
          `asignatura se usa siempre ${target.text}.data() sobre contenedores, por consistencia ` +
          `con std::string y std::vector (donde & sí sería un error).`,
      });
    }
  }

  return findings;
}
