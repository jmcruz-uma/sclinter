#include <netinet/in.h>
#include <arpa/inet.h>

void bug_directo(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = puerto;
}

void bien_directo(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = htons(puerto);
}

void bug_direccion_invertida(struct sockaddr_in& direccion, uint16_t puerto) {
    direccion.sin_port = ntohs(puerto);
}

void bug_inicializador(uint16_t puerto) {
    struct sockaddr_in direccion = { .sin_family = AF_INET, .sin_port = puerto };
}

void bien_inicializador(uint16_t puerto) {
    struct sockaddr_in direccion = { .sin_family = AF_INET, .sin_port = htons(puerto) };
}

void bug_por_puntero(struct sockaddr_in* direccion, uint16_t puerto) {
    // Acceso por puntero (->), no por referencia (.) — misma regla debe aplicar.
    direccion->sin_port = puerto;
}

void bien_por_puntero(struct sockaddr_in* direccion, uint16_t puerto) {
    direccion->sin_port = htons(puerto);
}
