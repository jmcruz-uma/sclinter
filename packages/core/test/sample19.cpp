#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <array>
#include <unistd.h>

uint16_t htons(uint16_t x);
uint32_t htonl(uint32_t x);
ssize_t write_n(int fd, const void* data, size_t n);

// --- B: == en vez de = tras htons/ntohs/byteswap ---

void bug_comparacion_en_vez_de_asignacion(uint16_t n) {
    n == htons(n);
}

void bien_asignacion(uint16_t n) {
    n = htons(n);
}

void bug_comparacion_htonl(uint32_t n) {
    n == htonl(n);
}

// --- C: struct propio con std::string, serializado con & ---

struct mensaje_enviar {
    uint16_t num;
    std::string texto;
};

void bug_struct_con_string(int sd) {
    mensaje_enviar m;
    write_n(sd, &m, sizeof(m));
}

struct pdu_plano {
    uint16_t campo1;
    uint8_t campo2;
};
// sizeof(pdu_plano) es 4, no 3 — hay 1 byte de relleno tras campo2 por
// alineación de uint16_t. Comprobado con g++ antes de escribir esto.
static_assert(sizeof(pdu_plano) == 4);

void bien_struct_sin_string(int sd) {
    pdu_plano p{};
    write_n(sd, &p, sizeof(p));
}

// --- D: sizeof(argv[i]) ---

void bug_sizeof_argv(int argc, char** argv) {
    uint16_t longitud = sizeof(argv[1]);
    (void)longitud;
}

void bien_strlen_argv(int argc, char** argv) {
    uint16_t longitud = strlen(argv[1]);
    (void)longitud;
}

// --- E: sizeof(contenedor) en vez de .size() ---

void bug_sizeof_string(const std::string& texto) {
    uint16_t n = sizeof(texto);
    (void)n;
}

void bien_size_string(const std::string& texto) {
    uint16_t n = texto.size();
    (void)n;
}

void bien_sizeof_array(const std::array<char, 8>& datos) {
    // std::array queda excluido a propósito: sizeof sí da el contenido real.
    uint16_t n = sizeof(datos);
    (void)n;
}
