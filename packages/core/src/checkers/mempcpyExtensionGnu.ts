import Parser from "web-tree-sitter";

// Regla de NORMATIVA (nivel 4): llamada a `mempcpy`. El código funciona con
// g++ sobre glibc, así que no es un bug — se marca porque la asignatura usa
// `std::memcpy` (o `memcpy` a secas) y `mempcpy` no es una alternativa
// legítima a ninguno de los dos.
//
// Tres hechos, los tres comprobados con el compilador:
//
//  1. `std::mempcpy` NO EXISTE. `g++-14 -std=c++23` responde literalmente
//     "'mempcpy' is not a member of 'std'; did you mean 'memcpy'?". No es que
//     escribirlo con `std::` esté desaconsejado: es que no se puede. Para
//     llegar a `mempcpy` hay que abandonar antes la forma que se enseña.
//  2. Es una extensión de GNU, no del estándar. Compila solo porque g++
//     define `_GNU_SOURCE` por su cuenta; sin él ni siquiera se declara
//     ("'mempcpy' was not declared in this scope"). Con otra biblioteca
//     estándar el código deja de compilar.
//  3. Lo único que aporta sobre `memcpy` es el valor de retorno (`dst + n`
//     en vez de `dst`), que en las entregas donde aparece se descarta.
//
// POR QUÉ ESTA REGLA Y NO ENSEÑAR `mempcpy` A LAS DEMÁS: nueve checkers del
// catálogo reconocen la función de copia por su nombre literal `memcpy`
// (memcpy-direccion-contenedor, memcpy-array-overflow, struct-sin-static-assert,
// size-contenedor-no-byte...), así que un `mempcpy` se les escapa entero. Se
// vio en una entrega real: el MISMO alumno escribió el mismo bug —volcar bytes
// crudos sobre un `std::string`— con `memcpy` en un ejercicio y con `mempcpy`
// en el siguiente, y solo se detectó el primero.
//
// La salida NO es enseñarles `mempcpy` a las nueve: eso haría que la
// herramienta lo tratara como una forma normal de copiar, que es justo lo
// contrario de lo que se quiere. Se resuelve como ya se resolvió el límite
// intra-función en `entrada-salida-con-socket-escucha`: con una regla de
// nivel 4 en su lugar. En cuanto el estudiante escribe `std::memcpy`, las
// nueve reglas lo ven y le sale el bug de debajo.
//
// Y NO ES SOLO ESTA HERRAMIENTA: el propio compilador pierde el diagnóstico.
// Comprobado con g++-14 -Wall -Wextra sobre las dos versiones del mismo bug:
//   memcpy (&d, o, 4);   // d es std::string  -> warning [-Wclass-memaccess]
//   mempcpy(&d, o, 4);   // d es std::string  -> SILENCIO
// `-Wclass-memaccess` conoce `memcpy` y no `mempcpy`, así que escribir la
// extensión de GNU apaga también el aviso de g++. Es el mismo agujero que
// tenía el catálogo, y refuerza la razón de ser de esta regla.
//
// NO es cppOnly, a propósito: `mempcpy` es una extensión de GNU también en C,
// y ahí el problema de portabilidad es el mismo. El mensaje menciona
// `std::memcpy` como preferencia de C++, pero ofrece `memcpy` primero, que es
// la salida válida en los dos lenguajes. (Ver la cicatriz de `read-n-en-teclado`,
// que se marcó cppOnly por error arrastrada por la redacción del mensaje.)
//
// Alcance deliberadamente estrecho: SOLO `mempcpy`. `memccpy` queda fuera —
// no es de GNU sino de POSIX, y C23 la incorporó al estándar; además su firma
// es distinta (`dst, src, c, n`). Es otra discusión, no esta.
//
// NO CHOCA con `byteswapUsoLocalIncorrecto`, que sí trata `mempcpy` como
// sinónimo de `memcpy` (ver su `EXTRACT_FUNCS`). Aquella es una afirmación
// semántica y esta es normativa: modelarla allí evita un falso positivo, y
// prohibirla aquí es el aviso que de verdad le toca al estudiante. Juntas, una
// recepción correcta escrita con `mempcpy` da un solo aviso, el de esta regla.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

export function findMempcpyExtensionGnuIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];

  function walk(n: Parser.SyntaxNode) {
    if (n.type === "call_expression") {
      const func = n.childForFieldName("function");
      // Se normaliza igual que en el resto del catálogo: fuera espacios y
      // fuera el prefijo de espacio de nombres. Cubre `mempcpy`, `::mempcpy`
      // y cualquier cosa que un estudiante escriba delante.
      const bare = func?.text.replace(/\s+/g, "").replace(/^.*::/, "");
      if (bare === "mempcpy") {
        findings.push({
          startIndex: n.startIndex,
          endIndex: n.endIndex,
          message:
            "mempcpy es una extensión propia de GNU, pero no forma parte del estándar y tampoco " +
            "existe std::mempcpy en C++. Aquí preferimos usar memcpy o std::memcpy",
        });
      }
    }
    for (const child of n.namedChildren) walk(child);
  }
  walk(tree.rootNode);

  return findings;
}
