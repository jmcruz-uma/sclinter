#include <cstdint>
#include <cstring>
#include <bit>
#include <unistd.h>

// sample39 — RESÚMENES DE FUNCIÓN en byteswap-uso-local-incorrecto.
//
// Antes (sample36), pasar una variable por `T&` no const a una función propia
// dejaba su orden en "desconocido" y callaba SIEMPRE, porque no se miraba qué
// hacía el helper. Ahora se calcula un resumen del efecto del callee sobre ese
// parámetro (intacto / lo rellena de red / le aplica k conversiones /
// desconocido) y solo se sigue callando cuando el resumen NO es concluyente.
//
// La regla de oro es que el resumen solo puede REFINAR ese "desconocido",
// nunca inventar certeza: ante cualquier ambigüedad se vuelve a callar, que es
// el comportamiento que había antes.

ssize_t read_n(int fd, void *buf, size_t n);

// ---------------------------------------------------------------------------
// Helpers con resumen CONCLUYENTE
// ---------------------------------------------------------------------------

// Resumen: "intacto" — declara el parámetro por referencia no-const pero no lo
// toca. Es el caso real de varias entregas: un espera_evento() que declara
// uint16_t& seq, uint16_t& ack y nunca los rellena.
int no_toca_nada(uint16_t &seq, uint16_t &ack) {
    (void)seq;
    (void)ack;
    return 0;
}

// Resumen: "lo rellena de red" — el parámetro es destino de una lectura.
void lee_de_red(int fd, uint16_t &v) { read_n(fd, &v, sizeof(v)); }

// Resumen: "le aplica 1 conversión" al valor entrante, sin origen de red.
void convierte(uint16_t &v) { v = std::byteswap(v); }

// ---------------------------------------------------------------------------
// Helpers con resumen AMBIGUO → se sigue callando
// ---------------------------------------------------------------------------

// Una rama lo rellena de red y la otra le pone una constante local: el efecto
// depende del camino, así que no hay veredicto posible.
void a_veces_red(int fd, uint16_t &v, bool desde_red) {
    if (desde_red) {
        read_n(fd, &v, sizeof(v));
    } else {
        v = 7;
    }
}

// Lo rellena de red Y ADEMÁS lo convierte (el helper del enunciado, que
// entrega el dato "ya en formato nativo"). Son dos mutaciones EN SECUENCIA, y
// el resumen exige hoy que todas coincidan: discrepan, así que sale
// `desconocido`. Ahí queda aplazado el DOBLE byteswap; habilitarlo exige
// encadenar la última mutación hacia atrás en vez de exigir acuerdo.
void lee_y_convierte(int fd, uint16_t &v) {
    read_n(fd, &v, sizeof(v));
    v = std::byteswap(v);
}

// ---------------------------------------------------------------------------
// AVISA: el helper no toca el parámetro
// ---------------------------------------------------------------------------

// v nace local, el helper no la modifica y el byteswap la deja en orden de red
// justo antes de usarla como tamaño. Antes se callaba por el mero hecho de
// haberla pasado por referencia no-const.
void bug_helper_intacto(const char *texto, char *buffer) {
    uint16_t v = strlen(texto);
    uint16_t otro = 0;
    no_toca_nada(v, otro);
    v = std::byteswap(v);
    memcpy(buffer, texto, v);
}

// ---------------------------------------------------------------------------
// AVISA: el helper convierte, pero el valor sigue sin venir de la red
// ---------------------------------------------------------------------------

// El helper aplica una conversión a un valor de origen local: al volver está
// en orden de red, y compararlo localmente es el bug que la regla persigue.
void bug_helper_convierte(const char *texto) {
    uint16_t v = strlen(texto);
    convierte(v);
    if (v == 10) {
        (void)v;
    }
}

// ---------------------------------------------------------------------------
// CALLA: el helper lo rellena de la red (idioma correcto de recepción)
// ---------------------------------------------------------------------------

// Este es el control que de verdad importa: leer de red en un helper y
// convertir en el llamante es EXACTAMENTE lo correcto, y debe seguir callado.
void bien_helper_lee_de_red(int fd, char *buffer, const char *origen) {
    uint16_t v = 0;
    lee_de_red(fd, v);
    v = std::byteswap(v);
    memcpy(buffer, origen, v);
}

// ---------------------------------------------------------------------------
// CALLA: resumen ambiguo → se mantiene el silencio de antes
// ---------------------------------------------------------------------------

void calla_ambiguo(int fd, char *buffer, const char *origen, bool desde_red) {
    uint16_t v = 0;
    a_veces_red(fd, v, desde_red);
    v = std::byteswap(v);
    memcpy(buffer, origen, v);
}

// El doble byteswap (el helper ya convirtió, y aquí se vuelve a convertir)
// deja el valor otra vez en orden de red. Es un bug real, pero su detección
// está fuera del alcance de esta fase: por ahora debe callar.
void calla_doble_swap_pendiente(int fd, char *buffer, const char *origen) {
    uint16_t v = 0;
    lee_y_convierte(fd, v);
    v = std::byteswap(v);
    memcpy(buffer, origen, v);
}
