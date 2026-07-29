#include <bit>
#include <cstdint>
#include <netinet/in.h>

// sample54 — conversion-de-anchura-equivocada.
//
// La conversión de orden de bytes tiene que tener la anchura del dato. Tres
// formas destruyen el valor y tres son fallos de concepto que hoy funcionan.
//
// El caso más traicionero es `std::byteswap` sobre un `int`: la plantilla
// deduce el tipo del argumento, intercambia los CUATRO bytes del entero y al
// guardarlo en un campo de dos queda 0. Comprobado compilando: `-Wall -Wextra`
// no dice una palabra. Con `htons` el mismo código funciona, porque el
// prototipo `uint16_t htons(uint16_t)` estrecha el argumento antes.

// ---------------------------------------------------------------------------
// AVISA: pérdida real de datos
// ---------------------------------------------------------------------------

// (A) El argumento no cabe en la conversión: htons solo mira 2 de los 4 bytes.
void bug_argumento_mas_ancho(sockaddr_in &dir) {
    uint32_t red = 0xC0A80001;
    red = htons(red);
    dir.sin_addr.s_addr = red;
}

// (B) El resultado no cabe en el destino: se trunca al guardarlo.
uint8_t bug_destino_mas_estrecho(uint8_t cabecera) {
    cabecera = htons(cabecera);
    return cabecera;
}

// (D1) std::byteswap deduce `int` e intercambia 4 bytes: el puerto queda a 0.
void bug_byteswap_sobre_int(sockaddr_in &dir, int puerto) {
    dir.sin_port = std::byteswap(puerto);
}

// ---------------------------------------------------------------------------
// AVISA: no rompe nada, pero delata que no se sabe qué anchura tiene el campo
// ---------------------------------------------------------------------------

// (C) Un byte no tiene orden de bytes: la conversión no hace nada.
uint8_t bug_byteswap_de_un_byte(uint8_t tipo) {
    tipo = std::byteswap(tipo);
    return tipo;
}

// (D2) Funciona por el prototipo de htons, no por diseño: con `int` no se ve
// si lo que hacía falta era htons o htonl.
void bug_htons_sobre_int(sockaddr_in &dir, int puerto) {
    dir.sin_port = htons(puerto);
}

// (D3) El valor convertido acaba en un entero sin anchura declarada.
int bug_resultado_en_int(uint16_t numero) {
    int convertido = htons(numero);
    return convertido;
}

// ---------------------------------------------------------------------------
// CALLA: la anchura de la conversión es la del dato
// ---------------------------------------------------------------------------

// El idioma de las soluciones del profesor: la anchura va declarada.
void bien_puerto_con_anchura(sockaddr_in &dir, uint16_t puerto) {
    dir.sin_port = std::byteswap(puerto);
}

void bien_campo_de_cuatro_bytes(uint32_t &info) {
    info = std::byteswap(info);
}

uint16_t bien_htons_sobre_uint16(uint16_t numero) {
    numero = htons(numero);
    return numero;
}

// Ensanchar no pierde nada: el destino es más ancho que la conversión, pero el
// argumento cabe de sobra. No hay nada que avisar aquí.
uint32_t bien_destino_mas_ancho(uint16_t numero) {
    uint32_t convertido = htons(numero);
    return convertido;
}
