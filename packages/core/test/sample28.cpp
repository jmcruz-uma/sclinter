#include <array>
#include <bit>
#include <cstdint>
#include <cstring>
#include <unistd.h>
#include <netinet/in.h>

const uint16_t PUERTO = 54321;
const bool ISLITTLE = (std::endian::native == std::endian::little);

const size_t LONG_OP_PAQUETE = 9;
struct Operacion {
    uint8_t tipo;
    int32_t operand1;
    int32_t operand2;
};

ssize_t write_n(int fd, const void* data, size_t n);

int enviar_operacion(int sd, Operacion &op){
    std::array<uint8_t, LONG_OP_PAQUETE> buffer;
    uint8_t *ptr= buffer.data();
    memcpy(ptr, &op.tipo, sizeof(op.tipo));
    ptr+=sizeof(op.tipo);
    int32_t v = op.operand1;
    if(ISLITTLE) v = std::byteswap(v);
    memcpy(ptr, &v, sizeof(v)); //el linter se queja de reutilizacion del puntero
    ptr += sizeof(v);
    v = op.operand2;
    if(ISLITTLE) v = std::byteswap(v);
    memcpy(ptr, &v, sizeof(v)); //el linter se queja de reutilizacion del puntero
    ptr += sizeof(v);
    int escribir = ptr - buffer.data();
    return write_n(sd, buffer.data(), escribir);
}

void f() {
    sockaddr_in svaddr{};
    svaddr.sin_port = PUERTO; //el linter se queja de esto
    if(ISLITTLE) svaddr.sin_port = std::byteswap(svaddr.sin_port);
}

// Control: una constante booleana que NO tiene relación con endianness
// — la resolución indirecta no debe protegerla. Sigue siendo un bug real.
const bool MODO_DEBUG = true;
void g() {
    sockaddr_in svaddr{};
    svaddr.sin_port = PUERTO; // bug real: MODO_DEBUG no es de endianness
    if (MODO_DEBUG) {
        svaddr.sin_port = std::byteswap(svaddr.sin_port);
    }
}
