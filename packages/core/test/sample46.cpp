#include <array>
#include <cstdint>
#include <cstddef>
#include <sys/types.h>

// sample46 — io-array-direccion-estilo con resolución de ÁMBITO
// (checkers/scopeResolution.ts, helper compartido).
//
// Antes, la regla recogía los nombres declarados como std::array en la
// función entera y solo preguntaba "¿está este nombre en el conjunto?".
// Con dos variables distintas del mismo nombre se equivocaba de una y
// llegaba a recomendar `buffer.data()` sobre un `char` — un consejo que ni
// siquiera compila (falso positivo real de alumno_021, Evaluacion2).

ssize_t read_n(int fd, void *data, size_t n);

// ============================================================
// Debe CALLAR
// ============================================================

// El caso de alumno_021: el `char buffer` interno sombrea al std::array de
// la función. `&buffer` es aquí la única forma correcta de escribirlo.
// En la MISMA función, el uso de fuera del bloque sí se refiere al array y
// sigue avisando — es lo que distingue la resolución de ámbito de verdad de
// un simple "quédate con la última declaración anterior al uso".
int sombreado_en_bloque_interno(int fd, int otro_fd) {
    std::array<char, 10> buffer;
    if (fd > 0) {
        char buffer;                      // variable DISTINTA, mismo nombre
        read_n(otro_fd, &buffer, 1);      // silencio: es un char
        if (buffer == '1') return 1;
    }
    read_n(fd, &buffer, 5);               // AVISA: aquí buffer es el array
    return 0;
}

// Un escalar del mismo nombre que un array declarado en OTRA función: no
// deben mezclarse (la resolución nunca sale de los bloques que contienen el
// uso).
int escalar_con_nombre_de_array_de_otra_funcion(int fd) {
    uint16_t buffer;
    read_n(fd, &buffer, 2);               // silencio: es un uint16_t
    return buffer;
}

// ============================================================
// Deben AVISAR — controles de que el aviso de estilo sigue vivo
// ============================================================

// El caso normal: array declarado en la función.
void array_de_la_funcion(int fd) {
    std::array<uint8_t, 6> pdu;
    read_n(fd, &pdu, 6);
}

// Array recibido como PARÁMETRO por referencia: los parámetros son el
// ámbito más exterior de la función y también hay que resolverlos.
void array_como_parametro(int fd, std::array<uint8_t, 6> &pdu) {
    read_n(fd, &pdu, 6);
}

// Dos arrays declarados en la MISMA sentencia: hay que mirar todos los
// declaradores, no solo el primero.
void dos_arrays_en_una_declaracion(int fd) {
    std::array<uint8_t, 4> uno, dos;
    read_n(fd, &uno, 4);
    read_n(fd, &dos, 4);
}

// Array declarado dentro de un bloque y usado ahí mismo: el sombreado no
// tiene nada que ver, sigue siendo un array.
void array_declarado_en_bloque_interno(int fd) {
    if (fd > 0) {
        std::array<char, 8> mensaje;
        read_n(fd, &mensaje, 8);
    }
}

int main() {
    return 0;
}
