#include <cstdint>
#include <cstring>
#include <bit>

// sample36 — excepción "paso por referencia no-const a función propia" de
// byteswap-uso-local-incorrecto. Si una variable se pasa por `T&` (no const)
// a una función definida por el estudiante ANTES del byteswap, esa función
// pudo rellenarla (p.ej. de la red en un helper tipo espera_evento). Por
// valor o por `const T&` sí se avisa (el helper no puede haberla modificado).
//
// OJO — ESTE FICHERO CAMBIÓ DE EXPECTATIVA. Cuando se escribió, la excepción
// era ciega: bastaba con pasar la variable por `T&` para callar, sin mirar qué
// hacía el helper. Desde que existen los RESÚMENES de función (ver sample39),
// se mira: `rellena_ref` hace `x = 42`, una constante en orden de host — NO la
// rellena de la red. Así que byteswapear `v` después y usarla como tamaño de
// memcpy sí es un bug real, y `bien_ref_no_const` PASÓ A AVISAR (3 avisos en
// este fichero, no 2). El caso que de verdad debe callar —un helper que lee de
// la red— está en sample39 (`bien_helper_lee_de_red`). El nombre de la función
// de abajo se conserva tal cual para no perder el rastro del cambio.

// Helper propio que asigna una constante local por referencia no-const.
void rellena_ref(uint16_t &x) { x = 42; }
// Helper propio por valor (no puede modificar el original del llamador).
void usa_valor(uint16_t x) { (void)x; }
// Helper propio por referencia const (solo lectura).
void usa_const_ref(const uint16_t &x) { (void)x; }

// AVISA (antes callaba): el helper no rellena v de la red, solo le pone una
// constante en orden de host; el byteswap la deja en orden de red al usarla.
void bien_ref_no_const(const char *origen, char *buffer) {
    uint16_t v = 0;
    rellena_ref(v);
    v = std::byteswap(v);
    memcpy(buffer, origen, v);
}

// AVISA: v se pasa por VALOR — el helper no puede haberla modificado, sigue
// siendo de origen local; el byteswap la deja en orden de red usada localmente.
void bug_por_valor(const char *texto, char *buffer) {
    uint16_t v = strlen(texto);
    usa_valor(v);
    v = std::byteswap(v);
    memcpy(buffer, texto, v);
}

// AVISA: v se pasa por referencia CONST — solo lectura, no pudo rellenarla.
void bug_const_ref(const char *texto, char *buffer) {
    uint16_t v = strlen(texto);
    usa_const_ref(v);
    v = std::byteswap(v);
    memcpy(buffer, texto, v);
}
