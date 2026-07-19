#include <netinet/in.h>
#include <bit>
#include <cstdint>

void f(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = std::byteswap(puerto);
}

void bien_con_htons(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = htons(puerto);
}

void bug_sin_conversion(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = puerto;
}
