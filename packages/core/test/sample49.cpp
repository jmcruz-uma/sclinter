#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <sys/types.h>

// sample49 — struct-con-contenedor-direccion con resolución de ÁMBITO.
// Cuarta regla de la familia que adopta checkers/scopeResolution.ts
// (sample46, sample47 y sample48 son las anteriores).

ssize_t read_n(int fd, void *data, size_t n);

struct Pdu {
    uint8_t tipo;
    std::string texto;          // campo con memoria en el heap
};

struct Lista {
    uint16_t cuantos;
    std::vector<uint16_t> valores;
};

// ============================================================
// Deben CALLAR
// ============================================================

// Un escalar declarado dentro de un bloque sombrea al struct de la función.
// El uso de fuera del bloque sí es el struct y sigue avisando.
void sombreado_en_bloque_interno(int fd, int cond) {
    Pdu pdu;
    if (cond) {
        uint32_t pdu;                 // variable DISTINTA, mismo nombre
        read_n(fd, &pdu, 4);          // silencio: es un uint32_t
        (void)pdu;
    }
    read_n(fd, &pdu, 8);              // AVISA: aquí pdu es el struct
}

// Struct SIN campos de contenedor: volcarlo entero es correcto y esta regla
// no es la que se ocupa de él.
struct PduPlana {
    uint8_t tipo;
    uint16_t secuencia;
};
// El static_assert lo exige struct-sin-static-assert; se pone para que este
// fichero no arrastre avisos de otras reglas. El tamaño lo confirma el
// compilador, no se calcula de memoria (hay padding entre los dos campos).
static_assert(sizeof(PduPlana) == 4);

void struct_plana(int fd) {
    PduPlana pdu;
    read_n(fd, &pdu, sizeof(pdu));
}

// Un campo ARRAY sí se puede enviar entero: los bytes están dentro del struct,
// no detrás de un puntero. No debe avisar (se distingue por el declarador:
// array_declarator, no pointer_declarator).
struct PduConArray {
    uint16_t tam;
    char nombre[16];
};
static_assert(sizeof(PduConArray) == 18);

void struct_con_array(int fd) {
    PduConArray pdu;
    read_n(fd, &pdu, sizeof(pdu));
}

// ============================================================
// Deben AVISAR
// ============================================================

void struct_con_string(int fd) {
    Pdu pdu;
    read_n(fd, &pdu, 8);
}

// Campo PUNTERO CRUDO: enviar el struct manda la dirección, que al otro lado
// no significa nada. Es el mismo error que con std::string, escrito de otra
// forma, y así se vio en una entrega real. El mensaje debe hablar de punteros,
// no de contenedores.
struct PduConPuntero {
    uint16_t tam;
    char *nombre;
};
static_assert(sizeof(PduConPuntero) == 16);

void struct_con_puntero(int fd) {
    PduConPuntero pdu;
    read_n(fd, &pdu, sizeof(pdu));
}

void struct_con_vector(int fd) {
    Lista lista;
    read_n(fd, &lista, 8);
}

// Struct recibido como parámetro por referencia (ámbito exterior).
void struct_como_parametro(int fd, Pdu &pdu) {
    read_n(fd, &pdu, 8);
}

// Dos structs declarados en la misma sentencia.
void dos_structs_en_una_declaracion(int fd) {
    Pdu uno, dos;
    read_n(fd, &uno, 8);
    read_n(fd, &dos, 8);
}

int main() {
    return 0;
}
