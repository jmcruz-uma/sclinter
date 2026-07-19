import Parser from "web-tree-sitter";

// Regla: se asigna un valor a un campo `sin_port` (de sockaddr_in) sin que
// ese valor pase por htons(...) en ningún punto de la expresión. Cubre
// tanto asignación directa (`direccion.sin_port = puerto;`) como
// inicialización con designador (`{ .sin_port = puerto }`).
//
// AVISO DELIBERADO SIN PISTA CONCEPTUAL: el mensaje NO debe mencionar
// "htons", "orden de bytes de red", "big endian" ni nada que revele el
// concepto que se está evaluando — es justo el contenido que el examen
// quiere comprobar que el estudiante sabe aplicar por sí mismo. El aviso
// solo dice "esto no parece correcto", igual que un compañero que te
// dice "revisa esa línea" sin decirte el qué.
//
// Se acepta std::byteswap(...) como alternativa a htons(...): C++23,
// intercambia los bytes incondicionalmente. En una máquina little-endian
// (el caso normal en x86-64, que es donde corre esto) da el mismo
// resultado que htons() para un uint16_t. Matiz para quien lea esto:
// a diferencia de htons(), std::byteswap NO es condicional al endianness
// del host — en una hipotética máquina big-endian haría el intercambio
// igualmente y el resultado sería incorrecto. Se acepta aquí porque es
// la máquina real del curso, no una garantía de portabilidad universal.
//
// No distingue "falta la conversión" de "está puesta al revés" (ntohs en
// vez de htons) — ambos casos generan el mismo mensaje neutro, a propósito.
//
// EXCEPCIÓN (caso real encontrado probando la extensión): un patrón
// válido es comprobar el endianness en tiempo de ejecución y convertir
// solo cuando hace falta:
//   if (std::endian::native == std::endian::little) {
//     dir.sin_port = std::byteswap(puerto);
//   } else {
//     dir.sin_port = puerto;      // correcto: ya está en big-endian
//   }
// La rama sin conversión NO es un olvido aquí — es exactamente lo
// correcto cuando la máquina ya está en orden de red. Antes de marcar
// una asignación sin conversión, se comprueba si está dentro de una
// rama de un if/else cuya CONDICIÓN mencione "endian", y si la rama
// HERMANA convierte el mismo campo — si es así, no se avisa en ninguna
// de las dos ramas.
//
// CORRECCIÓN (caso real de otro profesor del equipo): "la condición
// menciona endian" fallaba si el estudiante factoriza la comprobación
// en una constante con nombre propio, en vez de escribirla en línea:
//   const bool ISLITTLE = (std::endian::native == std::endian::little);
//   ...
//   if (ISLITTLE) dir.sin_port = std::byteswap(puerto);
// El texto de la condición aquí es solo "ISLITTLE", sin la palabra
// "endian" en ningún sitio. Corregido: si la condición es un identificador
// suelto, se busca su declaración en CUALQUIER punto del fichero (no solo
// dentro de la función — puede ser una constante global) y se mira si el
// inicializador menciona "endian".

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const ASSIGN_QUERY = `
(assignment_expression
  left: (field_expression field: (field_identifier) @field)
  right: (_) @value) @assign
`;

const INIT_QUERY = `
(initializer_pair
  designator: (field_designator (field_identifier) @field)
  value: (_) @value) @pair
`;

/** ¿Contiene esta expresión, en cualquier punto de su subárbol, una llamada a alguno de estos nombres? */
function containsCallTo(node: Parser.SyntaxNode, names: string[]): boolean {
  if (node.type === "call_expression") {
    const func = node.childForFieldName("function");
    if (func) {
      const bare = func.text.replace(/^.*::/, "");
      if (names.includes(bare)) return true;
    }
  }
  for (const child of node.namedChildren) {
    if (containsCallTo(child, names)) return true;
  }
  return false;
}

/** ¿Contiene este subárbol una asignación a `field` cuyo valor SÍ pasa por htons/byteswap? */
function subtreeHasConvertedFieldAssignment(root: Parser.SyntaxNode, field: string): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (
        left?.type === "field_expression" &&
        left.childForFieldName("field")?.text === field &&
        right &&
        containsCallTo(right, ["htons", "byteswap"])
      ) {
        found = true;
        return;
      }
    }
    if (n.type === "initializer_pair") {
      const designator = n.childForFieldName("designator");
      const value = n.childForFieldName("value");
      const fieldIdent = designator?.namedChildren.find((c) => c.type === "field_identifier");
      if (fieldIdent?.text === field && value && containsCallTo(value, ["htons", "byteswap"])) {
        found = true;
        return;
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return found;
}

/** Si `node` cuelga de una rama de un if_statement cuya condición menciona
 * "endian" y la rama HERMANA convierte `field`, devuelve true (excepción
 * de endianness en tiempo de ejecución — no avisar). */
function translationUnit(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let n = node;
  while (n.parent) n = n.parent;
  return n;
}

/** ¿Hay, en cualquier punto de `root`, una declaración de `name` con
 * inicializador cuyo texto mencione "endian"? Cubre constantes con
 * nombre propio (`const bool ISLITTLE = (std::endian::native == ...);`),
 * en vez de la comparación escrita directamente dentro del `if`. */
function declaracionInicializadaConEndian(root: Parser.SyntaxNode, name: string): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "init_declarator") {
      const decl = n.childForFieldName("declarator");
      const value = n.childForFieldName("value");
      if (decl?.type === "identifier" && decl.text === name && value && /endian/i.test(value.text)) {
        found = true;
        return;
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return found;
}

/** ¿La condición de un if menciona "endian", directamente o a través de
 * una constante con nombre propio declarada en cualquier parte del
 * fichero (p.ej. `if (ISLITTLE)` donde `ISLITTLE` se declaró con un
 * inicializador que compara std::endian::native)? */
function condicionMencionaEndian(condition: Parser.SyntaxNode): boolean {
  if (/endian/i.test(condition.text)) return true;
  const inner = condition.namedChildren[0] ?? condition;
  if (inner.type === "identifier") {
    return declaracionInicializadaConEndian(translationUnit(condition), inner.text);
  }
  return false;
}

function protegidoPorRamaDeEndianness(node: Parser.SyntaxNode, field: string): boolean {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    const parent: Parser.SyntaxNode | null = n.parent;
    if (parent?.type === "if_statement") {
      const condition = parent.childForFieldName("condition");
      if (condition && condicionMencionaEndian(condition)) {
        const consequence = parent.childForFieldName("consequence");
        const alternative = parent.childForFieldName("alternative");
        const estaEnConsecuencia =
          consequence && n.startIndex === consequence.startIndex && n.endIndex === consequence.endIndex;
        const ramaHermana = estaEnConsecuencia ? alternative : consequence;
        // "alternative" es un else_clause que envuelve el cuerpo real.
        const cuerpoHermano =
          ramaHermana?.type === "else_clause" ? ramaHermana.namedChildren[0] : ramaHermana;
        if (cuerpoHermano && subtreeHasConvertedFieldAssignment(cuerpoHermano, field)) {
          return true;
        }
      }
    }
    n = parent;
  }
  return false;
}

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** ¿Hay, en la misma función y en una posición POSTERIOR a `node`, un
 * if_statement cuya condición mencione "endian" y cuyo cuerpo (cualquiera
 * de sus ramas) convierta `field`? Cubre el patrón "valor por defecto,
 * luego se sobreescribe solo si hace falta":
 *   dir.sin_port = puerto;                         // por defecto
 *   if (std::endian::native == std::endian::little)
 *     dir.sin_port = std::byteswap(puerto);         // solo si hace falta
 * La asignación sin convertir de antes es correcta a propósito — es el
 * valor adecuado para una máquina big-endian, y el if solo actúa cuando
 * no lo es. Si el if apareciera ANTES en vez de después, no protege
 * (sería indicio real de que la conversión se sobreescribe con el valor
 * crudo después, que sí sería un bug). */
function protegidoPorIfPosteriorDeEndianness(node: Parser.SyntaxNode, field: string): boolean {
  const fn = enclosingFunction(node);
  if (!fn) return false;

  let protegido = false;
  function walk(n: Parser.SyntaxNode) {
    if (protegido) return;
    if (n.type === "if_statement" && n.startIndex > node.startIndex) {
      const condition = n.childForFieldName("condition");
      if (condition && condicionMencionaEndian(condition)) {
        if (subtreeHasConvertedFieldAssignment(n, field)) {
          protegido = true;
          return;
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);
  return protegido;
}

const MENSAJE = "El valor asignado a sin_port no parece correcto. Revísalo antes de entregar.";

export function findSinPortNoHtonsIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  const assignQuery = language.query(ASSIGN_QUERY);
  for (const match of assignQuery.matches(tree.rootNode)) {
    const field = match.captures.find((c) => c.name === "field")?.node;
    const value = match.captures.find((c) => c.name === "value")?.node;
    const assign = match.captures.find((c) => c.name === "assign")?.node;
    if (!field || !value || !assign) continue;
    if (field.text !== "sin_port") continue;
    if (containsCallTo(value, ["htons", "byteswap"])) continue;
    if (protegidoPorRamaDeEndianness(assign, "sin_port")) continue;
    if (protegidoPorIfPosteriorDeEndianness(assign, "sin_port")) continue;

    findings.push({ startIndex: assign.startIndex, endIndex: assign.endIndex, message: MENSAJE });
  }

  const initQuery = language.query(INIT_QUERY);
  for (const match of initQuery.matches(tree.rootNode)) {
    const field = match.captures.find((c) => c.name === "field")?.node;
    const value = match.captures.find((c) => c.name === "value")?.node;
    const pair = match.captures.find((c) => c.name === "pair")?.node;
    if (!field || !value || !pair) continue;
    if (field.text !== "sin_port") continue;
    if (containsCallTo(value, ["htons", "byteswap"])) continue;
    if (protegidoPorRamaDeEndianness(pair, "sin_port")) continue;
    if (protegidoPorIfPosteriorDeEndianness(pair, "sin_port")) continue;

    findings.push({ startIndex: pair.startIndex, endIndex: pair.endIndex, message: MENSAJE });
  }

  return findings;
}
