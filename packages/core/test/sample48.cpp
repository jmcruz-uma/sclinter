#include <cstring>
#include <cstdint>
#include <array>

// sample48 — memcpy-array-direccion-estilo con resolución de ÁMBITO.
// Tercera regla de la familia que adopta checkers/scopeResolution.ts
// (io-array-direccion-estilo en sample46, memcpy-direccion-contenedor en
// sample47). A diferencia de las otras dos, esta mira LOS DOS argumentos:
// el destino y el origen.

// ============================================================
// Deben CALLAR
// ============================================================

// Un escalar declarado dentro de un bloque sombrea al std::array de la
// función: ahí `&pdu` no es un contenedor y el consejo de usar .data() no
// tendría sentido. El uso de fuera del bloque sí es el array y sigue
// avisando.
void sombreado_en_bloque_interno(const uint8_t *origen, int cond) {
    std::array<uint8_t, 6> pdu;
    if (cond) {
        uint32_t pdu;                        // variable DISTINTA, mismo nombre
        std::memcpy(&pdu, origen, 4);        // silencio: es un uint32_t
        (void)pdu;
    }
    std::memcpy(&pdu, origen, 6);            // AVISA: aquí pdu es el array
}

// Sombreado en el argumento ORIGEN, que es lo que distingue a esta regla de
// sus hermanas.
void sombreado_en_el_origen(uint8_t *destino, int cond) {
    std::array<uint8_t, 6> fuente;
    if (cond) {
        uint16_t fuente;                     // variable DISTINTA
        fuente = 0;
        std::memcpy(destino, &fuente, 2);    // silencio: es un uint16_t
    }
    std::memcpy(destino, &fuente, 6);        // AVISA: aquí fuente es el array
}

// ============================================================
// Deben AVISAR
// ============================================================

// Array como destino y como origen en la misma llamada: dos avisos.
// (`dos` lleva inicializador, así que su declarador es un init_declarator:
// de paso comprueba que la resolución de ámbito también lo atraviesa.)
void array_en_los_dos_argumentos() {
    std::array<uint8_t, 6> uno;
    std::array<uint8_t, 6> dos{};
    std::memcpy(&uno, &dos, 6);
}

// Array recibido como parámetro (ámbito más exterior de la función).
void array_como_parametro(std::array<uint8_t, 6> &pdu, const uint8_t *origen) {
    std::memcpy(&pdu, origen, 6);
}

// Dos arrays declarados en la misma sentencia.
void dos_arrays_en_una_declaracion(const uint8_t *origen) {
    std::array<uint8_t, 4> uno, dos;
    std::memcpy(&uno, origen, 4);
    std::memcpy(&dos, origen, 4);
}

int main() {
    return 0;
}
