#include <string>
#include <vector>
#include <cstring>
#include <cstdint>

void bug_operando_invertido(uint8_t dato, size_t offset) {
    std::string almacen;
    std::memcpy(2 + almacen.data(), &dato, sizeof(dato));
}

void bug_offset_variable(uint8_t dato, size_t offset) {
    std::string almacen;
    std::memcpy(almacen.data() + offset, &dato, sizeof(dato));
}

void bien_vector_offset_variable(uint8_t dato, size_t offset) {
    // Control: con std::vector (permitido con .data()), la aritmética
    // de punteros tampoco debe disparar ninguna regla de string.
    std::vector<uint8_t> buffer(16);
    std::memcpy(buffer.data() + offset, &dato, sizeof(dato));
}
