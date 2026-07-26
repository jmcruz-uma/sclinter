import Parser from "web-tree-sitter";

// Regla: la rama del hijo (`if (pid == 0) { ... }`, `if (!pid)`, etc.,
// donde `pid` viene de fork()) no termina con exit()/_exit()/return como
// última sentencia. Si además ese `if` está anidado dentro de un bucle
// que contiene la propia llamada a fork(), es un error grave: el hijo
// puede volver a la cabecera del bucle y forkar de nuevo (fork bomb /
// jerarquía de procesos completamente descontrolada).
//
// Si el `if` NO está dentro de ese tipo de bucle, se avisa igual pero
// con un mensaje más suave — no termina explícitamente, pero no hay
// evidencia de que vaya a re-forkar.
//
// ANÁLISIS DE TERMINACIÓN (`alwaysExits`): no basta con mirar la última
// sentencia — se comprueba recursivamente si la rama del hijo termina por
// TODOS los caminos. Cuenta como terminación:
//   - exit()/_exit()/return (y lo que venga detrás es código muerto);
//   - un if/else CON else donde todas las ramas terminan (cadenas else-if
//     incluidas);
//   - un bucle infinito sin break que escape: while(1)/while(true),
//     for(;;), do{...}while(1) — el hijo nunca cae por el final.
// Se IGNORAN los comentarios: en tree-sitter son nodos `comment` dentro de
// `namedChildren`, y sin filtrarlos un `exit(0); // ...` tomaba el comentario
// como última sentencia y avisaba de más (falso positivo real del corpus).
// LÍMITE DELIBERADO: un bucle CON condición (while(cond)/for(cond)) se
// considera que puede caer por el final. Es a propósito: si el hijo sirve y
// luego cae al bucle de fork del padre, es justo el fork-bomb que hay que
// cazar. No se modela si la condición es siempre cierta ni la alcanzabilidad
// real de un break.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Nombres asignados desde fork() dentro de la función. */
function forkVarNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function isForkCall(n: Parser.SyntaxNode | null): boolean {
    if (!n || n.type !== "call_expression") return false;
    const func = n.childForFieldName("function");
    return !!func && /(^|::)fork$/.test(func.text);
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "init_declarator") {
      const declarator = n.childForFieldName("declarator");
      const value = n.childForFieldName("value");
      if (declarator?.type === "identifier" && isForkCall(value)) names.add(declarator.text);
    }
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "identifier" && isForkCall(right)) names.add(left.text);
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return names;
}

/** ¿La condición de este if_statement identifica la rama del hijo para `name`? */
function isChildCondition(ifStmt: Parser.SyntaxNode, name: string): boolean {
  const clause = ifStmt.childForFieldName("condition");
  const inner = clause?.namedChildren[0];
  if (!inner) return false;
  const text = inner.text.replace(/\s+/g, "");
  return (
    text === `${name}==0` ||
    text === `0==${name}` ||
    text === `!${name}`
  );
}

/** namedChildren sin los nodos `comment` (tree-sitter los incluye). */
function realChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  return node.namedChildren.filter((c) => c.type !== "comment");
}

/** ¿Es una sentencia de terminación directa (return o exit()/_exit())? */
function isTermination(stmt: Parser.SyntaxNode): boolean {
  if (stmt.type === "return_statement") return true;
  if (stmt.type === "expression_statement") {
    const expr = realChildren(stmt)[0];
    if (expr?.type === "call_expression") {
      const func = expr.childForFieldName("function");
      if (func && /(^|::)(exit|_exit)$/.test(func.text)) return true;
    }
  }
  return false;
}

/** ¿Hay un break que escape de ESTE bucle (no dentro de un bucle/switch
 * anidado, que lo capturaría antes)? */
function hasEscapingBreak(loopBody: Parser.SyntaxNode): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode, depth: number) {
    if (found) return;
    if (n.type === "break_statement" && depth === 0) {
      found = true;
      return;
    }
    const anida = ["while_statement", "for_statement", "do_statement", "for_range_loop", "switch_statement"].includes(
      n.type
    );
    for (const child of n.namedChildren) walk(child, depth + (anida ? 1 : 0));
  }
  walk(loopBody, 0);
  return found;
}

/** ¿Bucle infinito del que el hijo no sale cayendo por el final?
 * while(1)/while(true), for(;;), do{...}while(1), sin break que escape. */
function isInfiniteLoop(stmt: Parser.SyntaxNode): boolean {
  const body = stmt.childForFieldName("body");
  if (!body || hasEscapingBreak(body)) return false;
  const condIsTrue = (): boolean => {
    const cond = stmt.childForFieldName("condition");
    const value = cond?.namedChildren[0];
    const t = value?.text.replace(/\s+/g, "");
    return t === "true" || t === "1";
  };
  if (stmt.type === "while_statement" || stmt.type === "do_statement") return condIsTrue();
  if (stmt.type === "for_statement") return !stmt.childForFieldName("condition"); // for(;;)
  return false;
}

/** ¿Este nodo termina por TODOS los caminos (el hijo no cae por el final)? */
function alwaysExits(node: Parser.SyntaxNode): boolean {
  switch (node.type) {
    case "compound_statement":
      // Si alguna sentencia termina incondicionalmente, lo que sigue es
      // código muerto y el bloque entero termina.
      return realChildren(node).some(alwaysExits);
    case "return_statement":
      return true;
    case "expression_statement":
      return isTermination(node);
    case "if_statement": {
      const consequence = node.childForFieldName("consequence");
      const alternative = node.childForFieldName("alternative");
      if (!consequence || !alternative) return false; // sin else, un camino cae
      const cuerpoElse =
        alternative.type === "else_clause" ? realChildren(alternative)[0] : alternative;
      return !!cuerpoElse && alwaysExits(consequence) && alwaysExits(cuerpoElse);
    }
    case "while_statement":
    case "for_statement":
    case "do_statement":
      return isInfiniteLoop(node);
    default:
      return false;
  }
}

function findAncestorLoops(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const loops: Parser.SyntaxNode[] = [];
  let n: Parser.SyntaxNode | null = node.parent;
  while (n) {
    if (["while_statement", "for_statement", "do_statement"].includes(n.type)) loops.push(n);
    n = n.parent;
  }
  return loops;
}

function containsForkCall(root: Parser.SyntaxNode): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func && /(^|::)fork$/.test(func.text)) found = true;
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return found;
}

export function findHijoSinTerminarIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const forkVars = forkVarNames(n);
      if (forkVars.size > 0) {
        function walkIfs(m: Parser.SyntaxNode) {
          if (m.type === "if_statement") {
            for (const name of forkVars) {
              if (!isChildCondition(m, name)) continue;
              const consequence = m.childForFieldName("consequence");
              if (!consequence) continue;
              if (alwaysExits(consequence)) continue;

              const dangerousLoop = findAncestorLoops(m).some((loop) => containsForkCall(loop));
              findings.push({
                startIndex: m.startIndex,
                endIndex: m.childForFieldName("condition")!.endIndex,
                message: dangerousLoop
                  ? `El hijo (rama donde ${name} es 0) no termina explícitamente y este bloque está ` +
                    `dentro de un bucle que también hace fork() — el hijo puede volver a forkar. Añade ` +
                    `exit()/return al final de la rama del hijo.`
                  : `El hijo (rama donde ${name} es 0) no termina explícitamente con exit()/return al ` +
                    `final. Revisa si eso es intencionado.`,
              });
            }
          }
          for (const child of m.namedChildren) walkIfs(child);
        }
        walkIfs(n);
      }
    }
    for (const child of n.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
