#include <bit>
#include <cstdint>
#include <string>
#include <netinet/in.h>

// sample32 — sin-port-no-htons: tres patrones CORRECTOS que antes daban
// falso positivo (vistos en entregas reales de examen), más sus controles
// hermanos que SÍ deben seguir avisando.

// --- Patrón A: conversión sobre la VARIABLE ORIGEN antes de asignar ---

// Correcto — puerto se convierte con byteswap dentro de un if de
// endianness y LUEGO se asigna a sin_port. No debe avisar.
void bien_origen_convertida_if(struct sockaddr_in& dir, const char* p) {
    uint16_t puerto = std::stoi(p);
    if (std::endian::native == std::endian::little) {
        puerto = std::byteswap(puerto);
    }
    dir.sin_port = puerto;
}

// Correcto — puerto se convierte con htons (incondicional) antes de
// asignarlo. No debe avisar.
void bien_origen_convertida_htons(struct sockaddr_in& dir, uint16_t puerto) {
    puerto = htons(puerto);
    dir.sin_port = puerto;
}

// Control: la variable origen NO se convierte en ningún sitio. Debe avisar.
void bug_origen_sin_convertir(struct sockaddr_in& dir, uint16_t puerto) {
    dir.sin_port = puerto;
}

// Control: la conversión de la variable origen ocurre DESPUÉS de asignar a
// sin_port — el campo se queda con el valor crudo. Debe avisar.
void bug_origen_convertida_despues(struct sockaddr_in& dir, uint16_t puerto) {
    dir.sin_port = puerto;
    puerto = std::byteswap(puerto);
    (void)puerto;
}

// --- Patrón B: espacios alrededor de :: en std :: byteswap ---

// Correcto — igual que byteswap normal, pero con espacios. No debe avisar.
void bien_byteswap_con_espacios(struct sockaddr_in& dir, uint16_t puerto) {
    dir.sin_port = std :: byteswap(puerto);
}

// --- Patrón C: el valor viene de una función propia del estudiante ---

uint16_t a_orden_de_red(uint16_t v) {
    if (std::endian::native == std::endian::little) return std::byteswap(v);
    return v;
}

// Correcto (o al menos, no se puede saber sin mirar dentro): el valor sale
// de una función definida en el fichero. No debe avisar.
void bien_funcion_propia(struct sockaddr_in& dir, uint16_t puerto) {
    dir.sin_port = a_orden_de_red(puerto);
}

// Control: el valor sale de una función de biblioteca (stoi), que no
// convierte el orden de bytes. Debe seguir avisando.
void bug_funcion_de_biblioteca(struct sockaddr_in& dir, const char* p) {
    dir.sin_port = std::stoi(p);
}
