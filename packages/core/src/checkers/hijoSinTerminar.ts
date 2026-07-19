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
// LIMITACIÓN CONOCIDA: heurística de "última sentencia del bloque",
// no un análisis de terminación real. Un `if/else` donde ambas ramas
// terminan pero no es la última sentencia sintáctica, o un `break`
// que saca de un bucle interior sin terminar el proceso, no se
// reconocen como "termina" — pueden darse avisos de más en construcciones
// inusuales.

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

/** ¿Termina este bloque (última sentencia es exit/_exit/return)? */
function endsInTermination(block: Parser.SyntaxNode): boolean {
  let last: Parser.SyntaxNode = block;
  if (block.type === "compound_statement") {
    const stmts = block.namedChildren;
    if (stmts.length === 0) return false;
    last = stmts[stmts.length - 1];
  }
  if (last.type === "return_statement") return true;
  if (last.type === "expression_statement") {
    const expr = last.namedChildren[0];
    if (expr?.type === "call_expression") {
      const func = expr.childForFieldName("function");
      if (func && /(^|::)(exit|_exit)$/.test(func.text)) return true;
    }
  }
  return false;
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
              if (endsInTermination(consequence)) continue;

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
