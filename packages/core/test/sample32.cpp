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

// --- Patrón A bis: el origen es un CAMPO DE STRUCT, no una variable suelta ---

struct DatosCliente { uint16_t puerto; uint16_t otro; };

// Correcto — el puerto convertido se guarda en un campo de la struct del
// estudiante y se asigna desde ahí. No debe avisar.
void bien_origen_campo_struct(struct sockaddr_in& dir, const char* p) {
    DatosCliente cliente{};
    cliente.puerto = htons(std::stoi(p));
    dir.sin_port = cliente.puerto;
}

// Correcto — igual pero a través de un puntero (`->`). No debe avisar.
void bien_origen_campo_por_puntero(struct sockaddr_in& dir, DatosCliente* cliente, const char* p) {
    cliente->puerto = htons(std::stoi(p));
    dir.sin_port = cliente->puerto;
}

// Control: el campo origen NO se convierte. Debe avisar.
void bug_origen_campo_sin_convertir(struct sockaddr_in& dir, const char* p) {
    DatosCliente cliente{};
    cliente.puerto = std::stoi(p);
    dir.sin_port = cliente.puerto;
}

// Control CLAVE de que no nos hemos vuelto permisivos: se convierte OTRO
// campo de la misma struct, no el que se asigna. Debe avisar — si la
// comparación mirase solo el objeto base (`cliente`) y no el campo, aquí
// se callaría.
void bug_origen_campo_distinto(struct sockaddr_in& dir, const char* p) {
    DatosCliente cliente{};
    cliente.otro = htons(std::stoi(p));
    cliente.puerto = std::stoi(p);
    dir.sin_port = cliente.puerto;
}

// Control: `.` y `->` no se confunden — se convierte `cliente->puerto` pero
// se asigna desde `cliente.puerto` (otro objeto). Debe avisar.
void bug_origen_punto_vs_flecha(struct sockaddr_in& dir, DatosCliente* c, const char* p) {
    DatosCliente cliente{};
    c->puerto = htons(std::stoi(p));
    cliente.puerto = std::stoi(p);
    dir.sin_port = cliente.puerto;
}

// --- Patrón D: la guarda de endianness es una BANDERA bool asignada ---

// Correcto — la comprobación de endianness no está en el inicializador de la
// bandera (que es `false`) sino en una asignación posterior. No debe avisar.
void bien_bandera_asignada(struct sockaddr_in& dir, const char* p) {
    bool soylittle = false;
    if (std::endian::native == std::endian::little) {
        soylittle = true;
    }
    dir.sin_port = std::stoi(p);
    if (soylittle) {
        dir.sin_port = std::byteswap(dir.sin_port);
    }
}

// Control del CERROJO (1/2): la bandera se asigna dentro de un if que NO es
// de endianness. `if (bandera)` no es una guarda de endianness. Debe avisar.
void bug_bandera_no_es_de_endianness(struct sockaddr_in& dir, const char* p, int n) {
    bool bandera = false;
    if (n > 3) {
        bandera = true;
    }
    dir.sin_port = std::stoi(p);
    if (bandera) {
        dir.sin_port = std::byteswap(dir.sin_port);
    }
}

// Control del CERROJO (2/2): se asigna dentro de un if de endianness, pero la
// variable no está declarada `bool` — no es una bandera. Debe avisar.
void bug_bandera_no_es_bool(struct sockaddr_in& dir, const char* p) {
    int contador = 0;
    if (std::endian::native == std::endian::little) {
        contador = 1;
    }
    dir.sin_port = std::stoi(p);
    if (contador) {
        dir.sin_port = std::byteswap(dir.sin_port);
    }
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
