#include <array>
#include <vector>
#include <cstdint>
#include <cstring>
#include <unistd.h>
#include <sys/types.h>

ssize_t write_n(int fd, const void* data, size_t n);
ssize_t read_n(int fd, void* data, size_t n);

// --- ALFA: sizeof(&expr) fuera de cualquier llamada de E/S ---
void bug_alfa_direccion(uint16_t valor) {
    size_t n = sizeof(&valor);
    (void)n;
}

// --- ALFA: sizeof(puntero-variable) fuera de cualquier llamada de E/S ---
void bug_alfa_variable_puntero(char* texto) {
    size_t n = sizeof(texto);
    (void)n;
}

// --- ALFA: el ejemplo real que dio Jesús ---
void bug_alfa_argv2(int argc, char** argv) {
    size_t longitud = sizeof(argv[2]);
    (void)longitud;
}

// --- CORRECTO: sizeof sobre un valor no-puntero ---
void bien_alfa_no_puntero(uint16_t valor) {
    size_t n = sizeof(valor);
    (void)n;
}

// --- BETA: .size() a pelo, elementos de 2 bytes, como tamaño de write_n ---
void bug_beta_vector_uint16(int sd) {
    std::vector<uint16_t> datos(10);
    write_n(sd, datos.data(), datos.size());
}

// --- BETA: mismo caso con std::array y memcpy ---
void bug_beta_array_uint32(char* destino) {
    std::array<uint32_t, 5> datos{};
    memcpy(destino, datos.data(), datos.size());
}

// --- CORRECTO: elementos de 1 byte, .size() a pelo está bien ---
void bien_beta_elementos_byte(int sd) {
    std::array<uint8_t, 10> datos{};
    write_n(sd, datos.data(), datos.size());
}

// --- CORRECTO: u_int8_t (spelling BSD/GNU) también es de 1 byte ---
void bien_beta_u_int8_t(int sd) {
    std::array<u_int8_t, 10> datos{};
    read_n(sd, datos.data(), datos.size());
}

// --- CORRECTO: hay aritmética de por medio, no se avisa a propósito ---
void bien_beta_con_aritmetica(int sd) {
    std::vector<uint16_t> datos(10);
    write_n(sd, datos.data(), datos.size() * sizeof(uint16_t));
}
