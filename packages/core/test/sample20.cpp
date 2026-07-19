#include <cstdint>
#include <cstring>
#include <unistd.h>

ssize_t write_n(int fd, const void* data, size_t n);

struct PDU {
    uint8_t tipo;
    uint16_t seq;
    uint16_t ack;
};

void bug_sin_static_assert(int sd) {
    PDU pdu{};
    write_n(sd, &pdu, sizeof(pdu));
}

struct PDU_verificado {
    uint8_t tipo;
    uint16_t seq;
};
// sizeof(PDU_verificado) es 4, no 3 — 1 byte de relleno antes de seq
// para su alineación de 2 bytes. Comprobado con g++.
static_assert(sizeof(PDU_verificado) == 4);

void bien_con_static_assert(int sd) {
    PDU_verificado pdu{};
    write_n(sd, &pdu, sizeof(pdu));
}

struct PDU_verificado_orden_inverso {
    uint8_t tipo;
};
static_assert(1 == sizeof(PDU_verificado_orden_inverso));

void bien_orden_inverso(int sd) {
    PDU_verificado_orden_inverso pdu{};
    write_n(sd, &pdu, sizeof(pdu));
}
