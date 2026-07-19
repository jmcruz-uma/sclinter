#include <cstring>
#include <string>
#include <array>
#include <vector>
#include <cstdint>

void bug_string_direccion(const char* datos) {
    std::string buffer;
    // Bug: sobreescribe el objeto std::string, no su contenido.
    std::memcpy(&buffer, datos, 4);
}

void bug_vector_direccion(const char* datos) {
    std::vector<char> buffer(8);
    // Bug: mismo problema que con std::string — &buffer != buffer.data().
    std::memcpy(&buffer, datos, 4);
}

void correcto_pero_desaconsejado_array_direccion(const char* datos) {
    std::array<char, 8> mensaje{};
    // Técnicamente correcto (&mensaje == mensaje.data() para std::array),
    // pero la norma de estilo de la asignatura pide .data() siempre.
    // Debe marcarse como [estilo], no como bug.
    std::memcpy(&mensaje, datos, 5);
}

void bug_array(const char* datos) {
    std::array<char, 2> mensaje;
    // Bug: mensaje solo tiene 2 elementos, se copian 5.
    std::memcpy(mensaje.data(), datos, 5);
}

void bien_array(const char* datos) {
    std::array<char, 8> mensaje;
    // Correcto: 5 <= 8.
    std::memcpy(mensaje.data(), datos, 5);
}

void prohibido_string_data_con_resize(const char* datos) {
    std::string buffer;
    buffer.resize(4);
    // Prohibido por normativa de la asignatura, aunque el tamaño cuadre
    // (4 == 4): la política no distingue "es seguro" de "está permitido".
    std::memcpy(buffer.data(), datos, 4);
}

void prohibido_string_data_sin_resize(const char* datos) {
    std::string buffer;
    // Prohibido, y además peligroso: ni siquiera se redimensionó.
    std::memcpy(buffer.data(), datos, 4);
}

void permitido_string_data_como_origen(char* destino) {
    // Corregido: el string es ORIGEN aquí (se lee, no se escribe en él),
    // así que SÍ está permitido, a diferencia de los dos casos anteriores.
    std::string buffer = "hola";
    std::memcpy(destino, buffer.data(), buffer.size());
}

void bug_string_data_con_offset(uint8_t dato) {
    // Caso real aportado por Jesús: la aritmética de punteros sobre
    // .data() escondía el patrón. almacen ni siquiera se redimensionó,
    // así que esto es peor que el caso base.
    std::string almacen;
    std::memcpy(almacen.data() + 1, &dato, sizeof(dato));
}
