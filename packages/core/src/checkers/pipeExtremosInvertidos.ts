import Parser from "web-tree-sitter";
import { ampliarConAlias } from "./aliasTracking";

// Regla: en pipe(fd), fd[0] es el extremo de LECTURA y fd[1] el de
// ESCRITURA (convención POSIX fija, no depende del ejercicio). Escribir
// en fd[0] o leer de fd[1] es el extremo equivocado — cubre
// read/read_n/recv como lectura y write/write_n/send como escritura.
//
// El nombre del array se lee del propio argumento de pipe(...), igual
// que en pipeUsoAntesDeCrear — no hace falta saber cómo se declaró.
// A diferencia de esa regla, aquí NO importa el orden respecto a
// pipe(): esto es un error de qué extremo, no de cuándo.
//
// AMPLIACIÓN (alias intra-función): si el estudiante extrae un extremo a
// una variable con nombre propio antes de usarlo mal
// (`int fd_lectura = mi_pipe[0]; write(fd_lectura, ...);` — patrón muy
// habitual, más legible que escribir mi_pipe[0] en cada sitio), ahora se
// detecta también. Se rastrea cada extremo (0 y 1) por separado: un
// alias de fd[0] es "extremo de lectura", un alias de fd[1] es "extremo
// de escritura", y se amplían con copias directas de identificador a
// identificador a partir de ahí (mismo mecanismo que en
// entrada-salida-con-socket-escucha).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

/** Nombre del array de pipe a partir del primer argumento de pipe(...).
 * Cubre `pipe(fd)` (C-array, el argumento es el identificador) y
 * `pipe(fd_pipe.data())` (std::array<int,2>, el argumento es `arr.data()`
 * — muy habitual en el plan nuevo). En ambos casos, lo que sigue en el
 * fichero es `fd_pipe[0]` / `fd_pipe[1]`, que subscriptLiteral ya
 * reconoce igual sea C-array o std::array. */
function pipeArrayNameFromArg(arg: Parser.SyntaxNode | null | undefined): string | null {
  if (!arg) return null;
  if (arg.type === "identifier") return arg.text;
  if (arg.type === "call_expression") {
    const func = arg.childForFieldName("function");
    if (func?.type === "field_expression" && func.childForFieldName("field")?.text === "data") {
      const obj = func.childForFieldName("argument");
      if (obj?.type === "identifier") return obj.text;
    }
  }
  return null;
}

function findPipeArrayNames(root: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func && /(^|::)pipe$/.test(func.text)) {
        const args = n.childForFieldName("arguments");
        const name = pipeArrayNameFromArg(args?.namedChildren[0]);
        if (name) names.add(name);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return names;
}

/** Si `node` es ARRAY[N] con N literal, devuelve {name, index}; si no, null. */
function subscriptLiteral(node: Parser.SyntaxNode): { name: string; index: number } | null {
  if (node.type !== "subscript_expression") return null;
  const arg = node.childForFieldName("argument");
  if (arg?.type !== "identifier") return null;
  const idxList = node.namedChildren.find((c) => c.type === "subscript_argument_list");
  const idxNode = idxList?.namedChildren[0];
  if (idxNode?.type !== "number_literal") return null;
  const index = parseInt(idxNode.text, 10);
  if (Number.isNaN(index)) return null;
  return { name: arg.text, index };
}

/** Alias directos (`int x = pipeArray[N];` o `x = pipeArray[N];`) de un
 * extremo concreto (N = 0 o 1) de alguno de los arrays de pipe(). */
function aliasDeExtremos(
  fn: Parser.SyntaxNode,
  pipeArrays: Set<string>
): Map<string, { pipeName: string; index: number }> {
  const raicesPorExtremo = new Map<string, { pipeName: string; index: number; posicion: number }>();

  function walk(n: Parser.SyntaxNode) {
    let decl: Parser.SyntaxNode | null = null;
    let value: Parser.SyntaxNode | null = null;
    if (n.type === "init_declarator") {
      decl = n.childForFieldName("declarator");
      value = n.childForFieldName("value");
    } else if (n.type === "assignment_expression") {
      decl = n.childForFieldName("left");
      value = n.childForFieldName("right");
    }
    if (decl?.type === "identifier" && value) {
      const sub = subscriptLiteral(value);
      if (sub && pipeArrays.has(sub.name) && (sub.index === 0 || sub.index === 1)) {
        raicesPorExtremo.set(decl.text, { pipeName: sub.name, index: sub.index, posicion: n.startIndex });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(fn);

  // Amplía cada raíz con sus propios alias encadenados, y aplana el
  // resultado a un único mapa nombre -> {pipeName, index}.
  const resultado = new Map<string, { pipeName: string; index: number }>();
  for (const [raiz, info] of raicesPorExtremo) {
    const ampliado = ampliarConAlias(fn, new Set([raiz]), info.posicion);
    for (const nombre of ampliado) resultado.set(nombre, { pipeName: info.pipeName, index: info.index });
  }
  return resultado;
}

const WRITE_FUNCS = ["write", "write_n", "send"];
const READ_FUNCS = ["read", "read_n", "recv"];

export function findPipeExtremosInvertidosIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const pipeArrays = findPipeArrayNames(tree.rootNode);
  if (pipeArrays.size === 0) return findings;

  function walkFunctions(fn: Parser.SyntaxNode) {
    if (fn.type === "function_definition") {
      const alias = aliasDeExtremos(fn, pipeArrays);

      function walk(n: Parser.SyntaxNode) {
        if (n.type === "call_expression") {
          const func = n.childForFieldName("function");
          const bare = func?.text.replace(/^.*::/, "");
          if (func && bare) {
            const args = n.childForFieldName("arguments");
            const first = args?.namedChildren[0];

            // Caso 1: literal en línea, mi_pipe[0]/mi_pipe[1].
            const sub = first ? subscriptLiteral(first) : null;
            if (sub && pipeArrays.has(sub.name)) {
              if (WRITE_FUNCS.includes(bare) && sub.index === 0) {
                findings.push({
                  startIndex: first!.startIndex,
                  endIndex: first!.endIndex,
                  message:
                    `${sub.name}[0] es el extremo de LECTURA de la tubería. Para escribir con ${bare}() ` +
                    `se usa ${sub.name}[1].`,
                });
              }
              if (READ_FUNCS.includes(bare) && sub.index === 1) {
                findings.push({
                  startIndex: first!.startIndex,
                  endIndex: first!.endIndex,
                  message:
                    `${sub.name}[1] es el extremo de ESCRITURA de la tubería. Para leer con ${bare}() ` +
                    `se usa ${sub.name}[0].`,
                });
              }
            }

            // Caso 2: alias con nombre propio (fd_lectura, fd_escritura...).
            if (first?.type === "identifier") {
              const info = alias.get(first.text);
              if (info) {
                if (WRITE_FUNCS.includes(bare) && info.index === 0) {
                  findings.push({
                    startIndex: first.startIndex,
                    endIndex: first.endIndex,
                    message:
                      `${first.text} es un alias de ${info.pipeName}[0], el extremo de LECTURA de la ` +
                      `tubería. Para escribir con ${bare}() hace falta el extremo de escritura.`,
                  });
                }
                if (READ_FUNCS.includes(bare) && info.index === 1) {
                  findings.push({
                    startIndex: first.startIndex,
                    endIndex: first.endIndex,
                    message:
                      `${first.text} es un alias de ${info.pipeName}[1], el extremo de ESCRITURA de la ` +
                      `tubería. Para leer con ${bare}() hace falta el extremo de lectura.`,
                  });
                }
              }
            }
          }
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
