#include <cstdint>
#include <string>
#include <vector>
#include <sys/types.h>

// sample50 — io-container-direccion con resolución de ÁMBITO.
// Quinta y última regla de la familia que adopta
// checkers/scopeResolution.ts (sample46 a sample49 son las anteriores).

ssize_t read_n(int fd, void *data, size_t n);

// ============================================================
// Deben CALLAR
// ============================================================

// Un array de C declarado dentro de un bloque sombrea al std::string de la
// función. El uso de fuera del bloque sí es el string y sigue avisando.
void sombreado_en_bloque_interno(int fd, int cond) {
    std::string buffer;
    if (cond) {
        char buffer[64];              // variable DISTINTA, mismo nombre
        read_n(fd, &buffer, 64);      // silencio: es un array de C
        (void)buffer;
    }
    read_n(fd, &buffer, 4);           // AVISA: aquí buffer es el string
}

// std::array queda fuera de esta regla a propósito: &arr == arr.data().
// (De su versión de estilo se ocupa io-array-direccion-estilo.)
void escalar_con_nombre_de_contenedor(int fd) {
    uint16_t datos;
    read_n(fd, &datos, 2);            // silencio: es un uint16_t
    (void)datos;
}

// ============================================================
// Deben AVISAR
// ============================================================

void string_de_la_funcion(int fd) {
    std::string texto;
    read_n(fd, &texto, 4);
}

void vector_de_la_funcion(int fd) {
    std::vector<uint8_t> datos(16);
    read_n(fd, &datos, 4);
}

// Contenedor recibido como parámetro por referencia (ámbito exterior).
void vector_como_parametro(int fd, std::vector<uint8_t> &datos) {
    read_n(fd, &datos, 4);
}

// Dos contenedores declarados en la misma sentencia.
void dos_strings_en_una_declaracion(int fd) {
    std::string uno, dos;
    read_n(fd, &uno, 4);
    read_n(fd, &dos, 4);
}

// Contenedor declarado dentro de un bloque y usado ahí mismo.
void contenedor_declarado_en_bloque(int fd, int cond) {
    if (cond) {
        std::vector<char> datos(8);
        read_n(fd, &datos, 4);
    }
}

int main() {
    return 0;
}
