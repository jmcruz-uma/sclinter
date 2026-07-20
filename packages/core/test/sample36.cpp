#include <cstdint>
#include <cstring>
#include <bit>

// sample36 — excepción "paso por referencia no-const a función propia" de
// byteswap-uso-local-incorrecto. Si una variable se pasa por `T&` (no const)
// a una función definida por el estudiante ANTES del byteswap, esa función
// pudo rellenarla (p.ej. de la red en un helper tipo espera_evento), así que
// su orden es desconocido y no se avisa. Por valor o por `const T&` sí se
// sigue avisando (el helper no puede haberla modificado).

// Helper propio que rellena por referencia no-const (podría venir de la red).
void rellena_ref(uint16_t &x) { x = 42; }
// Helper propio por valor (no puede modificar el original del llamador).
void usa_valor(uint16_t x) { (void)x; }
// Helper propio por referencia const (solo lectura).
void usa_const_ref(const uint16_t &x) { (void)x; }

// CALLA: v se pasa por referencia no-const a una función propia antes del
// byteswap → orden desconocido, no se avisa (caso real: espera_evento).
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
