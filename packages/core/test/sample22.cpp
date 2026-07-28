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

// --- BETA: el TAMAÑO del contenedor no es un literal ---
// El tipo de elemento se resuelve sobre el árbol, así que da igual la forma
// que tenga el tamaño. Antes se sacaba con una regex que solo contemplaba un
// literal decimal y estos contenedores de 1 byte se leían como si no lo
// fueran, avisando sobre código correcto.

#define TAM_BUFFER 64

// CORRECTO: elementos de 1 byte, tamaño con sizeof. No debe avisar.
void bien_beta_tamano_sizeof(int sd, char** argv) {
    std::array<char, sizeof(uint32_t) * 2> datos{};
    write_n(sd, datos.data(), datos.size());
    (void)argv;
}

// CORRECTO: elementos de 1 byte, tamaño con una constante con nombre.
// No debe avisar.
void bien_beta_tamano_constante(int sd) {
    std::array<uint8_t, TAM_BUFFER> datos{};
    read_n(sd, datos.data(), datos.size());
}

// CORRECTO: elementos de 1 byte, tamaño con aritmética. No debe avisar.
void bien_beta_tamano_aritmetico(int sd) {
    const int n = 10;
    std::array<char, n + 1> datos{};
    write_n(sd, datos.data(), datos.size());
}

// Control: mismo tamaño no literal, pero elementos de 4 bytes. DEBE avisar —
// si el arreglo se hubiera pasado de permisivo callando ante cualquier tamaño
// que no sepa leer, este caso se perdería.
void bug_beta_tamano_sizeof_no_byte(int sd) {
    std::array<uint32_t, sizeof(uint32_t)> datos{};
    write_n(sd, datos.data(), datos.size());
}

// Control: tamaño con constante con nombre y elementos de 2 bytes. DEBE avisar.
void bug_beta_tamano_constante_no_byte(int sd) {
    std::array<uint16_t, TAM_BUFFER> datos{};
    read_n(sd, datos.data(), datos.size());
}
