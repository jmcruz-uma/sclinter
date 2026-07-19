import Parser from "web-tree-sitter";

// Regla: una variable que NUNCA fue destino de read/read_n/recv/recvfrom
// (es decir, nació en orden de host, no llegó de la red) se usa como
// tamaño de memcpy/read_n/write_n, en un incremento de offset (+=), como
// desplazamiento dentro de un buffer (.data() + X o array[X]), o en
// CUALQUIER comparación (==, !=, <, <=, >, >=) — lo que cubre de una
// sola pasada los límites de for/while/do-while, las condiciones de if,
// y comparaciones sueltas — después de un número IMPAR de conversiones
// con htons/ntohs/htonl/ntohl/std::byteswap.
//
// El razonamiento (validado con el profesor): estas conversiones son
// involuciones — aplicarlas dos veces devuelve el valor original. Por
// eso lo que importa no es qué función se llamó (htons/ntohs son
// funcionalmente idénticas en esta arquitectura, el nombre no es una
// señal fiable) sino CUÁNTAS veces se aplicó una de ellas antes del
// uso: impar = todavía en orden de red, par (incluido cero) = ya está
// en orden de host, listo para uso local.
//
// Las variables que SÍ fueron destino de read/recv se excluyen del todo
// — para ellas, un número impar de conversiones antes de usarlas
// localmente es exactamente lo correcto, no un error.
//
// NOTA DE DISEÑO: la comprobación de comparación general SUSTITUYE a una
// versión anterior que solo miraba explícitamente el límite de un `for`.
// Se comprobó (antes de escribir esta versión) que `for`, `while` e `if`
// envuelven su condición en un nodo `condition_clause`, pero `do-while`
// la envuelve en un `parenthesized_expression` distinto — por eso, en
// vez de tres comprobaciones específicas por tipo de bucle, se busca
// directamente cualquier `binary_expression` de comparación en toda la
// función, que ya cubre los cuatro casos (y las comparaciones sueltas)
// sin tener que conocer el nodo contenedor.
//
// Es un conteo de sentencias de asignación en orden textual, no un
// análisis de flujo de control real (no modela bucles ni ramas) —
// mismo nivel de rigor que zombies-sin-reap/hijo-sin-terminar.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SWAP_FUNCS = ["htons", "ntohs", "htonl", "ntohl", "byteswap"];
const SIZE_FUNCS = ["memcpy", "read_n", "write_n"];
const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="];

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

/** Nombres de variables que en algún punto son destino de read/read_n/recv/recvfrom. */
function receivedVarNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function identOf(node: Parser.SyntaxNode): string | null {
    if (node.type === "identifier") return node.text;
    if (node.type === "pointer_expression") {
      const t = node.childForFieldName("argument");
      return t?.type === "identifier" ? t.text : null;
    }
    if (node.type === "call_expression") {
      const func = node.childForFieldName("function");
      if (func?.type === "field_expression") {
        const obj = func.childForFieldName("argument");
        const field = func.childForFieldName("field");
        if (field?.text === "data" && obj?.type === "identifier") return obj.text;
      }
    }
    return null;
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/^.*::/, "");
      if (bare && ["read", "read_n", "recv", "recvfrom"].includes(bare)) {
        const args = n.childForFieldName("arguments");
        const buf = args?.namedChildren[1];
        const name = buf ? identOf(buf) : null;
        if (name) names.add(name);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return names;
}

/** Número de asignaciones "X = swap(...)" a `name` con posición < beforeIndex. */
function swapCountBefore(functionNode: Parser.SyntaxNode, name: string, beforeIndex: number): number {
  let count = 0;
  function isSwapCall(n: Parser.SyntaxNode | null): boolean {
    if (!n || n.type !== "call_expression") return false;
    const func = n.childForFieldName("function");
    const bare = func?.text.replace(/^.*::/, "");
    return !!bare && SWAP_FUNCS.includes(bare);
  }
  function walk(n: Parser.SyntaxNode) {
    if (n.startIndex >= beforeIndex) return;
    if (n.type === "init_declarator") {
      const decl = n.childForFieldName("declarator");
      const value = n.childForFieldName("value");
      if (decl?.type === "identifier" && decl.text === name && isSwapCall(value ?? null)) count++;
    }
    if (n.type === "assignment_expression") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "identifier" && left.text === name && isSwapCall(right ?? null)) count++;
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return count;
}

function flagIfOdd(
  functionNode: Parser.SyntaxNode,
  received: Set<string>,
  target: Parser.SyntaxNode,
  findings: Finding[],
  contexto: string
) {
  if (target.type !== "identifier") return;
  if (received.has(target.text)) return; // recibido de red: impar es correcto, no se avisa
  const count = swapCountBefore(functionNode, target.text, target.startIndex);
  if (count > 0 && count % 2 === 1) {
    findings.push({
      startIndex: target.startIndex,
      endIndex: target.endIndex,
      message:
        `${target.text} se usa aquí ${contexto}, pero se convirtió con htons/ntohs/htonl/ntohl/` +
        `std::byteswap un número impar de veces (${count}) y nunca vino de read/read_n/recv/recvfrom ` +
        `— todavía está en orden de red, no en orden de host.`,
    });
  }
}

export function findByteswapUsoLocalIncorrectoIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const received = receivedVarNames(fn);

      function walk(n: Parser.SyntaxNode) {
        // 1) tercer argumento de memcpy/read_n/write_n
        if (n.type === "call_expression") {
          const func = n.childForFieldName("function");
          const bare = func?.text.replace(/^.*::/, "");
          if (func && bare && SIZE_FUNCS.includes(bare)) {
            const args = n.childForFieldName("arguments");
            const sizeArg = args?.namedChildren[2];
            if (sizeArg) flagIfOdd(fn, received, sizeArg, findings, `como tamaño de ${bare}()`);
          }
        }
        // 2) cualquier comparación — cubre for/while/do-while/if y comparaciones sueltas
        if (n.type === "binary_expression") {
          const op = n.childForFieldName("operator")?.text;
          if (op && COMPARISON_OPS.includes(op)) {
            const left = n.childForFieldName("left");
            const right = n.childForFieldName("right");
            if (left) flagIfOdd(fn, received, left, findings, "en una comparación");
            if (right) flagIfOdd(fn, received, right, findings, "en una comparación");
          }
        }
        // 3) offset += X
        if (n.type === "assignment_expression") {
          const op = n.childForFieldName("operator")?.text;
          const right = n.childForFieldName("right");
          if (op === "+=" && right) {
            flagIfOdd(fn, received, right, findings, "para avanzar un offset (+=)");
          }
        }
        // 4) desplazamiento dentro de un buffer: array.data() + X, o buffer + X
        // (puntero plano), pero solo cuando la suma se pasa directamente como
        // argumento de una llamada (memcpy/read/write...) — así se evita
        // confundirlo con aritmética normal no relacionada con buffers.
        if (
          n.type === "binary_expression" &&
          n.childForFieldName("operator")?.text === "+" &&
          n.parent?.type === "argument_list"
        ) {
          const left = n.childForFieldName("left");
          const right = n.childForFieldName("right");
          const isDataCall = (node: Parser.SyntaxNode | null) => {
            if (node?.type !== "call_expression") return false;
            const f = node.childForFieldName("function");
            return f?.type === "field_expression" && f.childForFieldName("field")?.text === "data";
          };
          if ((isDataCall(left ?? null) || left?.type === "identifier") && right) {
            flagIfOdd(fn, received, right, findings, "como desplazamiento dentro de un buffer (+)");
          }
        }
        // 5) índice de un array: array[X]
        if (n.type === "subscript_expression") {
          const idxList = n.namedChildren.find((c) => c.type === "subscript_argument_list");
          const idx = idxList?.namedChildren[0];
          if (idx) flagIfOdd(fn, received, idx, findings, "como índice de un array ([X])");
        }
        for (const child of n.namedChildren) walk(child);
      }
      walk(fn);
    }
    for (const child of fn.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
