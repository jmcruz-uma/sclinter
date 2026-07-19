#include <string.h>
#include <unistd.h>
#include <stdint.h>

ssize_t write_n(int fd, void* data, size_t n);

// Caso 1: rellena, envía, rellena de nuevo (sin bucle) — correcto.
void bien_caso_secuencial(int sd, uint8_t tipo1, uint8_t tipo2) {
    char pdu[6];
    memcpy(pdu, &tipo1, 1);
    write_n(sd, pdu, sizeof(pdu));
    memcpy(pdu, &tipo2, 1);
}

// Caso 2: rellena antes del bucle, dentro del bucle envía y rellena de
// nuevo — correcto.
void bien_caso_bucle(int sd, uint8_t tipo) {
    char memoria[6];
    memcpy(memoria, &tipo, 1);
    for (int i = 0; i < 3; i++) {
        write_n(sd, memoria, sizeof(memoria));
        memcpy(memoria, &tipo, 1);
    }
}

// Control: rellena dos veces SIN enviar entre medias — sigue siendo un
// bug real, debe avisar.
void bug_sin_enviar_entre_medias(uint8_t tipo1, uint8_t tipo2) {
    char pdu[6];
    memcpy(pdu, &tipo1, 1);
    memcpy(pdu, &tipo2, 1);
}
