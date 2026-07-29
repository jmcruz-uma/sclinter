#include <array>
#include <string>
#include <vector>
#include <cstdint>
#include <cstring>
#include <unistd.h>

// sample53 — memcpy-invertido-al-extraer.
//
// `memcpy(almacen.data(), &tam, 2)` en vez de `memcpy(&tam, almacen.data(), 2)`
// al sacar un campo de un buffer recibido: la variable no recibe nada y encima
// se machacan los datos que llegaron del otro extremo.
//
// La forma de la llamada NO distingue el bug: construir un mensaje para
// enviarlo tiene exactamente esa forma y es correcto. Lo que lo distingue es
// el papel del buffer (lo acabamos de leer de la red y no lo vamos a enviar) y
// la evidencia de que la variable no está haciendo de origen de datos: o es un
// parámetro por referencia sin rellenar, o se lee justo después como si el
// memcpy la hubiera llenado.

ssize_t read_n(int fd, void *buf, size_t n);
ssize_t write_n(int fd, const void *buf, size_t n);

// ---------------------------------------------------------------------------
// AVISA: la variable se lee justo después del memcpy
// ---------------------------------------------------------------------------

size_t bug_extraccion_invertida(int fd) {
    std::array<uint8_t, 6> almacen;
    read_n(fd, almacen.data(), almacen.size());

    uint16_t tam = 0;
    memcpy(almacen.data(), &tam, 2);   // invertido: tam sigue valiendo 0
    return tam;                        // ...y aquí se usa como si tuviera el campo
}

// ---------------------------------------------------------------------------
// AVISA: parámetro por referencia que la función tenía que rellenar
// ---------------------------------------------------------------------------

// El uso de seq está en el LLAMANTE, así que la evidencia no puede ser una
// lectura posterior: es que seq es un parámetro por referencia y esta función
// termina sin haberle escrito nada.
int bug_parametro_sin_rellenar(int fd, uint16_t &seq) {
    std::array<uint8_t, 5> mensaje;
    read_n(fd, mensaje.data(), mensaje.size());
    memcpy(mensaje.data() + 1, &seq, 2);
    return mensaje[0];
}

// ---------------------------------------------------------------------------
// CALLA: la extracción correcta
// ---------------------------------------------------------------------------

size_t bien_extraccion_correcta(int fd) {
    std::array<uint8_t, 6> almacen;
    read_n(fd, almacen.data(), almacen.size());

    uint16_t tam = 0;
    memcpy(&tam, almacen.data(), 2);
    return tam;
}

// ---------------------------------------------------------------------------
// CALLA: construir un mensaje para enviarlo (mismísima forma de llamada)
// ---------------------------------------------------------------------------

// El destino nunca se leyó de la red: es un buffer de salida. Sin esta
// condición, todos los memcpy de construcción de mensajes del corpus (cientos)
// serían avisos.
void bien_construccion_de_mensaje(int fd, uint16_t cuantos) {
    std::array<uint8_t, 6> envio;
    memcpy(envio.data(), &cuantos, 2);
    write_n(fd, envio.data(), envio.size());
}

// ---------------------------------------------------------------------------
// CALLA: se reutiliza el buffer recibido para montar la respuesta
// ---------------------------------------------------------------------------

// Aquí el destino SÍ se leyó de la red antes, pero se envía después: escribir
// encima era lo que se quería. Caso real del corpus (alumno_026 de Evaluacion1).
void bien_respuesta_sobre_el_buffer_recibido(int fd) {
    std::array<uint8_t, 6> almacen;
    read_n(fd, almacen.data(), almacen.size());

    uint16_t tam = 0;
    memcpy(&tam, almacen.data(), 2);

    uint16_t respuesta = tam + 1;
    memcpy(almacen.data() + 2, &respuesta, 2);
    write_n(fd, almacen.data(), almacen.size());
}

// ---------------------------------------------------------------------------
// CALLA: límite aceptado — la variable ni es parámetro ni se lee después
// ---------------------------------------------------------------------------

// El memcpy machaca los datos recibidos igual, pero sin lectura posterior de
// la variable ni contrato de parámetro que incumplir no hay evidencia
// mecánica de la inversión, y esta regla prefiere callar. Caso real:
// alumno_043 ej1:148, cuyas dos líneas hermanas sí avisan.
void calla_sin_evidencia(int fd) {
    std::array<uint8_t, 6> almacen;
    read_n(fd, almacen.data(), almacen.size());

    uint16_t tam = 0;
    memcpy(almacen.data(), &tam, 2);
}

// ---------------------------------------------------------------------------
// AVISA: el origen es un contenedor que nunca se dimensionó
// ---------------------------------------------------------------------------

// Mismo despiste, escrito con un contenedor en vez de con un escalar. Aquí no
// hay "escritura previa" que mirar —un contenedor vacío no tiene ninguna—, así
// que la evidencia es que nunca se dimensionó: copiar desde su .data() es
// copiar de la nada, y encima machaca lo recibido.
void bug_origen_string_sin_dimensionar(int fd, size_t tam) {
    std::array<uint8_t, 64> almacen;
    read_n(fd, almacen.data(), almacen.size());

    std::string texto;
    memcpy(almacen.data() + 2, texto.data(), tam);
}

// Preventivo: el patrón recomendado en la asignatura es el vector, así que es
// donde aparecerá este mismo error en el futuro.
void bug_origen_vector_sin_dimensionar(int fd, size_t tam) {
    std::array<uint8_t, 64> almacen;
    read_n(fd, almacen.data(), almacen.size());

    std::vector<char> texto;
    memcpy(almacen.data() + 2, texto.data(), tam);
}

// ---------------------------------------------------------------------------
// CALLA: el contenedor sí está dimensionado
// ---------------------------------------------------------------------------

// Con el contenedor dimensionado, copiar de él hacia el buffer es una
// construcción de mensaje perfectamente normal.
void bien_origen_dimensionado(int fd, size_t tam) {
    std::array<uint8_t, 64> almacen;
    read_n(fd, almacen.data(), almacen.size());

    std::string texto;
    texto.resize(tam);
    memcpy(almacen.data() + 2, texto.data(), tam);
}
