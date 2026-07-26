import Parser from "web-tree-sitter";

// Helper COMPARTIDO (no es una regla): resolver qué declaración de un nombre
// está vigente en un punto concreto del código.
//
// Existe por un defecto de diseño que comparte toda una familia de reglas
// (io-array-direccion-estilo, memcpy-array-direccion-estilo,
// io-container-direccion, memcpy-direccion-contenedor,
// struct-con-contenedor-direccion): todas recogían los nombres declarados
// con cierto tipo recorriendo la FUNCIÓN ENTERA, y luego preguntaban
// "¿este nombre está en el conjunto?". Sin noción de ámbito, dos variables
// distintas con el mismo nombre se confunden.
//
// Caso real que lo destapó (alumno_021, Evaluacion2 ej1):
//
//   int esperar_evento(...) {
//       std::array<char, 10> buffer;        // ámbito de la función
//       ...
//       if (fds[2].revents) {
//           char buffer;                    // SOMBREA al anterior
//           read_n(pipes[1], &buffer, 1);   // ← se avisaba aquí
//       }
//   }
//
// El aviso decía "usa buffer.data()" sobre un `char`, que no tiene .data():
// no era ruido inofensivo, era un consejo que no compila.
//
// La resolución que hace este helper es la de C++ simplificada: se sube
// desde el punto de uso por los bloques que lo contienen y, en cada uno, se
// buscan declaraciones de ese nombre ANTERIORES al uso; gana la más
// interna. Los parámetros de la función hacen de ámbito exterior. No se
// modela using/namespace/clases: para el código de estos exámenes
// (funciones libres con variables locales) es suficiente, y ante la duda
// devuelve null, que las reglas interpretan como silencio.
//
// ADOPCIÓN INCREMENTAL (decisión del profesor, 2026-07-26): se aplica a una
// regla cada vez, midiendo el corpus entre medias. La primera es
// io-array-direccion-estilo, que es donde había un falso positivo medido;
// las otras cuatro no tienen ninguno, así que se irán pasando de una en una.

/** Todos los identificadores que declara una `declaration` o una
 * `parameter_declaration`. OJO: `uint8_t TIPO, id_SLOT;` produce DOS campos
 * `declarator` hermanos y `childForFieldName("declarator")` devuelve solo el
 * primero. También cubre `int a = 1, b = 2;` (hijos `init_declarator`) y los
 * declaradores compuestos (`char buf[10]`, `uint8_t *ptr`). */
export function nombresDeclarados(declaration: Parser.SyntaxNode): string[] {
  const nombres: string[] = [];
  for (let i = 0; i < declaration.childCount; i++) {
    if (declaration.fieldNameForChild(i) !== "declarator") continue;
    let cur: Parser.SyntaxNode | null = declaration.child(i);
    while (cur && cur.type !== "identifier") {
      cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
    }
    if (cur) nombres.push(cur.text);
  }
  return nombres;
}

/** El texto del tipo de una declaración, sin espacios (`std::array<char,10>`).
 * Devuelve "" si la declaración no tiene campo `type`. */
export function textoDelTipo(declaration: Parser.SyntaxNode): string {
  return declaration.childForFieldName("type")?.text.replace(/\s+/g, "") ?? "";
}

function parametrosDe(fnDef: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const params: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (n.type === "parameter_list") {
      for (const p of n.namedChildren) {
        if (p.type === "parameter_declaration") params.push(p);
      }
      return;
    }
    for (const child of n.namedChildren) walk(child);
  }
  const declarator = fnDef.childForFieldName("declarator");
  if (declarator) walk(declarator);
  return params;
}

/** La declaración de `name` VIGENTE en el punto `useNode`, o null si no se
 * encuentra ninguna visible. Devuelve el nodo de la declaración para que
 * cada regla mire lo que le interese (normalmente el tipo). */
export function declaracionVigente(
  useNode: Parser.SyntaxNode,
  name: string
): Parser.SyntaxNode | null {
  let ambito: Parser.SyntaxNode | null = useNode.parent;

  while (ambito) {
    // Declaraciones DIRECTAS de este ámbito (no las de bloques hermanos, que
    // no están en ámbito) y anteriores al uso. En C++ un mismo nombre no
    // puede declararse dos veces en el mismo bloque, así que como mucho hay
    // una coincidencia por nivel.
    for (const hijo of ambito.namedChildren) {
      if (hijo.startIndex >= useNode.startIndex) break;
      if (hijo.type !== "declaration") continue;
      if (nombresDeclarados(hijo).includes(name)) return hijo;
    }

    // Los parámetros son el ámbito más exterior de la función.
    if (ambito.type === "function_definition") {
      for (const p of parametrosDe(ambito)) {
        if (nombresDeclarados(p).includes(name)) return p;
      }
    }

    ambito = ambito.parent;
  }

  return null;
}
