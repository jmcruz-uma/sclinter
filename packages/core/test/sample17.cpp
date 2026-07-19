// Confirma que memcpy sin cualificar, std::memcpy y ::memcpy se detectan
// igual — todas las reglas del catálogo usan el mismo patrón /(^|::)nombre$/
// para reconocer llamadas, así que este test protege a todas de golpe.
#include <cstring>
#include <cstdint>

void bug_memcpy_a_secas(char* buffer, const uint32_t& valor) {
    memcpy(buffer, &valor, sizeof(buffer));
}

void bug_std_memcpy(char* buffer, const uint32_t& valor) {
    std::memcpy(buffer, &valor, sizeof(buffer));
}

void bug_global_memcpy(char* buffer, const uint32_t& valor) {
    ::memcpy(buffer, &valor, sizeof(buffer));
}
