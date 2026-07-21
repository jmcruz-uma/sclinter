#include <cstdint>
#include <cstring>
#include <bit>
#include <unistd.h>

// sample40 — MUTACIONES INCOMPLETAS en los resúmenes de función de
// byteswap-uso-local-incorrecto (continuación de sample39).
//
// El resumen de un parámetro se calcula a partir de las mutaciones que la
// regla sabe interpretar (read/memcpy/asignación/paso a otra función). Pero
// esa lista es incompleta a propósito: hay maneras de escribir un parámetro
// que no modelamos (`mempcpy`, a través de un puntero, un campo suelto, un
// método del contenedor...).
//
// Mientras el resumen solo servía para CALLAR, esa incompletitud daba como
// mucho silencio de más. Desde que sirve para dar un veredicto, un callee con
// DOS escrituras —una reconocida y otra no— nos haría concluir sobre media
// película y acusar al llamante por algo que no hemos visto entero.
//
// Por eso se exige que TODA aparición potencialmente modificadora del
// parámetro caiga dentro de una mutación conocida. Si sobra una sola, no hay
// resumen (`desconocido`) y se vuelve a callar.

ssize_t read_n(int fd, void *buf, size_t n);
extern "C" void *mempcpy(void *dest, const void *src, size_t n) noexcept;

// ---------------------------------------------------------------------------
// CALLA: escritura reconocida + escritura NO reconocida en el mismo helper
// ---------------------------------------------------------------------------

// `v = 0` sí se modela; el `mempcpy` no (es la extensión GNU que ya provocó el
// único falso positivo residual del corpus, alumno_058). Sin la comprobación
// de cobertura, el resumen saldría "orden de host" mirando solo la primera, y
// el byteswap del llamante se marcaría como bug — sin haber visto que el
// parámetro se rellena después desde un buffer.
void mezcla_no_modelada(uint16_t &v, const char *buf) {
    v = 0;
    mempcpy(&v, buf, 2);
}

void calla_escritura_no_modelada(char *destino, const char *origen, const char *buf) {
    uint16_t v = 0;
    mezcla_no_modelada(v, buf);
    v = std::byteswap(v);
    memcpy(destino, origen, v);
}

// ---------------------------------------------------------------------------
// CALLA: escritura sobre un CAMPO del parámetro
// ---------------------------------------------------------------------------

struct Cabecera {
    uint16_t longitud;
    uint8_t tipo;
};

// `c = otra` se modela, pero `c.tipo = 1` escribe un campo y no se modela como
// mutación del objeto entero.
//
// OJO: se comprobó que este caso YA callaba antes de existir la comprobación
// de cobertura, por otro motivo — el uso es `c.longitud`, y para un campo el
// resumen del objeto entero se considera de granularidad demasiado gruesa como
// para dar veredicto. Se conserva como control de que sigue callado, pero no
// es el que demuestra la comprobación: esos son los otros dos (líneas 45 y 84
// sin ella, falsos positivos ambos).
void toca_un_campo(Cabecera &c, const Cabecera &otra) {
    c = otra;
    c.tipo = 1;
}

void calla_campo_suelto(char *destino, const char *origen, const Cabecera &otra) {
    Cabecera c{};
    toca_un_campo(c, otra);
    c.longitud = std::byteswap(c.longitud);
    memcpy(destino, origen, c.longitud);
}

// ---------------------------------------------------------------------------
// CALLA: incremento del parámetro además de asignarlo
// ---------------------------------------------------------------------------

void asigna_y_incrementa(uint16_t &v) {
    v = 4;
    ++v;
}

void calla_incremento(char *destino, const char *origen) {
    uint16_t v = 0;
    asigna_y_incrementa(v);
    v = std::byteswap(v);
    memcpy(destino, origen, v);
}

// ---------------------------------------------------------------------------
// CONTROL — AVISA: todas las escrituras del helper son reconocidas
// ---------------------------------------------------------------------------

// Sin este caso, la comprobación de cobertura podría pasarse de estricta y
// callar siempre sin que nos diéramos cuenta. Aquí las dos escrituras se
// modelan y coinciden, así que el resumen sigue siendo concluyente y el
// byteswap del llamante se marca.
void asigna_dos_veces(uint16_t &v, bool alterno) {
    if (alterno) {
        v = 8;
    } else {
        v = 8;
    }
}

void bug_todas_modeladas(char *destino, const char *origen, bool alterno) {
    uint16_t v = 0;
    asigna_dos_veces(v, alterno);
    v = std::byteswap(v);
    memcpy(destino, origen, v);
}

// ---------------------------------------------------------------------------
// CONTROL — CALLA: el helper lee de la red (idioma correcto), sin ruido extra
// ---------------------------------------------------------------------------

void lee_limpio(int fd, uint16_t &v) { read_n(fd, &v, sizeof(v)); }

void bien_lee_de_red(int fd, char *destino, const char *origen) {
    uint16_t v = 0;
    lee_limpio(fd, v);
    v = std::byteswap(v);
    memcpy(destino, origen, v);
}
