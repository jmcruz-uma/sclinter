/** Códigos SC: lo que el estudiante ve junto al aviso, y la clave con la que
 * busca la regla en el cuadernillo de ayuda.
 *
 * Los códigos NO son el identificador interno. El identificador (`sin-port-no-htons`)
 * sigue siendo la clave del código y de los tests;
 * el código `SC01` es la cara visible. Esa separación es deliberada: los
 * identificadores describen el fallo y, puestos junto a un mensaje que
 * deliberadamente no da la respuesta, la regalaban.
 *
 * DOS REGLAS QUE NO SE PUEDEN ROMPER
 *
 * 1. Un código, una vez asignado, NO cambia nunca. El cuadernillo y la memoria
 *    del alumnado dependen de ello. Si una regla se retira, su número muere con
 *    ella y no se reutiliza.
 * 2. Los números van por bloques de familia, con huecos libres al final de cada
 *    uno. Una regla nueva entra en el hueco de SU familia, no al final de todo:
 *    así "SC5x" sigue significando "procesos" dentro de cinco años.
 *
 *      SC01–SC09  Orden de bytes y conversiones
 *      SC10–SC19  Montaje y extracción de PDU
 *      SC20–SC29  Contenedores de C++ y .data()
 *      SC30–SC39  sizeof, punteros y argv
 *      SC40–SC49  Sockets y descriptores
 *      SC50–SC59  Procesos y señales
 *      SC60–SC69  Tuberías
 *
 * Dentro de cada bloque, los primeros números son para los fallos más
 * habituales. Es una comodidad para quien consulta la lista, no un dato con
 * significado: si el orden envejece, no pasa nada — los códigos no se tocan.
 */

/** Código visible ← identificador interno. */
export const CODIGOS: Record<string, string> = {
  // SC01–SC09 · Orden de bytes y conversiones
  "byteswap-uso-local-incorrecto": "SC01",
  "conversion-de-anchura-equivocada": "SC02",
  "sin-port-no-htons": "SC03",
  "byteswap-comparacion-en-vez-de-asignacion": "SC04",
  "byteswap-sobre-valor-sin-tipo": "SC05",
  "conversion-escondida-en-macro": "SC06",

  // SC10–SC19 · Montaje y extracción de PDU
  "memcpy-invertido-al-extraer": "SC10",
  "struct-sin-static-assert": "SC11",
  "size-contenedor-no-byte-sin-aritmetica": "SC12",
  "memcpy-destino-repetido": "SC13",
  "envio-de-buffer-sin-rellenar": "SC14",
  "mempcpy-extension-gnu": "SC15",
  "size-en-vez-de-offset": "SC16",
  "memcpy-array-overflow": "SC17",

  // SC20–SC29 · Contenedores de C++ y .data()
  "io-string-data-prohibido": "SC20",
  "memcpy-string-data-prohibido": "SC21",
  "io-container-direccion": "SC22",
  "io-array-direccion-estilo": "SC23",
  "struct-con-contenedor-direccion": "SC24",
  "memcpy-direccion-contenedor": "SC25",
  "memcpy-array-direccion-estilo": "SC26",
  "io-vector-data": "SC27",

  // SC30–SC39 · sizeof, punteros y argv
  "sizeof-argv-elemento": "SC30",
  "argc-argv-desajuste": "SC31",
  "sizeof-contenedor": "SC32",
  "sizeof-puntero": "SC33",
  "poll-sizeof": "SC34",

  // SC40–SC49 · Sockets y descriptores
  "entrada-salida-con-socket-escucha": "SC40",
  "read-desde-teclado": "SC41",
  "read-n-en-teclado": "SC42",
  "accept-sin-listen": "SC43",

  // SC50–SC59 · Procesos y señales
  "hijo-sin-terminar": "SC50",
  "zombies-sin-reap": "SC51",
  "fork-antes-de-accept": "SC52",
  "errno-asignacion-en-vez-de-comparacion": "SC53",
  "signal-kill-args-invertidos": "SC54",

  // SC60–SC69 · Tuberías
  "pipe-extremos-invertidos": "SC60",
  "pipe-uso-antes-de-crear": "SC61",
};

/** El código de una regla. Si faltara —regla nueva sin código asignado— se
 * devuelve el identificador interno: es preferible un aviso feo a un aviso
 * mudo, y se ve enseguida que falta añadirla a la tabla. */
export function codigoDe(ruleId: string): string {
  return CODIGOS[ruleId] ?? ruleId;
}
