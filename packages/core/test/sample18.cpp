#include <cstdint>
#include <cstring>
#include <unistd.h>

uint16_t htons(uint16_t x);
uint32_t htonl(uint32_t x);
uint32_t ntohl(uint32_t x);
ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);

// --- BUG: valor local (strlen), convertido una vez, usado como tamaño ---
void bug_tamano_memcpy(int fd, const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(buffer, texto, longitud);
}

// --- BUG: valor local, convertido una vez, usado como límite de bucle ---
void bug_limite_bucle(int argc, char** argv) {
    uint16_t n = argc - 1;
    n = htons(n);
    for (uint16_t i = 0; i < n; i++) {
    }
}

// --- BUG: valor local, convertido una vez, usado para avanzar un offset ---
void bug_offset(const char* texto) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    uint16_t offset = 0;
    offset += longitud;
}

// --- CORRECTO: la variable SÍ vino de la red (read_n) — impar es lo correcto ---
void bien_recibido_de_red(int fd, char* buffer) {
    uint16_t longitud;
    read_n(fd, &longitud, sizeof(longitud));
    longitud = htons(longitud);
    read_n(fd, buffer, longitud);
}

// --- CORRECTO: convertido dos veces (par) antes de usarlo — vuelve al original ---
void bien_conversion_par(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    longitud = htons(longitud);
    memcpy(buffer, texto, longitud);
}

// --- CORRECTO: nunca se convierte, se usa el valor local tal cual ---
void bien_sin_convertir(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    memcpy(buffer, texto, longitud);
}

// --- BUG: límite de un while ---
void bug_limite_while(const char* texto) {
    uint16_t restante = strlen(texto);
    restante = htons(restante);
    while (restante > 0) {
        restante--;
    }
}

// --- BUG: límite de un do-while (envoltorio distinto: parenthesized_expression) ---
void bug_limite_do_while(const char* texto) {
    uint16_t restante = strlen(texto);
    restante = htons(restante);
    do {
        restante--;
    } while (restante > 0);
}

// --- BUG: comparación suelta en un if ---
void bug_comparacion_suelta(const char* texto) {
    uint32_t longitud = strlen(texto);
    longitud = htonl(longitud);
    if (longitud > 1000) {
    }
}

// --- BUG: htonl/ntohl, no solo htons/ntohs ---
void bug_htonl(const char* texto, char* buffer) {
    uint32_t longitud = strlen(texto);
    longitud = ntohl(longitud);
    memcpy(buffer, texto, longitud);
}

// --- CORRECTO: while con variable recibida de la red (impar es correcto) ---
void bien_while_recibido(int fd, char* buffer) {
    uint16_t restante;
    read_n(fd, &restante, sizeof(restante));
    restante = htons(restante);
    while (restante > 0) {
        restante--;
    }
}

// --- BUG: offset byteswapeado usado como desplazamiento en .data() + X ---
void bug_offset_byteswapeado_en_desplazamiento(const char* texto, char* buffer) {
    uint16_t pos = strlen(texto);
    pos = htons(pos);
    memcpy(buffer + pos, texto, 1);
}

// --- BUG: mismo caso con array[X] ---
void bug_offset_byteswapeado_en_indice(const char* texto, char* buffer) {
    uint16_t pos = strlen(texto);
    pos = htons(pos);
    buffer[pos] = 0;
}
