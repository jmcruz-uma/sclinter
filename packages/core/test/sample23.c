#include <unistd.h>

void f(char* buffer) {
    read(0, buffer, 8);
}

ssize_t read_n(int fd, void* data, size_t n);
void g(char* buffer) {
    read_n(0, buffer, 8);
}
