#include <cstdint>
#include <cstddef>
#include <sys/types.h>

// sample31 — struct-sin-static-assert con declaración COMBINADA
// (`struct T { ... } var;`, tipo y variable en la misma sentencia).
//
// Antes se le escapaba: en esa forma, el campo `type` de la declaración
// es el struct_specifier ENTERO (cuerpo incluido), no un type_identifier,
// así que declaredTypeOf() devolvía toda la definición como "tipo" y no
// casaba con el nombre del struct. Debe avisar igual que la forma
// separada (`T var;`). Caso real observado en una entrega de examen.

ssize_t write_n(int fd, const void* data, size_t n);

// DEBE disparar: struct plano combinado, enviado entero con write_n,
// sin ningún static_assert(sizeof(Pdu) == N). Por el padding entre
// id_slot (1 byte) e info (4 bytes, alineado a 4), sizeof(Pdu) es 8, no 6.
ssize_t envia(int sd) {
    struct Pdu {
        uint8_t tipo;
        uint8_t id_slot;
        uint32_t info;
    } pdu;
    pdu.tipo = 0x01;
    pdu.id_slot = 3;
    pdu.info = 0;
    return write_n(sd, &pdu, sizeof(pdu));
}

// Control: MISMA forma combinada, pero con static_assert del tamaño en
// el fichero. NO debe disparar — la exclusión por tamaño verificado
// tiene que seguir funcionando también con la declaración combinada.
struct Cabecera {
    uint8_t a;
    uint8_t b;
} cab;
static_assert(sizeof(Cabecera) == 2);

ssize_t envia_ok(int sd) {
    cab.a = 1;
    cab.b = 2;
    return write_n(sd, &cab, sizeof(cab));
}
