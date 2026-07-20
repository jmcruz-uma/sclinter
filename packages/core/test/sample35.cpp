#include <vector>
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <unistd.h>

ssize_t read_n(int fd, void* d, size_t n);
ssize_t write_n(int fd, const void* d, size_t n);

// sample35 — io-vector-data (nivel 1, UB): escribir bytes de red sobre el
// buffer de un std::vector<char|uint8_t|std::byte> VACÍO. Avisa solo si el
// vector está sin dimensionar; recibir a un vector dimensionado es correcto.

// AVISA: vector<char> vacío, destino de read_n.
void bug_vacio_read(int fd) {
    std::vector<char> v;
    read_n(fd, v.data(), 8);
}

// AVISA: vector<uint8_t> vacío, destino de memcpy.
void bug_vacio_memcpy(const void* src) {
    std::vector<uint8_t> v;
    memcpy(v.data(), src, 8);
}

// AVISA: reserve() NO dimensiona (cambia capacidad, no tamaño) → sigue UB.
void bug_reserve_no_vale(int fd) {
    std::vector<char> v;
    v.reserve(8);
    read_n(fd, v.data(), 8);
}

// CALLA: resize() antes de recibir.
void bien_resize(int fd, size_t n) {
    std::vector<char> v;
    v.resize(n);
    read_n(fd, v.data(), n);
}

// CALLA: constructor con tamaño (vector<std::byte> también es buffer de bytes).
void bien_ctor_tamano(int fd, size_t n) {
    std::vector<std::byte> v(n);
    read_n(fd, v.data(), n);
}

// CALLA: asignación antes (el vector deja de estar vacío).
void bien_asignacion(int fd, const std::vector<char>& otro) {
    std::vector<char> v;
    v = otro;
    read_n(fd, v.data(), v.size());
}

// CALLA (fuera de alcance): vector<int> no es un buffer de bytes.
void fuera_alcance_vector_int(int fd) {
    std::vector<int> v;
    read_n(fd, v.data(), 8);
}

// CALLA: en write_n el vector es ORIGEN (se lee de él), no destino.
void bien_origen_write(int fd) {
    std::vector<char> v;
    write_n(fd, v.data(), 0);
}
