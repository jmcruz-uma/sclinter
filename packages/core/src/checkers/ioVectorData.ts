import Parser from "web-tree-sitter";

// Regla (nivel 1, mecánico — a diferencia de io-string-data, que es
// normativa): escribir bytes de la red sobre el buffer de un std::vector
// VACÍO es comportamiento indefinido. `v.data()` de un vector recién
// default-construido (tamaño 0) no apunta a memoria escribible; leer ahí
// con read/read_n/recv/recvfrom (2º argumento) o copiar ahí con memcpy
// (1er argumento) desborda.
//
// A DIFERENCIA de std::string, recibir a un std::vector<char> (o
// <uint8_t>/<std::byte>) SÍ es el patrón recomendado en la asignatura —
// pero solo si el vector está dimensionado antes. Por eso esta regla
// avisa ÚNICAMENTE cuando el vector está vacío/sin dimensionar, y calla
// si se dimensionó.
//
// Dimensionar de verdad: `v.resize(n)`, el constructor con tamaño
// (`std::vector<char> v(n)`), o una asignación (`v = ...`, `v.assign(...)`).
// TRAMPA: `v.reserve(n)` cambia la CAPACIDAD, no el tamaño — tras un
// reserve el vector sigue vacío y escribir en data() sigue siendo UB, así
// que reserve NO cuenta como dimensionar.
//
// Solo se consideran vectores DECLARADOS aquí como default-construidos.
// Un vector recibido por referencia como parámetro pudo dimensionarlo
// quien llama (no lo vemos) — no se avisa, para no dar falsos positivos
// (coherente con el límite intra-función del proyecto).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const READ_FUNCS = ["read", "read_n", "recv", "recvfrom"]; // vector = destino en 2º arg
// memcpy: vector = destino en 1er arg.

// Tipos de elemento que corresponden a un buffer de bytes (texto del tipo
// ya normalizado sin espacios).
const BYTE_ELEM = new Set([
  "char",
  "unsignedchar",
  "signedchar",
  "uint8_t",
  "std::uint8_t",
  "int8_t",
  "std::int8_t",
  "byte",
  "std::byte",
]);

function enclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === "function_definition") return n;
    n = n.parent;
  }
  return null;
}

function isByteVectorType(typeText: string): boolean {
  const t = typeText.replace(/\s+/g, "");
  const m = t.match(/^(?:std::)?vector<(.+)>$/);
  return m ? BYTE_ELEM.has(m[1]) : false;
}

/** Vectores de bytes DECLARADOS en la función como default-construidos
 * (declarador es un identificador pelado: `std::vector<char> v;`), que por
 * tanto arrancan vacíos. Excluye parámetros y declaraciones con tamaño o
 * inicializador (`v(n)`, `v = ...`), que ya vienen dimensionados. */
function emptyByteVectorNames(functionNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "declaration") {
      const typeNode = n.childForFieldName("type");
      const declNode = n.childForFieldName("declarator");
      if (typeNode && declNode?.type === "identifier" && isByteVectorType(typeNode.text)) {
        names.add(declNode.text);
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return names;
}

/** ¿Hay antes de `beforeIndex` una operación que dimensiona `name`
 * (resize/assign o una asignación `name = ...`)? reserve NO cuenta. */
function hasSizingBefore(functionNode: Parser.SyntaxNode, name: string, beforeIndex: number): boolean {
  let found = false;
  function walk(n: Parser.SyntaxNode) {
    if (found) return;
    if (n.startIndex < beforeIndex) {
      if (n.type === "call_expression") {
        const func = n.childForFieldName("function");
        if (func?.type === "field_expression") {
          const obj = func.childForFieldName("argument");
          const field = func.childForFieldName("field")?.text;
          if (obj?.type === "identifier" && obj.text === name && (field === "resize" || field === "assign")) {
            found = true;
            return;
          }
        }
      }
      if (n.type === "assignment_expression" && n.childForFieldName("operator")?.text === "=") {
        const left = n.childForFieldName("left");
        if (left?.type === "identifier" && left.text === name) {
          found = true;
          return;
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(functionNode);
  return found;
}

/** Si `node` es IDENT.data() con IDENT en `vectors`, devuelve IDENT. */
function vectorDataTarget(node: Parser.SyntaxNode, vectors: Set<string>): string | null {
  if (node.type !== "call_expression") return null;
  const func = node.childForFieldName("function");
  if (func?.type !== "field_expression") return null;
  const obj = func.childForFieldName("argument");
  const field = func.childForFieldName("field");
  if (field?.text !== "data" || obj?.type !== "identifier") return null;
  return vectors.has(obj.text) ? obj.text : null;
}

export function findIoVectorDataIssues(tree: Parser.Tree, _language: Parser.Language): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      const bare = func?.text.replace(/\s+/g, "").replace(/^.*::/, "");
      if (func && bare) {
        const args = n.childForFieldName("arguments");
        // read/read_n/recv/recvfrom → destino en 2º arg; memcpy → 1er arg.
        let dest: Parser.SyntaxNode | undefined;
        if (READ_FUNCS.includes(bare)) dest = args?.namedChildren[1];
        else if (bare === "memcpy") dest = args?.namedChildren[0];

        if (dest) {
          const fn = enclosingFunction(n);
          if (fn) {
            const vectors = emptyByteVectorNames(fn);
            const name = vectorDataTarget(dest, vectors);
            if (name && !hasSizingBefore(fn, name, n.startIndex)) {
              findings.push({
                startIndex: dest.startIndex,
                endIndex: dest.endIndex,
                message:
                  `${name}.data() se usa como destino de ${bare}() pero ${name} es un std::vector vacío ` +
                  `(tamaño 0): su .data() no apunta a memoria válida para escribir, es comportamiento ` +
                  `indefinido. Dimensiónalo antes con ${name}.resize(n) o constrúyelo con tamaño ` +
                  `(std::vector<...> ${name}(n)). Ojo: reserve() no vale, cambia la capacidad, no el tamaño.`,
              });
            }
          }
        }
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
