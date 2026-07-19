#include <bit>
#include <cstdint>
#include <netinet/in.h>

// Caso C (el real de Jesús): valor por defecto antes del if, sobreescrito
// solo si hace falta. Correcto — no debe avisar.
void bien_caso_c_por_defecto_antes(struct sockaddr_in& dir_servidor, uint16_t puerto) {
    dir_servidor.sin_port = puerto;
    if (std::endian::native == std::endian::little) {
        dir_servidor.sin_port = std::byteswap(puerto);
    }
}

// El if está ANTES en vez de después: aquí la asignación sin convertir
// SOBREESCRIBE la conversión — es un bug real, debe seguir avisando.
void bug_if_antes_sobreescribe_despues(struct sockaddr_in& dir_servidor, uint16_t puerto) {
    if (std::endian::native == std::endian::little) {
        dir_servidor.sin_port = std::byteswap(puerto);
    }
    dir_servidor.sin_port = puerto;
}
