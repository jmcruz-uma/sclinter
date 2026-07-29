#include <unistd.h>

void f(char* buffer) {
    read(0, buffer, 8);
}

ssize_t read_n(int fd, void* data, size_t n);
void g(char* buffer) {
    read_n(0, buffer, 8);
}

// Familia A: la regla habla de los HELPERS, no de read() a secas, y los
// estudiantes los escriben de varias formas. Las tres avisan igual.
ssize_t readn(int fd, void* data, size_t n);
ssize_t readN(int fd, void* data, size_t n);
ssize_t read_N(int fd, void* data, size_t n);

void h(char* buffer) {
    readn(0, buffer, 8);
}

void i(char* buffer) {
    readN(STDIN_FILENO, buffer, 8);
}

void j(char* buffer) {
    read_N(0, buffer, 8);
}
