#include <bit>
#include <cstdint>
#include <netinet/in.h>

void f(struct sockaddr_in& dir_servidor, uint16_t puerto) {
    if(std::endian::native == std::endian::little){ //NOTA: también se permite usar htons
        dir_servidor.sin_port = std::byteswap(puerto);
    }else{
        dir_servidor.sin_port =  puerto;
    }
}

// Igual que el caso de arriba, pero con las ramas invertidas (conversión
// en el else) — debe seguir sin avisar, la excepción es simétrica.
void bien_ramas_invertidas(struct sockaddr_in& dir_servidor, uint16_t puerto) {
    if (std::endian::native == std::endian::big) {
        dir_servidor.sin_port = puerto;
    } else {
        dir_servidor.sin_port = std::byteswap(puerto);
    }
}

// Un if/else que NO es de endianness: aquí SÍ debe avisar en la rama sin
// conversión — la excepción no debe aplicar a cualquier if/else.
void bug_if_no_es_de_endianness(struct sockaddr_in& dir_servidor, uint16_t puerto, bool modo_debug) {
    if (modo_debug) {
        dir_servidor.sin_port = std::byteswap(puerto);
    } else {
        dir_servidor.sin_port = puerto;
    }
}

// Un if de endianness donde la rama hermana NO convierte (las dos ramas
// están mal) — debe seguir avisando, la excepción exige que la hermana
// sí convierta.
void bug_endian_pero_las_dos_ramas_mal(struct sockaddr_in& dir_servidor, uint16_t puerto) {
    if (std::endian::native == std::endian::little) {
        dir_servidor.sin_port = puerto;
    } else {
        dir_servidor.sin_port = puerto;
    }
}
