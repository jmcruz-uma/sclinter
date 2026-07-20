#include <array>
#include <unistd.h>
#include <cstddef>

// sample33 — pipe-extremos-invertidos con tubería declarada como
// std::array<int,2> y creada con pipe(arr.data()) (patrón del plan nuevo,
// visto en entregas reales de examen). Antes se escapaba: findPipeArrayNames
// solo reconocía pipe(fd) con fd identificador (C-array), no pipe(arr.data()),
// así que el array no se registraba como tubería y no se comprobaba ningún
// extremo. La detección del extremo (arr[0]/arr[1]) ya funcionaba con
// std::array; solo faltaba identificar el array.

ssize_t write_n(int fd, const void* data, size_t n);
ssize_t read_n(int fd, void* data, size_t n);

std::array<int, 2> fd_pipe;

// DEBE disparar: escribe en el extremo de LECTURA (índice 0).
void manejadora(int signum) {
    write_n(fd_pipe[0], &signum, sizeof(int));
}

// DEBE disparar: lee del extremo de ESCRITURA (índice 1).
int lee_mal() {
    int signum;
    return read_n(fd_pipe[1], &signum, sizeof(int));
}

// Control: uso correcto de ambos extremos — NO debe disparar.
void correcto(int signum) {
    int s;
    write_n(fd_pipe[1], &signum, sizeof(int));  // escribe en [1]: bien
    read_n(fd_pipe[0], &s, sizeof(int));         // lee de [0]: bien
}

int main() {
    pipe(fd_pipe.data());
    return 0;
}
