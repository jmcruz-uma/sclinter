import Parser from "web-tree-sitter";

// Regla: el fichero llama a fork() en algún punto pero, dentro de la
// misma función, no hay ningún wait()/waitpid() FUERA de la rama del
// hijo, ni un signal(SIGCHLD/SIGCLD, SIG_IGN).
//
// Importante: un wait()/waitpid() dentro de la propia rama del hijo
// (`if (pid == 0) { wait(...); ... }`) NO cuenta como reaping válido —
// el hijo esperando a sus propios hijos (que normalmente no tiene) no
// evita que EL PADRE deje zombis al hijo actual. Se detectó este caso
// como falso negativo real durante el desarrollo y se corrigió: antes
// solo comprobaba presencia en cualquier punto de la función, sin mirar
// en qué rama estaba.

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

function findCalls(root: Parser.SyntaxNode, names: string[]): Parser.SyntaxNode[] {
  const calls: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (bare && names.includes(bare)) calls.push(n);
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return calls;
}

function hasSigchldIgnore(root: Parser.SyntaxNode): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (bare === "signal") {
        const args = n.childForFieldName("arguments");
        const a0 = args?.namedChildren[0];
        const a1 = args?.namedChildren[1];
        if (
          a0?.type === "identifier" && ["SIGCHLD", "SIGCLD"].includes(a0.text) &&
          a1?.type === "identifier" && a1.text === "SIG_IGN"
        ) {
          found = true;
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return found;
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

function isChildCondition(ifStmt: Parser.SyntaxNode, name: string): boolean {
  const clause = ifStmt.childForFieldName("condition");
  const inner = clause?.namedChildren[0];
  if (!inner) return false;
  const text = inner.text.replace(/\s+/g, "");
  return text === `${name}==0` || text === `0==${name}` || text === `!${name}`;
}

/** ¿Está `node` anidado dentro de una rama de hijo (if (pid==0) {...}) para alguno de `forkVars`? */
function isInsideChildBranch(node: Parser.SyntaxNode, forkVars: Set<string>): boolean {
  let n: Parser.SyntaxNode | null = node.parent;
  while (n) {
    if (n.type === "if_statement") {
      const consequence = n.childForFieldName("consequence");
      // ¿node cuelga de la rama "then" (no de un "else")? Los objetos Node
      // de web-tree-sitter no tienen identidad de referencia estable entre
      // distintas llamadas a .parent/childForFieldName (=== puede fallar
      // para "el mismo" nodo sintáctico) — se compara por posición.
      let isInConsequence = false;
      if (consequence) {
        let m: Parser.SyntaxNode | null = node;
        while (m) {
          if (m.startIndex === consequence.startIndex && m.endIndex === consequence.endIndex) {
            isInConsequence = true;
            break;
          }
          if (m.startIndex === n.startIndex && m.endIndex === n.endIndex) break; // llegamos al propio if sin encontrarlo
          m = m.parent;
        }
      }
      if (isInConsequence) {
        for (const name of forkVars) {
          if (isChildCondition(n, name)) return true;
        }
      }
    }
    n = n.parent;
  }
  return false;
}

export function findZombiesSinReapIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const forkCalls = findCalls(tree.rootNode, ["fork"]);

  const byFunction = new Map<number, Parser.SyntaxNode[]>();
  for (const call of forkCalls) {
    const fn = enclosingFunction(call);
    if (!fn) continue;
    const list = byFunction.get(fn.startIndex) ?? [];
    list.push(call);
    byFunction.set(fn.startIndex, list);
  }

  for (const [, calls] of byFunction) {
    const fn = enclosingFunction(calls[0])!;
    const forkVars = forkVarNames(fn);
    const waitCalls = findCalls(fn, ["wait", "waitpid"]);
    const hasWaitFueraDelHijo = waitCalls.some((w) => !isInsideChildBranch(w, forkVars));
    const ignoresSigchld = hasSigchldIgnore(fn);
    if (hasWaitFueraDelHijo || ignoresSigchld) continue;

    for (const forkCall of calls) {
      findings.push({
        startIndex: forkCall.startIndex,
        endIndex: forkCall.endIndex,
        message:
          "No se ve ni wait()/waitpid() ni signal(SIGCHLD, SIG_IGN) en esta función. Sin uno de " +
          "los dos, los procesos hijo terminados se quedan como zombis.",
      });
    }
  }

  return findings;
}
