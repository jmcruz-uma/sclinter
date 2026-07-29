import Parser from "web-tree-sitter";
import { ampliarConAlias, funcionesDefinidasEnFichero } from "./aliasTracking";
import { VARIANTES_READ_N, VARIANTES_WRITE_N } from "./funcionesDeES";

// Regla: usar el socket de ESCUCHA (el que se le pasa a accept()) para
// leer/escribir con el cliente (read/read_n/write/write_n/send/recv), en
// vez del socket que devuelve accept() para esa conexión concreta.
//
// Diseño clave: no hace falta rastrear cómo se creó el socket de escucha
// (con socket(), recibido por parámetro, variable global...) — basta con
// mirar el PROPIO primer argumento de accept(fd, ...): ese `fd` es, por
// definición, el socket de escucha en esa llamada, venga de donde venga.
//
// AMPLIACIÓN 1 (alias intra-función): si el estudiante copia el
// descriptor a otra variable antes de usarlo mal (`int aux = sd; read(aux,
// ...)`), ahora sí se detecta — se amplía el nombre "peligroso" con copias
// directas de identificador a identificador, después del accept().
//
// AMPLIACIÓN 2 (paso a función local, nivel 4 — norma de la asignatura,
// no heurística de riesgo): pasar el socket de escucha (o un alias suyo)
// como argumento a una función DEFINIDA POR EL ESTUDIANTE en el mismo
// fichero, después del accept(), se considera un error siempre — no
// importa si esa función acaba usándolo para E/S o no; la pregunta "¿por
// qué se lo pasas si no vas a leer/escribir con él?" no tiene buena
// respuesta en el contexto de esta asignatura. Se excluyen a propósito
// las funciones de biblioteca (close, poll, setsockopt...), que nunca
// tienen function_definition en el fichero del examen — así no hace
// falta mantener una lista de exclusión de funciones de sistema.
// IMPORTANTE: el orden respecto a accept() se respeta igual que en la
// ampliación 1 — solo se avisa si la llamada ocurre DESPUÉS del accept().

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

interface AcceptCall {
  listenSocketName: string;
  startIndex: number;
}

function findAcceptCalls(root: Parser.SyntaxNode): AcceptCall[] {
  const results: AcceptCall[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      if (func && /(^|::)accept$/.test(func.text)) {
        const args = n.childForFieldName("arguments");
        const first = args?.namedChildren[0];
        if (first?.type === "identifier") {
          results.push({ listenSocketName: first.text, startIndex: n.startIndex });
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(root);
  return results;
}

// Familia B′: un socket de escucha es TCP, así que recvfrom/sendto no pintan aquí.
const IO_FUNCS = ["read", ...VARIANTES_READ_N, "write", ...VARIANTES_WRITE_N, "send", "recv"];

export function findEntradaSalidaConSocketEscuchaIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const funcionesPropias = funcionesDefinidasEnFichero(tree.rootNode);

  function walkFunctions(n: Parser.SyntaxNode) {
    if (n.type === "function_definition") {
      const accepts = findAcceptCalls(n);
      if (accepts.length > 0) {
        const earliestPerName = new Map<string, number>();
        for (const a of accepts) {
          const prev = earliestPerName.get(a.listenSocketName);
          if (prev === undefined || a.startIndex < prev) earliestPerName.set(a.listenSocketName, a.startIndex);
        }

        // Para cada nombre base, su conjunto de alias (incluyéndose a sí
        // mismo) y a qué nombre base / posición de accept() corresponde.
        const aliasANombreBase = new Map<string, { base: string; acceptPos: number }>();
        for (const [base, pos] of earliestPerName) {
          const alias = ampliarConAlias(n, new Set([base]), pos);
          for (const nombre of alias) aliasANombreBase.set(nombre, { base, acceptPos: pos });
        }

        function walkForUsos(m: Parser.SyntaxNode) {
          if (m.type === "call_expression") {
            const func = m.childForFieldName("function");
            const bare = func?.text.replace(/^.*::/, "");
            const args = m.childForFieldName("arguments");

            // Caso 1: lectura/escritura directa (read/write/send/recv...)
            if (func && bare && IO_FUNCS.includes(bare)) {
              const first = args?.namedChildren[0];
              if (first?.type === "identifier") {
                const info = aliasANombreBase.get(first.text);
                if (info && m.startIndex > info.acceptPos) {
                  const nota = first.text !== info.base ? ` (alias de ${info.base})` : "";
                  findings.push({
                    startIndex: first.startIndex,
                    endIndex: first.endIndex,
                    message:
                      `${first.text}${nota} es el socket que espera conexiones, no el que habla con un ` +
                      `cliente concreto. Revisa qué descriptor le corresponde a ${bare}() aquí.`,
                  });
                }
              }
            }

            // Caso 2: paso como argumento a una función definida por el
            // estudiante en el mismo fichero (norma de la asignatura).
            if (func && bare && funcionesPropias.has(bare) && !IO_FUNCS.includes(bare)) {
              for (const arg of args?.namedChildren ?? []) {
                if (arg.type !== "identifier") continue;
                const info = aliasANombreBase.get(arg.text);
                if (info && m.startIndex > info.acceptPos) {
                  const nota = arg.text !== info.base ? ` (alias de ${info.base})` : "";
                  findings.push({
                    startIndex: arg.startIndex,
                    endIndex: arg.endIndex,
                    message:
                      `${arg.text}${nota} es el socket que espera conexiones. En esta asignatura no se ` +
                      `pasa ese descriptor a funciones propias como ${bare}() — si necesitas hablar con ` +
                      `el cliente, pasa el socket que devolvió accept().`,
                  });
                }
              }
            }
          }
          for (const child of m.namedChildren) walkForUsos(child);
        }
        walkForUsos(n);
      }
    }
    for (const child of n.namedChildren) walkFunctions(child);
  }
  walkFunctions(tree.rootNode);

  return findings;
}
