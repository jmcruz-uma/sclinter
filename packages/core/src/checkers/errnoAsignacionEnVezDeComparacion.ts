import Parser from "web-tree-sitter";

// Regla (nivel 1, mecánico): se ASIGNA a errno (`errno = X`) dentro de una
// condición o de una operación booleana, donde lo que se quería era
// COMPARAR (`errno == X`). Es la regla espejo de
// byteswap-comparacion-en-vez-de-asignacion.
//
// El efecto del bug: la condición no compara nada; toma el valor asignado
// (una constante de error como EINTR es distinta de cero, así que la
// condición es SIEMPRE cierta) y además pisa el errno real. Caso típico:
//   do { r = poll(...); } while((r < 0) && (errno = EINTR));   // bucle infinito
//
// EL CONTEXTO ES LO QUE DELATA EL BUG, NO EL VALOR ASIGNADO. Asignar a
// errno fuera de una condición es perfectamente legítimo y aparece en el
// propio código de referencia de la asignatura:
//   errno = 0;                 // limpiar errno antes de una llamada
//   errno = ETIMEDOUT; return 0;   // señalizar un error desde una función propia
// Por eso NO se mira qué se asigna (un criterio "asigna una constante
// E..." marcaría como error el `errno = ETIMEDOUT` correcto de read_for);
// solo se mira si la asignación ocurre dentro de una guarda o de una
// operación booleana, donde nunca es intencionada.
//
// NOTA SOBRE EL AST (comprobado, no supuesto): las cuatro guardas tienen
// formas distintas — `if`/`while` envuelven la condición en un
// `condition_clause`, `do-while` en un `parenthesized_expression`, y en un
// `for` la condición es directamente la expresión, sin envoltorio. En vez
// de tratar cada caso, se comprueba de forma uniforme si el nodo por el
// que vamos subiendo ES el hijo `condition` de su padre, lo que cubre las
// cuatro de una vez.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

/** ¿Está esta asignación dentro de la guarda de un if/for/while/do-while,
 * o dentro de una operación booleana (&&, ||, !)? */
function enGuardaOBooleana(assign: Parser.SyntaxNode): boolean {
  let n: Parser.SyntaxNode | null = assign;
  while (n) {
    const p: Parser.SyntaxNode | null = n.parent;
    if (!p) return false;

    // (a) operación booleana: `... && (errno = X)`, `... || ...`, `!(...)`
    if (p.type === "binary_expression") {
      const op = p.childForFieldName("operator")?.text;
      if (op === "&&" || op === "||") return true;
    }
    if (p.type === "unary_expression" && p.childForFieldName("operator")?.text === "!") return true;

    // (b) guarda: `n` es exactamente el hijo `condition` de `p`. Cubre
    //     if/while (condition_clause), do-while (parenthesized_expression)
    //     y for (la expresión directamente).
    const cond = p.childForFieldName("condition");
    if (cond && cond.startIndex === n.startIndex && cond.endIndex === n.endIndex) return true;

    // Si salimos al nivel de sentencia, ya no estamos en una condición:
    // `errno = ETIMEDOUT;` suelto es legítimo y no debe marcarse.
    if (p.type === "compound_statement" || p.type === "function_definition") return false;

    n = p;
  }
  return false;
}

export function findErrnoAsignacionEnVezDeComparacionIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "assignment_expression" && n.childForFieldName("operator")?.text === "=") {
      const left = n.childForFieldName("left");
      if (left?.type === "identifier" && left.text === "errno" && enGuardaOBooleana(n)) {
        const right = n.childForFieldName("right")?.text ?? "...";
        findings.push({
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          message:
            `Aquí se ASIGNA a errno (errno = ${right}) dentro de una condición, en vez de compararlo. ` +
            `La condición no comprueba nada: toma el valor asignado (que al ser una constante de error ` +
            `no es cero, así que sale siempre cierta) y además pisa el errno real. ¿Querías errno == ${right}?`,
        });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
