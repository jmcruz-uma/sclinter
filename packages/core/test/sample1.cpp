#include <bit>
#include <cstdint>
#include <cstdio>

// sample1 — byteswap-sobre-valor-sin-tipo.
//
// (Este fichero rellena el hueco histórico de numeración: los samples
// empezaban en sample2. Decisión del profesor, 2026-07-26.)
//
// std::byteswap es una PLANTILLA: deduce el tipo de su argumento. Un
// literal entero es `int`, así que intercambia 4 bytes y no 2, y al
// guardarlo en un uint16_t el resultado se trunca a 0 sin que el
// compilador diga nada (comprobado con -Wall -Wextra). htons() no tiene
// ese problema porque su prototipo ya fija el tipo del parámetro.
//
// La regla NO persigue macros: persigue "byteswap sobre un valor cuyo tipo
// no se ve". Por eso el literal desnudo también avisa, y por eso una macro
// con el tipo escrito a la vista se calla.

#define PUERTO_MACRO 54321
#define PUERTO_CON_CAST ((uint16_t) 54321)
#define TAM_BUFFER 2048

const uint16_t PUERTO_TIPADO = 54321;

// --- Deben AVISAR ---

// Macro sin tipo: el preprocesador la sustituye por un literal int.
uint16_t bug_macro_sin_tipo() {
    return std::byteswap(PUERTO_MACRO);
}

// Literal desnudo: el mismo bug, sin macro alguna de por medio.
uint16_t bug_literal_decimal() {
    return std::byteswap(54321);
}

uint16_t bug_literal_hex() {
    return std::byteswap(0x1234);
}

// Con espacios alrededor de `::` (mismo recorte que en sinPortNoHtons).
uint16_t bug_con_espacios() {
    return std :: byteswap(54321);
}

// Entre paréntesis: se desenvuelven antes de mirar el argumento.
uint16_t bug_entre_parentesis() {
    return std::byteswap((54321));
}

// --- Deben CALLAR (controles) ---

// El caso normal y correcto: una variable con tipo a la vista.
uint16_t ok_variable(uint16_t puerto) {
    return std::byteswap(puerto);
}

// Constante con tipo: es justo lo que la regla recomienda.
uint16_t ok_constante_tipada() {
    return std::byteswap(PUERTO_TIPADO);
}

// Macro cuyo cuerpo lleva el tipo escrito: la decisión de tipo está tomada
// a propósito, no delegada al preprocesador.
uint16_t ok_macro_con_cast() {
    return std::byteswap(PUERTO_CON_CAST);
}

// Cast en el propio argumento.
uint16_t ok_cast_en_argumento() {
    return std::byteswap(static_cast<uint16_t>(54321));
}

uint16_t ok_cast_funcional() {
    return std::byteswap(uint16_t(54321));
}

// Una macro de tamaño que nunca pasa por byteswap: la regla ni la mira.
// (Uso legítimo de macros que no debe generar ruido.)
int ok_macro_de_tamano() {
    return TAM_BUFFER;
}

int main() {
    printf("%u %u %u %u %u\n", bug_macro_sin_tipo(), bug_literal_decimal(),
           bug_literal_hex(), bug_con_espacios(), bug_entre_parentesis());
    printf("%u %u %u %u %u %d\n", ok_variable(54321), ok_constante_tipada(),
           ok_macro_con_cast(), ok_cast_en_argumento(), ok_cast_funcional(),
           ok_macro_de_tamano());
    return 0;
}
