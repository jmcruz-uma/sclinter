#include <cstdint>
#include <cstring>
#include <bit>
#include <unistd.h>

uint16_t htons(uint16_t x);
uint16_t ntohs(uint16_t x);
ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);

// sample34 — rediseño de byteswap-uso-local-incorrecto por ORDEN DE BYTES
// (origen red/host + paridad de conversiones), no por "fue destino directo
// de read". El aviso salta solo si en el punto de uso el valor está en
// orden de RED y llegó ahí por al menos una conversión.

// CALLA: recepción vía variable intermedia. El valor viene de la red y se
// convierte a host antes de usarlo (idioma de la solución de referencia).
void bien_recepcion_variable_intermedia(int fd, char* buffer) {
    uint16_t num_be;
    read_n(fd, &num_be, 2);
    uint16_t num = std::byteswap(num_be);   // red -> host
    for (uint16_t i = 0; i < num; i++) buffer[i] = 0;
}

// CALLA: recepción vía extracción con memcpy desde un buffer leído de red.
void bien_recepcion_memcpy(int fd, char* buffer) {
    uint8_t almacen[64];
    read_n(fd, almacen, sizeof(almacen));
    uint16_t longitud;
    memcpy(&longitud, almacen, 2);
    longitud = std::byteswap(longitud);      // red -> host
    memcpy(buffer, almacen + 2, longitud);
}

// CALLA: campo de struct leído de red y convertido (misma función).
struct Mensaje { uint16_t num; uint16_t lon; };
void bien_recepcion_campo_struct(int fd, char* buffer) {
    Mensaje m;
    read_n(fd, &m.num, 2);
    uint16_t n = ntohs(m.num);               // campo de red -> host
    for (uint16_t i = 0; i < n; i++) buffer[i] = 0;
}

// CALLA: valor de red usado SIN convertir (0 conversiones) — no es asunto
// de esta regla (p. ej. un campo de 1 byte donde el orden es irrelevante).
void bien_red_sin_convertir(int fd, char* buffer) {
    uint16_t longitud;
    read_n(fd, &longitud, 2);
    memcpy(buffer, buffer + 2, longitud);
}

// AVISA: origen local, convertido a orden de red, usado como tamaño (envío).
void bug_envio_local(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = std::byteswap(longitud);      // host -> red
    memcpy(buffer, texto, longitud);
}

// AVISA: valor recibido de red, reconvertido a orden de red para reenviarlo
// y luego usado en un bucle local (estilo alumno_053): dos conversiones,
// queda en orden de red en el uso.
void bug_reenvio_usado_en_bucle(int fd, char* buffer) {
    uint16_t num_be;
    read_n(fd, &num_be, 2);
    uint16_t num = std::byteswap(num_be);    // red -> host
    uint16_t num_envio = num;
    num_envio = std::byteswap(num_envio);    // host -> red (para enviar)
    write_n(fd, &num_envio, 2);
    for (uint16_t i = 0; i < num_envio; i++) buffer[i] = 0;  // bug: usa el de red
}
