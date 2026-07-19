#include <string>
#include <unistd.h>
#include <vector>
#include <sys/socket.h>
#include <cstddef>

ssize_t read_n(int fd, void* data, size_t n);

void bug_read(int fd) {
    std::string buffer;
    buffer.resize(10);
    read(fd, buffer.data(), 10);
}

void bug_recv(int sd) {
    std::string buffer;
    buffer.resize(10);
    recv(sd, buffer.data(), 10, 0);
}

void bug_read_n(int fd) {
    std::string buffer;
    buffer.resize(10);
    read_n(fd, buffer.data(), 10);
}

void bien_send_string_como_origen(int sd) {
    // El string es ORIGEN aquí, no destino — permitido, no requiere
    // resize() previo, solo se lee contenido que ya existe.
    std::string buffer = "hola";
    send(sd, buffer.data(), 4, 0);
}

void bien_write_string_como_origen(int fd) {
    std::string buffer = "hola";
    write(fd, buffer.data(), buffer.size());
}

void bien_vector(int fd) {
    std::vector<char> buffer(10);
    read(fd, buffer.data(), 10);
}

void bug_read_string_data_con_offset(int fd) {
    std::string almacen;
    almacen.resize(10);
    read(fd, almacen.data() + 1, 9);
}
