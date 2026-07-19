#include <cstring>
#include <cstdint>
#include <array>

void construir_pdu_orden_bien_offset_mal() {
    std::array<char, 2> mensaje;

    uint8_t tipo = 0x01;
    std::memcpy(mensaje.data(), &tipo, 1);

    uint8_t slot = 1;
    std::memcpy(mensaje.data(), &slot, 1);
}
