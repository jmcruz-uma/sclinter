// Única fuente de verdad de los NOMBRES de las funciones de entrada/salida.
//
// POR QUÉ EXISTE (medido, no supuesto): cada checker llevaba su propia lista
// literal, y todas conocían `read_n`/`write_n` pero casi ninguna la variante
// sin guion bajo. En las dos convocatorias más recientes esa variante NO es
// una manía aislada: `readn`/`writen` aparece en 126 de los 233 ficheros de
// Evaluacion3 y en 54 de los 92 de Evaluacion4, mientras que la referencia que
// se reparte declara `read_n`. Se midió el coste renombrando una copia del
// corpus y volviendo a barrer: 10 detecciones reales perdidas (lecturas sobre
// `&std::string`, `.size()` de arrays de `int`/`uint32_t` como número de
// bytes, `&array` en E/S) y 4 avisos que salían con el diagnóstico de
// normativa en vez del mecánico, que es el preciso.
//
// La decisión anterior fue no perseguir la variante "porque es problema del
// alumno por renombrar la referencia". Con Evaluacion1 y Evaluacion2 delante
// (6% y 8% de los ficheros) era razonable; con más de la mitad de la clase
// escribiéndolo así, ya no. Es probable que en algún laboratorio se repartiera
// una referencia con esos nombres.
//
// ---------------------------------------------------------------------------
// TRES FAMILIAS, Y SOLO UNA ES "TODA LA E/S"
// ---------------------------------------------------------------------------
//
// Ojo al usar esto: NO todas las reglas hablan del mismo conjunto, y ampliar
// una de más cambia lo que la regla afirma. Hay tres familias:
//
//  A. Solo los HELPERS (`read-n-en-teclado`): la regla dice que read_n exige un
//     número exacto de bytes y el teclado no lo tiene. Con `read` a secas ese
//     argumento no vale, así que esa regla usa solo VARIANTES_READ_N.
//  B. POSIX + helpers, SIN funciones de socket (`pipe-uso-antes-de-crear`): una
//     tubería no se lee con recv.
//  B′. Como B pero con `send`/`recv` y sin `recvfrom`/`sendto`
//     (`pipe-extremos-invertidos`, `entrada-salida-con-socket-escucha`): un
//     socket de escucha es TCP y una tubería no es UDP.
//  C. E/S completa: el resto.
//
// Las familias A, B y B′ se componen a mano en su propio checker a partir de
// las variantes; NO se construyen con ES_COMPLETA. Lo único que ganaron al
// centralizar esto fueron las variantes de nombre: ninguna regla pasó a mirar
// una función distinta de las que ya miraba.

/** Cómo escriben los estudiantes el helper de lectura de la referencia.
 * `readN`/`read_N` no aparecen en ninguno de los cuatro corpus: entran como
 * preventivas, igual que en su día `io-vector-data`. */
export const VARIANTES_READ_N = ["read_n", "readn", "readN", "read_N"];
export const VARIANTES_WRITE_N = ["write_n", "writen", "writeN", "write_N"];

/** Familia C: todas las formas de LEER de un socket o una tubería. */
export const LECTURAS = ["read", ...VARIANTES_READ_N, "recv", "recvfrom"];

/** Familia C: todas las formas de ESCRIBIR en un socket o una tubería. */
export const ESCRITURAS = ["write", ...VARIANTES_WRITE_N, "send", "sendto"];

/** Familia C: las funciones de E/S al completo (las "8 funciones" del catálogo,
 * ahora con las variantes de nombre de los helpers). */
export const ES_COMPLETA = [...LECTURAS, ...ESCRITURAS];
