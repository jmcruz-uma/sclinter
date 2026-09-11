import Parser from "web-tree-sitter";

// Regla: dentro de una función se valida `argc` (típicamente
// `if (argc != K) return;` o `if (argc < K) return;`) pero después se
// accede a `argv[N]` con un índice N que esa validación no llega a
// garantizar. Si lo comprobado garantiza como mucho los índices
// 0..M-1, acceder a argv[M] o más allá es memoria fuera de lo
// comprobado.
//
// PASO 0 (previo a todo lo anterior): si para un acceso `argv[N]` con
// N > 0 no hay NINGUNA comprobación que lo gobierne (ver más abajo),
// se distingue entre dos situaciones antes de callar:
//   - la función no menciona `argc` en absoluto ANTES de ese acceso
//     (ni en una comparación ni en cualquier otro uso): es el caso
//     "no se comprobó nada de nada", y aquí SÍ se avisa — es barato de
//     detectar (basta con mirar si el identificador `argc` aparece
//     antes en el cuerpo de la función) y es una categoría de bug
//     distinta y más flagrante que "la comprobación existe pero no
//     llega a cubrir este acceso".
//   - `argc` sí aparece antes (aunque sea en una resta como
//     `argc - 1`, o en una comprobación que no gobierna ESTE acceso
//     concreto): se mantiene el silencio de siempre — ya se decidió
//     explícitamente que "validar mal" en una rama que no es esta no
//     es asunto de esta regla (ver el caso de control
//     `usa_argc_en_resta` en sample43.cpp).
//
// RESTRICCIÓN NECESARIA para el PASO 0 (encontrada auditando el
// corpus, no evidente a priori): solo se aplica si la función que
// contiene el acceso DECLARA `argc` como parámetro propio. Si una
// función auxiliar recibe solo `char** argv` (sin `argc`; ver
// `construido_con_parentesis` en sample51.cpp, que ni siquiera
// pertenece a esta regla), esa función no tiene ningún `argc` que
// pudiera comprobar — la validación, si existe, vive en quien la
// llama, y eso es análisis interprocedural, fuera de alcance (ver
// límite documentado en CLAUDE.md). Sin esta restricción, PASO 0
// dispararía sobre cualquier función auxiliar que recibe argv ya
// validado por su llamante, puro ruido. La detección de "argc como
// parámetro" es sobre el IDENTIFICADOR, sin mirar la forma del
// declarador: `char *argv[]` anida como `array_declarator` y
// `char **argv` como `pointer_declarator` doblado, pero en los dos
// casos el identificador es una hoja alcanzable igual por el mismo
// recorrido (comprobado con ambas formas antes de escribir esto).
//
// CÓMO RAZONA (reescrito tras un falso positivo real — ver más abajo):
// para CADA acceso `argv[N]` se calcula una cota inferior de argc
// GARANTIZADA en ese punto, componiendo dos fuentes:
//
//   1. Guardas de salida temprana anteriores en el mismo bloque (o en
//      un bloque que lo contiene): `if (COND) { ...; return; }` /
//      `... exit(1);`. Tras esa guarda se sabe `!COND` para todo lo que
//      sigue, y de `!COND` se deduce una cota inferior de argc
//      (`!(argc < K)` ⇒ `argc >= K`; `!(argc != K)` ⇒ `argc == K`; …).
//   2. Las condiciones de los `if` que ENVUELVEN el acceso: si el
//      acceso está en la rama `then` de `if (argc >= K)` / `if (argc == K)`,
//      ahí dentro se sabe `argc >= K`; si está en la rama `else`, se
//      sabe la negación.
//
// Se toma el MÁXIMO de todas las cotas aplicables. Si ninguna fuente
// aporta cota (la función no valida argc de ninguna forma que gobierne
// este acceso), NO se avisa: "no validar argc en absoluto" es otro
// problema, fuera del alcance de esta regla, y avisar ahí daba ruido.
//
// FALSO POSITIVO QUE MOTIVÓ LA REESCRITURA (repetido en las 5
// implementaciones de github.com/jmcruz-uma/transport-performance-lab):
//
//     if (argc < 2 || argc > 4) { ...; return EXIT_FAILURE; }
//     const fs::path file_path = argv[1];          // argc >= 2  → OK
//     if (argc >= 3) { port = std::stoi(argv[2]); }   // argc >= 3 → OK
//     if (argc == 4) { threads = std::stoi(argv[3]); } // argc == 4 → OK
//
// La versión anterior tomaba K de la PRIMERA comparación de la función
// (`argc < 2`) de forma aislada y marcaba cualquier `argv[N]` con
// N >= 2, sin mirar ni que la guarda inicial es una disyunción cerrada
// (`argc < 2 || argc > 4` ⇒ argc ∈ [2,4]) ni que cada acceso posterior
// está bajo su propio `if` más estrecho. Ahora sí se componen.
//
// CORRECCIÓN PREVIA que se mantiene: el operador tiene que ser de
// COMPARACIÓN. Una RESTA como `int num = argc - 1;` (número de
// argumentos, nada que ver con validar argc) no aporta ninguna cota y
// no debe hacer saltar la regla.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const ARGV_INDEX_QUERY = `
(subscript_expression
  argument: (identifier) @arr
  (subscript_argument_list (number_literal) @idx)) @sub
`;

// Nombres de función cuya llamada abandona la función actual sin
// remedio: tras `if (COND) { ...; exit(1); }` se sabe `!COND`.
const EXIT_LIKE = new Set(["exit", "_exit", "_Exit", "quick_exit", "abort"]);

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

// `<` ⇄ `>`, `<=` ⇄ `>=`; `==`/`!=` no cambian. Para normalizar
// `K <op> argc` a la forma `argc <op> K`.
function flipOperator(op: string): string {
  switch (op) {
    case "<": return ">";
    case "<=": return ">=";
    case ">": return "<";
    case ">=": return "<=";
    default: return op;
  }
}

function negateOperator(op: string): string {
  switch (op) {
    case "==": return "!=";
    case "!=": return "==";
    case "<": return ">=";
    case "<=": return ">";
    case ">": return "<=";
    case ">=": return "<";
    default: return op;
  }
}

// Cota inferior de argc GARANTIZADA cuando `expr` (si positive) o
// `!expr` (si !positive) se sabe cierto. `null` = no se deduce nada.
function argcLowerBound(
  expr: Parser.SyntaxNode | null,
  positive: boolean
): number | null {
  if (!expr) return null;

  if (expr.type === "parenthesized_expression") {
    return argcLowerBound(expr.namedChildren[0] ?? null, positive);
  }

  if (expr.type === "unary_expression") {
    const op = expr.childForFieldName("operator")?.text;
    if (op === "!") {
      return argcLowerBound(expr.childForFieldName("argument"), !positive);
    }
    return null;
  }

  if (expr.type !== "binary_expression") return null;

  const op = expr.childForFieldName("operator")?.text;
  const left = expr.childForFieldName("left");
  const right = expr.childForFieldName("right");
  if (!op || !left || !right) return null;

  if (op === "&&" || op === "||") {
    const boundLeft = argcLowerBound(left, positive);
    const boundRight = argcLowerBound(right, positive);
    // `&&` positivo, o `||` negado ⇒ se cumplen AMBOS lados: basta con
    // que uno aporte cota; nos quedamos con la mayor.
    // `||` positivo, o `&&` negado ⇒ solo se cumple UNO: hace falta
    // cota por ambos lados, y vale la menor.
    const behavesAsConjunction = (op === "&&") === positive;
    if (behavesAsConjunction) {
      if (boundLeft === null) return boundRight;
      if (boundRight === null) return boundLeft;
      return Math.max(boundLeft, boundRight);
    }
    if (boundLeft === null || boundRight === null) return null;
    return Math.min(boundLeft, boundRight);
  }

  // Comparación: un lado tiene que ser el identificador `argc` y el
  // otro un literal numérico. Sin seguimiento de alias (la versión
  // anterior tampoco lo hacía).
  let cmpOp = op;
  let numText: string | null = null;
  if (left.type === "identifier" && left.text === "argc" && right.type === "number_literal") {
    numText = right.text;
  } else if (right.type === "identifier" && right.text === "argc" && left.type === "number_literal") {
    numText = left.text;
    cmpOp = flipOperator(op);
  } else {
    return null;
  }

  const k = parseInt(numText, 10);
  if (Number.isNaN(k)) return null;

  const effective = positive ? cmpOp : negateOperator(cmpOp);
  switch (effective) {
    case "==": return k;      // argc == K  ⇒ al menos K argumentos
    case ">=": return k;      // argc >= K  ⇒ al menos K
    case ">":  return k + 1;  // argc >  K  ⇒ al menos K+1
    default:   return null;   // <, <=, != no acotan por abajo
  }
}

// ¿Aparece el identificador `argc` en algún punto de `body` ANTES de
// `beforeIndex`? Recorrido simple, sin distinguir cómo se usa —
// cualquier mención cuenta como "esto sí se miró", aunque no sea una
// comparación (ver comentario de cabecera, PASO 0).
function hasArgcReferenceBefore(
  body: Parser.SyntaxNode,
  beforeIndex: number
): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "identifier" && n.text === "argc" && n.startIndex < beforeIndex) {
      found = true;
      return;
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(body);
  return found;
}

// ¿Declara esta función `argc` como parámetro propio? Ver RESTRICCIÓN
// en el comentario de cabecera: sin esto, PASO 0 dispararía sobre
// funciones auxiliares que reciben `argv` ya validado por su llamante
// (interprocedural, fuera de alcance).
function declaresArgcParameter(fn: Parser.SyntaxNode): boolean {
  const params = fn.childForFieldName("declarator")?.childForFieldName("parameters");
  if (!params) return false;
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "identifier" && n.text === "argc") {
      found = true;
      return;
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(params);
  return found;
}

// La condición efectiva de un `if` (desenvuelve `condition_clause`).
function ifCondition(ifStmt: Parser.SyntaxNode): Parser.SyntaxNode | null {
  const cond = ifStmt.childForFieldName("condition");
  if (!cond) return null;
  if (cond.type === "condition_clause") return cond.namedChildren[0] ?? null;
  return cond;
}

// ¿La rama `then` de este `if` abandona la función siempre (return /
// exit / abort), de modo que después se sabe la negación de la
// condición?
function branchAlwaysExits(branch: Parser.SyntaxNode | null): boolean {
  if (!branch) return false;
  const stmtExits = (s: Parser.SyntaxNode): boolean => {
    if (s.type === "return_statement") return true;
    if (s.type === "expression_statement") {
      const call = s.namedChildren[0];
      if (call?.type === "call_expression") {
        const fn = (call.childForFieldName("function")?.text ?? "").replace(/^.*::/, "");
        if (EXIT_LIKE.has(fn)) return true;
      }
    }
    return false;
  };
  if (stmtExits(branch)) return true;
  if (branch.type === "compound_statement") {
    return branch.namedChildren.some(stmtExits);
  }
  return false;
}

export function findArgcArgvMismatchIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const idxQuery = language.query(ARGV_INDEX_QUERY);
  const findings: Finding[] = [];

  for (const match of idxQuery.matches(tree.rootNode)) {
    const arr = match.captures.find((c) => c.name === "arr")?.node;
    const idx = match.captures.find((c) => c.name === "idx")?.node;
    const sub = match.captures.find((c) => c.name === "sub")?.node;
    if (!arr || !idx || !sub) continue;
    if (arr.text !== "argv") continue;

    const fn = enclosingFunction(sub);
    if (!fn) continue;

    const n = parseInt(idx.text, 10);
    if (Number.isNaN(n)) continue;

    // Cota inferior de argc garantizada en el punto del acceso: se van
    // acumulando las cotas de cada guarda/`if` aplicable y al final se
    // toma la mayor.
    const bounds: number[] = [];
    const fold = (b: number | null) => {
      if (b !== null) bounds.push(b);
    };

    let cur: Parser.SyntaxNode | null = sub;
    while (cur && cur.id !== fn.id) {
      const parent: Parser.SyntaxNode | null = cur.parent;
      if (!parent) break;

      if (parent.type === "compound_statement") {
        // Guardas de salida temprana ANTERIORES a `cur` en este bloque.
        for (const sib of parent.namedChildren) {
          if (sib.id === cur.id) break;
          if (sib.type === "if_statement" && branchAlwaysExits(sib.childForFieldName("consequence"))) {
            fold(argcLowerBound(ifCondition(sib), false));
          }
        }
      } else if (parent.type === "if_statement") {
        if (cur.id === parent.childForFieldName("consequence")?.id) {
          fold(argcLowerBound(ifCondition(parent), true)); // rama then
        }
      } else if (parent.type === "else_clause") {
        const ifStmt = parent.parent;
        if (ifStmt?.type === "if_statement") {
          fold(argcLowerBound(ifCondition(ifStmt), false)); // rama else
        }
      }

      cur = parent;
    }

    // Ninguna comprobación de argc gobierna este acceso. PASO 0: si
    // además `argc` no se menciona en ningún punto anterior de la
    // función, no es "una comprobación insuficiente" sino "ninguna
    // comprobación en absoluto" — sí se avisa (salvo argv[0], siempre
    // válido).
    if (bounds.length === 0) {
      const body = fn.childForFieldName("body");
      if (n > 0 && body && declaresArgcParameter(fn) && !hasArgcReferenceBefore(body, sub.startIndex)) {
        findings.push({
          startIndex: sub.startIndex,
          endIndex: sub.endIndex,
          message:
            `Se accede a argv[${n}] sin comprobar que se hayan recibido suficientes ` +
            `argumentos. Para evitar leer memoria fuera de argv, chequea siempre ` +
            `primero el valor de argc.`,
        });
      }
      continue;
    }
    const guaranteed = Math.max(...bounds);

    // `guaranteed` argumentos ⇒ índices válidos 0..guaranteed-1.
    if (n >= guaranteed) {
      findings.push({
        startIndex: sub.startIndex,
        endIndex: sub.endIndex,
        message:
          `Se compara argc contra ${guaranteed} en esta función, lo que como mucho garantiza ` +
          `argv[0]..argv[${guaranteed - 1}]. Aquí se accede a argv[${n}], fuera de lo comprobado.`,
      });
    }
  }

  return findings;
}
