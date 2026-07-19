#include <unistd.h>
#include <iostream>
#include <cstdint>
#include <cstddef>

ssize_t read_n(int fd, void* data, size_t n);

void bug_read_teclado_numero_literal() {
    int numero;
    read(0, &numero, sizeof(numero));
}

void bug_read_teclado_numero_stdin_fileno() {
    uint16_t puerto;
    read(STDIN_FILENO, &puerto, sizeof(puerto));
}

void bug_read_teclado_buffer_de_bytes() {
    // Ya no es "correcto por no ser numérico": prohibido igual, por
    // normativa de la asignatura (motivo: falta de '\0', riesgo de acabar
    // en un std::string, etc.), no por el tipo del destino.
    char buffer[64];
    read(0, buffer, sizeof(buffer));
}

void bien_read_teclado_con_cin() {
    int numero;
    std::cin >> numero;
}

void bien_read_socket_numero(int sd) {
    // No es teclado (fd distinto de 0/STDIN_FILENO): no debe marcarse.
    int numero;
    read(sd, &numero, sizeof(numero));
}

void bug_read_n_en_teclado() {
    char buffer[16];
    read_n(0, buffer, sizeof(buffer));
}

void bug_read_n_en_teclado_stdin_fileno() {
    char buffer[16];
    read_n(STDIN_FILENO, buffer, sizeof(buffer));
}

void bien_read_n_en_socket(int sd) {
    char buffer[16];
    read_n(sd, buffer, sizeof(buffer));
}
