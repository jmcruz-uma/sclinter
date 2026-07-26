#include <cstring>
#include <cstdint>
#include <array>
#include <memory>
#include <unistd.h>

// sample45 — memcpy-destino-repetido, tanda de correcciones 4 a 8
// (sondeo de falsos positivos de 2026-07-26: 11 de los 16 avisos del corpus
// eran falsos positivos).
//
// Causa raíz: el nombre base del destino se sacaba con una regex anclada al
// principio del texto, y devolvía null para cualquier destino que no
// empezara por el identificador (`&sec`, `*ptr`, `(uint8_t*)&pdu`) o basura
// para `std::addressof(sec)`. Sin nombre base, las TRES excepciones de la
// regla quedaban muertas. Ahora se resuelve sobre el árbol.

ssize_t write_n(int fd, const void *buf, size_t n);

// ============================================================
// Deben CALLAR
// ============================================================

// La misma extracción repetida en dos ramas mutuamente excluyentes. Mismo
// destino y mismo origen: la segunda copia deja la variable igual que la
// primera, no pisa nada. (Patrón de alumno_047; 2 de los 11 FP.)
void ramas_excluyentes_misma_extraccion(std::array<uint8_t, 5> mensaje, int *evento) {
    uint16_t seq;
    if (mensaje[0] == 1) {
        std::memcpy(&seq, mensaje.data() + 1, 2);
        *evento = 1;
    } else if (mensaje[0] == 2) {
        std::memcpy(&seq, mensaje.data() + 1, 2);
        *evento = 2;
    }
}

// Redeclaración con DOS declaradores en la misma sentencia: `uint8_t TIPO,
// id_SLOT;` produce dos campos `declarator` hermanos y antes solo se miraba
// el primero, así que `id_SLOT` era invisible como redeclaración.
// (Patrón de alumno_015 ej2.)
void redeclaracion_de_dos_en_una_linea(const uint8_t *almacen, std::array<uint8_t, 6> mensaje) {
    uint8_t TIPO, id_SLOT;
    std::memcpy(&TIPO, almacen, 1);
    std::memcpy(&id_SLOT, almacen + 1, 1);
    {
        uint8_t TIPO, id_SLOT;   // variables DISTINTAS, mismo nombre
        std::memcpy(&TIPO, mensaje.data(), 1);
        std::memcpy(&id_SLOT, mensaje.data() + 1, 1);
        (void)TIPO;
        (void)id_SLOT;
    }
}

// Variable de paso reutilizada para extraer de DOS buffers distintos: son
// extracciones sin relación, no un olvido de desplazamiento.
// (Patrón de alumno_015 ej1 L145.)
void misma_variable_dos_buffers(std::array<uint8_t, 6> mensaje, const char *almacen) {
    uint32_t INFO;
    std::memcpy(&INFO, mensaje.data() + 2, 4);
    std::memcpy(&INFO, almacen + 2, 4);
    (void)INFO;
}

// El buffer se envía entre las dos escrituras: rellenar de nuevo es
// legítimo. Con destino `&pdu` esta excepción estaba muerta.
void enviado_entre_medias(int sd, const uint8_t *origen) {
    struct { uint8_t a; uint8_t b; } pdu;
    std::memcpy(&pdu, origen, 2);
    write_n(sd, &pdu, 2);
    std::memcpy(&pdu, origen + 2, 2);
    write_n(sd, &pdu, 2);
}

// Puntero que avanza con `+=` en sentencias propias: el destino es
// literalmente `*ptr`, que antes daba nombre base null.
void puntero_que_avanza(std::array<uint8_t, 8> buffer, uint16_t a, uint16_t b) {
    uint16_t *ptr = reinterpret_cast<uint16_t *>(buffer.data());
    std::memcpy(ptr, &a, 2);
    ptr += 1;
    std::memcpy(ptr, &b, 2);
}

// ============================================================
// Deben AVISAR — controles de que el bug real sigue cazándose
// ============================================================

// Dos campos DISTINTOS del mismo buffer sobre la misma variable: el segundo
// pisa al primero. El alumno quería `&seq` en la primera línea.
// (Bug real de alumno_028; mensaje de la variante escalar.)
void dos_campos_a_la_misma_variable(const uint8_t *almacen) {
    uint16_t ack;
    std::memcpy(&ack, almacen + 1, 2);
    std::memcpy(&ack, almacen + 3, 2);
    (void)ack;
}

// Construcción de PDU sin avanzar el puntero: mismo destino, orígenes
// distintos. (Bug real de alumno_010; mensaje de la variante buffer.)
void pdu_sin_avanzar(std::array<uint8_t, 6> buffer, uint8_t id, uint32_t info) {
    std::memcpy(buffer.data() + 1, &id, 1);
    std::memcpy(buffer.data() + 1, &info, 4);
}

// COLETILLA DEL DISCRIMINADOR: el texto del origen es idéntico en las dos
// líneas, pero el offset del origen AVANZA entre medias, así que son dos
// campos distintos cayendo en la misma variable. Sin esta comprobación, el
// discriminador de "mismo origen" callaría un bug real.
void mismo_texto_de_origen_pero_offset_movido(const uint8_t *buf) {
    uint16_t x;
    int off = 1;
    std::memcpy(&x, buf + off, 2);
    off += 2;
    std::memcpy(&x, buf + off, 2);
    (void)x;
}

// NORMALIZACIÓN: los cuatro destinos son la MISMA dirección escrita de
// cuatro formas. Antes se comparaban como textos distintos y no se avisaba
// nunca — falso negativo. Ahora las tres repeticiones se marcan.
void mismo_destino_escrito_de_cuatro_formas(const uint8_t *origen) {
    uint32_t pdu;
    std::memcpy(&pdu, origen, 4);
    std::memcpy((uint8_t *)&pdu, origen + 4, 4);
    std::memcpy(static_cast<void *>(&pdu), origen + 8, 4);
    std::memcpy(std::addressof(pdu), origen + 12, 4);
    (void)pdu;
}

int main() {
    return 0;
}
