#include <array>
#include <cstring>
#include <unistd.h>
#include <cstdint>

ssize_t write_n(int fd, const void* data, size_t n);
size_t strlen(const char* s);

// --- BUG: offset con incremento no constante (strlen), .size() usado en el envío ---
void bug_offset_no_constante(int sd, const char* texto) {
    std::array<char, 2048> almacen;
    size_t pos = 0;
    memcpy(almacen.data() + pos, texto, strlen(texto));
    pos += strlen(texto);
    write_n(sd, almacen.data(), almacen.size());
}

// --- BUG: mismo patrón con &array[pos] en vez de .data()+pos ---
void bug_offset_no_constante_con_corchetes(int sd, const char* texto, size_t longitud) {
    std::array<char, 2048> almacen;
    size_t pos = 0;
    memcpy(&almacen[pos], texto, longitud);
    pos += longitud;
    write_n(sd, almacen.data(), almacen.size());
}

// --- CORRECTO: protocolo de tamaño fijo, offset con incrementos SOLO constantes ---
void bien_offset_constante(int sd, uint8_t tipo, uint16_t seq, uint16_t ack) {
    std::array<uint8_t, 5> pdu;
    size_t pos = 0;
    memcpy(pdu.data() + pos, &tipo, sizeof(tipo));
    pos += sizeof(tipo);
    memcpy(pdu.data() + pos, &seq, sizeof(seq));
    pos += sizeof(seq);
    memcpy(pdu.data() + pos, &ack, sizeof(ack));
    pos += sizeof(ack);
    write_n(sd, pdu.data(), pdu.size());  // pos == 5 == pdu.size(), correcto a propósito
}

// --- CORRECTO: se usa el offset real en el envío, no .size() ---
void bien_usa_el_offset(int sd, const char* texto) {
    std::array<char, 2048> almacen;
    size_t pos = 0;
    memcpy(almacen.data() + pos, texto, strlen(texto));
    pos += strlen(texto);
    write_n(sd, almacen.data(), pos);
}

// --- CORRECTO: sin ningún offset asociado (array de tamaño fijo, sin construir por partes) ---
void bien_sin_offset(int sd) {
    std::array<char, 8> saludo{'h', 'o', 'l', 'a', 0, 0, 0, 0};
    write_n(sd, saludo.data(), saludo.size());
}

// --- Caso de dos arrays con offsets distintos (el ejemplo que discutimos) ---
void bug_dos_arrays(int sd, const char* texto) {
    std::array<char, 2048> cabecera;
    std::array<char, 2048> cuerpo;

    size_t pos_cab = 0;
    memcpy(cabecera.data() + pos_cab, texto, strlen(texto));
    pos_cab += strlen(texto);

    size_t pos_cuerpo = 0;
    memcpy(cuerpo.data() + pos_cuerpo, texto, strlen(texto));
    pos_cuerpo += strlen(texto);

    write_n(sd, cabecera.data(), cabecera.size());
    write_n(sd, cuerpo.data(), cuerpo.size());
}
