#include <sys/socket.h>
#include <unistd.h>
#include <cstddef>

// Función propia con un nombre distinto a "read_n" — sin guion bajo,
// con mayúscula, lo que sea. NO está en la lista IO_FUNCS de la regla.
ssize_t readn(int fd, void* data, size_t n) {
    return read(fd, data, n);
}

void f(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    char buf[64];
    readn(sd, buf, sizeof(buf)); // bug: debería ser csd, y "readn" ni está en IO_FUNCS
}
