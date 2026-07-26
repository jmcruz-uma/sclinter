#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

// sample47 — memcpy-direccion-contenedor con resolución de ÁMBITO.
// Segunda regla de la familia que adopta checkers/scopeResolution.ts
// (la primera fue io-array-direccion-estilo, sample46).
//
// NOTA: los casos con bug producen a propósito el aviso -Wclass-memaccess
// del compilador ("writing to an object of type std::string with no trivial
// copy-assignment"), que es exactamente lo que la regla detecta. El fichero
// compila. Los casos que deben callar no producen ninguno, lo que confirma
// que el destino ahí no es un contenedor.

// ============================================================
// Deben CALLAR
// ============================================================

// Un array de C declarado dentro de un bloque sombrea al std::string de la
// función. `&buffer` sobre el array es correcto; el aviso de la regla sería
// falso. Y el uso de fuera del bloque sí es el string, y sigue avisando.
void sombreado_en_bloque_interno(const uint8_t *origen, int cond) {
    std::string buffer;
    if (cond) {
        char buffer[10];                    // variable DISTINTA, mismo nombre
        std::memcpy(&buffer, origen, 10);   // silencio: es un array de C
        (void)buffer;
    }
    std::memcpy(&buffer, origen, 4);        // AVISA: aquí buffer es el string
}

// Nombre que en otra función es un contenedor, pero aquí no.
void escalar_con_nombre_de_contenedor(const uint8_t *origen) {
    uint32_t buffer;
    std::memcpy(&buffer, origen, 4);        // silencio: es un uint32_t
    (void)buffer;
}

// std::array queda fuera de esta regla a conciencia: &arr y arr.data() son
// la misma dirección.
void array_no_cuenta(const uint8_t *origen) {
    uint8_t destino[6];
    std::memcpy(&destino, origen, 6);
}

// ============================================================
// Deben AVISAR
// ============================================================

void string_de_la_funcion(const uint8_t *origen) {
    std::string texto;
    std::memcpy(&texto, origen, 4);
}

void vector_de_la_funcion(const uint8_t *origen) {
    std::vector<uint8_t> datos(16);
    std::memcpy(&datos, origen, 4);
}

// Contenedor recibido como parámetro por referencia: los parámetros son el
// ámbito más exterior de la función.
void vector_como_parametro(const uint8_t *origen, std::vector<uint8_t> &datos) {
    std::memcpy(&datos, origen, 4);
}

// Dos contenedores declarados en la misma sentencia.
void dos_strings_en_una_declaracion(const uint8_t *origen) {
    std::string uno, dos;
    std::memcpy(&uno, origen, 4);
    std::memcpy(&dos, origen, 4);
}

// Contenedor declarado dentro de un bloque y usado ahí mismo.
void contenedor_declarado_en_bloque(const uint8_t *origen, int cond) {
    if (cond) {
        std::vector<char> datos(8);
        std::memcpy(&datos, origen, 4);
    }
}

int main() {
    return 0;
}
