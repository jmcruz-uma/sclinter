#include <cstring>
#include <cstdint>

struct PDU {
    uint16_t tipo;
    uint32_t longitud;
};

void construir_pdu_bien(char* buffer, const PDU& pdu) {
    // Correcto: se copian sizeof(pdu) bytes, el tamaño del origen
    std::memcpy(buffer, &pdu, sizeof(pdu));
}

void construir_pdu_mal(char* buffer, const PDU& pdu) {
    // Bug típico: sizeof aplicado a buffer (puntero -> 8 bytes en x86-64)
    // en vez de al struct que realmente se está copiando
    std::memcpy(buffer, &pdu, sizeof(buffer));
}

void otro_caso_mal(uint8_t* dst, const PDU& origen, size_t n) {
    // Bug: se pasa sizeof(origen) pero el destino declarado es dst,
    // y dst no es lo que se está midiendo con sizeof
    std::memcpy(dst, &origen, sizeof(dst));
}
