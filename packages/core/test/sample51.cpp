#include <cstring>
#include <cstdint>
#include <array>
#include <sys/types.h>

// sample51 — envio-de-buffer-sin-rellenar.
//
// La regla persigue la CONSECUENCIA (se manda memoria sin escribir), no la
// intención, que es inadivinable: los dos casos reales del corpus llegan al
// mismo sitio por caminos distintos — uno no rellena nada y el otro rellena
// el buffer equivocado.
//
// NOTA sobre el compilador: de los tres casos con bug de este fichero, g++
// -Wall solo caza el primero (-Wmaybe-uninitialized sobre `suscripcion`).
// No dice nada del que rellena el buffer equivocado ni del struct con solo
// algunos campos inicializados, que es donde esta regla aporta.

ssize_t write_n(int fd, const void *buf, size_t n);
ssize_t read_n(int fd, void *buf, size_t n);
void rellena_pdu(void *destino);

struct Pdu {
    uint8_t tipo;
    uint8_t slot;
    uint32_t info;
};

struct PduConValores {          // TODOS los campos con inicializador
    uint8_t tipo = 0;
    uint8_t slot = 0;
    uint32_t info = 0;
};

struct PduAMedias {             // solo ALGUNOS: sigue siendo un error
    uint8_t tipo = 1;
    uint8_t slot;
    uint32_t info;
};

// Los exige struct-sin-static-assert; se ponen para que este fichero no
// arrastre avisos de otras reglas. Los tamaños los confirma el compilador,
// no se calculan de memoria (hay padding entre slot e info).
static_assert(sizeof(Pdu) == 8);
static_assert(sizeof(PduConValores) == 8);
static_assert(sizeof(PduAMedias) == 8);

// ============================================================
// Deben AVISAR
// ============================================================

// Caso de alumno_018: se declara la PDU y se envía sin tocarla.
void struct_sin_rellenar(int sd) {
    Pdu suscripcion;
    write_n(sd, &suscripcion, sizeof(suscripcion));
}

// Caso de alumno_011: rellena un buffer y envía OTRO. El despiste es de
// nombres, pero la consecuencia es comprobable.
void rellena_uno_y_envia_otro(int sd, uint16_t valor) {
    std::array<char, 10> almacen;
    std::array<char, 10> envio;
    std::memcpy(almacen.data(), &valor, 2);
    std::memcpy(almacen.data() + 2, &valor, 2);
    write_n(sd, envio.data(), 6);
}

// Struct con inicializador en SOLO algunos campos: los otros dos siguen
// llevando basura, así que se avisa igual.
void struct_a_medias(int sd) {
    PduAMedias pdu;
    write_n(sd, &pdu, sizeof(pdu));
}

// ============================================================
// Deben CALLAR
// ============================================================

// Lo normal: rellenar y enviar.
void rellenado_con_memcpy(int sd, uint16_t valor) {
    std::array<char, 6> mensaje;
    std::memcpy(mensaje.data(), &valor, 2);
    write_n(sd, mensaje.data(), 6);
}

// Reenvío de lo recibido.
void rellenado_con_read(int sd, int otro_fd) {
    std::array<char, 6> mensaje;
    read_n(otro_fd, mensaje.data(), 6);
    write_n(sd, mensaje.data(), 6);
}

// Declaración con inicializador: el buffer queda en un estado conocido.
void declarado_con_inicializador(int sd) {
    Pdu pdu{};
    write_n(sd, &pdu, sizeof(pdu));
}

// Struct con TODOS los campos inicializados por defecto.
void struct_con_todos_los_valores(int sd) {
    PduConValores pdu;
    write_n(sd, &pdu, sizeof(pdu));
}

// Se pasa a otra función que puede rellenarlo. No hace falta ninguna
// excepción para esto: el identificador aparece y el caso se descarta solo.
void rellenado_por_otra_funcion(int sd) {
    Pdu pdu;
    rellena_pdu(&pdu);
    write_n(sd, &pdu, sizeof(pdu));
}

// Parámetro: lo rellena quien llama, no se mira.
void buffer_recibido_como_parametro(int sd, std::array<char, 6> &mensaje) {
    write_n(sd, mensaje.data(), 6);
}

int main() {
    return 0;
}
