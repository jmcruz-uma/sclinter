#include <cstdint>
#include <cstring>
#include <bit>
#include <sys/types.h>

// sample37 — byteswap-uso-local-incorrecto: ramas mutuamente excluyentes.
// Una mutación que vive en una rama de un if/else NO puede afectar a un uso
// que vive en la rama HERMANA (nunca se ejecutan las dos). Pero sí afecta a
// un uso posterior al if completo. Los dos casos, juntos, fijan el límite.

ssize_t read_n(int fd, void *data, size_t n);
ssize_t write_n(int fd, const void *data, size_t n);

// CALLA: el byteswap "de vuelta a red" está en la rama `if` (para enviar) y
// el uso está en el `else if` HERMANO, donde len sigue en orden de host
// porque esa rama no se ejecutó. Caso real de una entrega de examen.
void bien_ramas_hermanas(int fd, uint16_t otra) {
    uint16_t len;
    read_n(fd, &len, 2);
    if (std::endian::native == std::endian::little) {
        len = std::byteswap(len); // red → host
    }

    if (len > otra) {
        if (std::endian::native == std::endian::little) {
            len = std::byteswap(len); // host → red, solo para enviarlo
        }
        write_n(fd, &len, 2);
    } else if (otra > len) { // len sigue en orden de host aquí: NO debe avisar
        write_n(fd, &otra, 2);
    }
}

// AVISA: el mismo byteswap dentro de un `if`, pero el uso viene DESPUÉS del
// if completo — ahí sí se ejecutó, y len queda en orden de red usada como
// tamaño local. Es un bug real y la excepción de ramas no debe taparlo.
void bug_uso_despues_del_if(int fd, const char *origen, char *destino) {
    uint16_t len;
    read_n(fd, &len, 2);
    if (std::endian::native == std::endian::little) {
        len = std::byteswap(len); // red → host
    }

    if (std::endian::native == std::endian::little) {
        len = std::byteswap(len); // host → red, para enviarlo
    }
    write_n(fd, &len, 2);

    memcpy(destino, origen, len); // BUG: len está en orden de red
}
