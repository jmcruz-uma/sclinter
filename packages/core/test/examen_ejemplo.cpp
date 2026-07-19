#include <cstring>
#include <cstdint>
#include <poll.h>

void validar_argumentos(int argc, char* argv[]) {
    if (argc != 3) {
        return;
    }
    // Bug real del catálogo: solo se comprobó argc!=3 (índices válidos 0..2),
    // pero aquí se accede a argv[3].
    int puerto = 0;
    puerto = argv[3][0];
    (void)puerto;
}

void esperar_eventos(struct pollfd* fds) {
    // Bug real del catálogo: sizeof como número de descriptores.
    poll(fds, sizeof(fds), 1000);
}

void construir_pdu(char* buffer, const uint32_t& valor) {
    // Bug: sizeof del puntero, no del valor real.
    std::memcpy(buffer, &valor, sizeof(buffer));
}

void construir_pdu_bien(char* buffer, const uint32_t& valor) {
    // Correcto: no debería aparecer en el informe.
    std::memcpy(buffer, &valor, sizeof(valor));
}
