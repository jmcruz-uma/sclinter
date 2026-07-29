#include <string>
#include <vector>
#include <array>
#include <unistd.h>
#include <sys/socket.h>
#include <cstddef>

ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);
// Los estudiantes reescriben los helpers de la referencia con otros nombres
// (en dos convocatorias, más de la mitad de la clase usa la forma sin guion
// bajo). Todos los checkers los reconocen desde `funcionesDeES.ts`.
ssize_t readn(int fd, void* data, size_t n);
ssize_t writen(int fd, const void* data, size_t n);
ssize_t readN(int fd, void* data, size_t n);
ssize_t write_N(int fd, const void* data, size_t n);

void bug_read_string(int fd) {
    std::string buffer;
    read(fd, &buffer, 10);
}

void bug_read_n_string(int fd) {
    // read_n es la función propia del curso — debe reconocerse explícitamente.
    std::string buffer;
    read_n(fd, &buffer, 10);
}

void bug_write_n_vector(int fd) {
    std::vector<char> buffer(10);
    write_n(fd, &buffer, 10);
}

void bug_recv_vector(int sd) {
    std::vector<char> buffer(10);
    recv(sd, &buffer, 10, 0);
}

void bug_send_string(int sd) {
    std::string buffer = "hola";
    send(sd, &buffer, 4, 0);
}

void estilo_array_direccion(int fd) {
    std::array<char, 10> buffer{};
    // Correcto técnicamente, pero se marca por estilo.
    read_n(fd, &buffer, 10);
}

void bien_string(int fd) {
    std::string buffer;
    buffer.resize(10);
    read(fd, buffer.data(), 10);
}

void bien_vector(int fd) {
    std::vector<char> buffer(10);
    read(fd, buffer.data(), 10);
}

void bien_array(int fd) {
    std::array<char, 10> buffer{};
    read(fd, buffer.data(), 10);
}

// --- Las MISMAS faltas, con los helpers escritos de otra forma -------------
// Sin la fuente única de nombres, estas cuatro pasaban en silencio.

void bug_readn_sin_guion(int fd) {
    std::string buffer;
    readn(fd, &buffer, 10);
}

void bug_writen_sin_guion(int fd) {
    std::vector<char> buffer(10);
    writen(fd, &buffer, 10);
}

void bug_readN_mayuscula(int fd) {
    std::string buffer;
    readN(fd, &buffer, 10);
}

void bug_write_N_mayuscula(int fd) {
    std::vector<char> buffer(10);
    write_N(fd, &buffer, 10);
}
