#include <cstdint>
#include <cstring>
#include <unistd.h>

uint16_t htons(uint16_t x);
ssize_t read_n(int fd, void* data, size_t n);

// Offset RECIBIDO de la red y convertido: se usa para indexar un buffer
// al analizar un mensaje entrante. Esto debe ser CORRECTO (no avisar).
void bien_offset_en_recepcion(int fd, char* buffer) {
    uint16_t pos;
    read_n(fd, &pos, sizeof(pos));
    pos = htons(pos);
    char valor = buffer[pos];
    (void)valor;
}

// Offset calculado LOCALMENTE (nunca recibido) y convertido, usado para
// indexar un buffer. Esto SÍ debe avisar, sea contexto de envío o de
// "recepción" (el origen del dato es lo que importa, no la palabra que
// usemos para describir la función).
void bug_offset_local_usado_como_si_fuera_de_red(const char* texto, char* buffer) {
    uint16_t pos = strlen(texto);
    pos = htons(pos);
    char valor = buffer[pos];
    (void)valor;
}
