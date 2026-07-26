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

// CORRECTO: la variable de offset lleva Ñ (`tamaño`, típico en código de
// estudiantes españoles) y AVANZA entre memcpys, así que no se pisa nada.
// Controla el falso positivo por identificadores no-ASCII: la regex ASCII
// no reconocía la ñ y no comprobaba la reasignación del offset. No avisa.
void construir_pdu_offset_con_enne() {
    std::array<uint8_t, 100> almacen;
    uint16_t a = 1, b = 2;
    int tamaño = 0;
    std::memcpy(almacen.data() + tamaño, &a, 2);
    tamaño += 2;
    std::memcpy(almacen.data() + tamaño, &b, 2);
}
