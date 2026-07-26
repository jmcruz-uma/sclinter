#include <arpa/inet.h>
#include <netinet/in.h>
#include <bit>
#include <cstdint>
#include <cstdio>

// sample44 — conversion-escondida-en-macro (nivel 4, normativa), y los
// controles de que sin-port-no-htons (nivel 2) sigue haciendo su trabajo.
//
// Caso real: alumno_069 escribió `#define PORT (htons(54321))` y luego
// `dir.sin_port = PORT;`. El código FUNCIONA — el puerto acaba bien —, así
// que el aviso de sin-port-no-htons ("no parece correcto") era un falso
// positivo. Pero la macro esconde justo la conversión que se está
// evaluando: ni el lector ni la herramienta pueden ver si está o no.
//
// Reparto entre las dos reglas hermanas:
//   - macro que esconde la conversión  → conversion-escondida-en-macro (y
//     sin-port-no-htons se calla, porque su mensaje sería falso).
//   - macro que es solo un número, sin conversión a la vista → el de
//     siempre: sin-port-no-htons (y esta regla nueva se calla).

#define PORT (htons(54321))
#define PUERTO 54321
#define PUERTO_NTOHS (ntohs(54321))

// --- Deben AVISAR (conversion-escondida-en-macro) ---

void bug_macro_esconde_htons() {
    sockaddr_in dir{};
    dir.sin_family = AF_INET;
    dir.sin_port = PORT;
    printf("%u\n", dir.sin_port);
}

// Mismo caso con inicializador designado.
void bug_macro_esconde_htons_designado() {
    sockaddr_in dir = {.sin_family = AF_INET, .sin_port = PORT};
    printf("%u\n", dir.sin_port);
}

// Conversión DOBLE: htons a la vista y otro htons dentro de la macro. Deja
// el puerto del revés, y es exactamente lo que la macro hace difícil de ver.
void bug_conversion_doble() {
    sockaddr_in dir{};
    dir.sin_port = htons(PORT);
    printf("%u\n", dir.sin_port);
}

// No se juzga si la conversión escondida es la correcta: ntohs esconde
// lógica igual que htons.
void bug_macro_esconde_ntohs() {
    sockaddr_in dir{};
    dir.sin_port = PUERTO_NTOHS;
    printf("%u\n", dir.sin_port);
}

// --- Deben CALLAR las dos reglas ---

// Macro que es solo un número + conversión a la vista en el punto de uso.
// Es código correcto: la macro no esconde nada. (Hay profesores que usan
// macros para constantes, y ese uso no se persigue.)
void ok_macro_de_numero_con_htons() {
    sockaddr_in dir{};
    dir.sin_port = htons(PUERTO);
    printf("%u\n", dir.sin_port);
}

// Lo que la regla recomienda: constante con tipo.
void ok_constante_tipada() {
    const uint16_t puerto = 54321;
    sockaddr_in dir{};
    dir.sin_port = htons(puerto);
    printf("%u\n", dir.sin_port);
}

// --- CONTROL: el bug real de sin-port-no-htons sigue avisando ---

// La macro es solo un número y NO hay conversión por ninguna parte.
// conversion-escondida-en-macro se calla (no hay nada escondido) y
// sin-port-no-htons avisa, que es lo correcto.
void bug_sin_conversion_con_macro() {
    sockaddr_in dir{};
    dir.sin_port = PUERTO;
    printf("%u\n", dir.sin_port);
}

// Sin macros de por medio, el caso clásico.
void bug_sin_conversion_variable(uint16_t puerto) {
    sockaddr_in dir{};
    dir.sin_port = puerto;
    printf("%u\n", dir.sin_port);
}

int main() {
    bug_macro_esconde_htons();
    bug_macro_esconde_htons_designado();
    bug_conversion_doble();
    bug_macro_esconde_ntohs();
    ok_macro_de_numero_con_htons();
    ok_constante_tipada();
    bug_sin_conversion_con_macro();
    bug_sin_conversion_variable(54321);
    return 0;
}
