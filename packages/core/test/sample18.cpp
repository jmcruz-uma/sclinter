#include <cstdint>
#include <cstring>
#include <unistd.h>

uint16_t htons(uint16_t x);
uint32_t htonl(uint32_t x);
uint32_t ntohl(uint32_t x);
ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);

// --- BUG: valor local (strlen), convertido una vez, usado como tamaño ---
void bug_tamano_memcpy(int fd, const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(buffer, texto, longitud);
}

// --- BUG: valor local, convertido una vez, usado como límite de bucle ---
void bug_limite_bucle(int argc, char** argv) {
    uint16_t n = argc - 1;
    n = htons(n);
    for (uint16_t i = 0; i < n; i++) {
    }
}

// --- BUG: valor local, convertido una vez, usado para avanzar un offset ---
void bug_offset(const char* texto) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    uint16_t offset = 0;
    offset += longitud;
}

// --- CORRECTO: la variable SÍ vino de la red (read_n) — impar es lo correcto ---
void bien_recibido_de_red(int fd, char* buffer) {
    uint16_t longitud;
    read_n(fd, &longitud, sizeof(longitud));
    longitud = htons(longitud);
    read_n(fd, buffer, longitud);
}

// --- CORRECTO: convertido dos veces (par) antes de usarlo — vuelve al original ---
void bien_conversion_par(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    longitud = htons(longitud);
    memcpy(buffer, texto, longitud);
}

// --- CORRECTO: nunca se convierte, se usa el valor local tal cual ---
void bien_sin_convertir(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    memcpy(buffer, texto, longitud);
}

// --- BUG: límite de un while ---
void bug_limite_while(const char* texto) {
    uint16_t restante = strlen(texto);
    restante = htons(restante);
    while (restante > 0) {
        restante--;
    }
}

// --- BUG: límite de un do-while (envoltorio distinto: parenthesized_expression) ---
void bug_limite_do_while(const char* texto) {
    uint16_t restante = strlen(texto);
    restante = htons(restante);
    do {
        restante--;
    } while (restante > 0);
}

// --- BUG: comparación suelta en un if ---
void bug_comparacion_suelta(const char* texto) {
    uint32_t longitud = strlen(texto);
    longitud = htonl(longitud);
    if (longitud > 1000) {
    }
}

// --- BUG: htonl/ntohl, no solo htons/ntohs ---
void bug_htonl(const char* texto, char* buffer) {
    uint32_t longitud = strlen(texto);
    longitud = ntohl(longitud);
    memcpy(buffer, texto, longitud);
}

// --- CORRECTO: while con variable recibida de la red (impar es correcto) ---
void bien_while_recibido(int fd, char* buffer) {
    uint16_t restante;
    read_n(fd, &restante, sizeof(restante));
    restante = htons(restante);
    while (restante > 0) {
        restante--;
    }
}

// --- BUG: offset byteswapeado usado como desplazamiento en .data() + X ---
void bug_offset_byteswapeado_en_desplazamiento(const char* texto, char* buffer) {
    uint16_t pos = strlen(texto);
    pos = htons(pos);
    memcpy(buffer + pos, texto, 1);
}

// --- BUG: mismo caso con array[X] ---
void bug_offset_byteswapeado_en_indice(const char* texto, char* buffer) {
    uint16_t pos = strlen(texto);
    pos = htons(pos);
    buffer[pos] = 0;
}

// --- Sumas: desplazamiento ANIDADO y tamaño compuesto ---
// La posición del argumento es lo que distingue un desplazamiento de un
// tamaño; por eso la comprobación va por posición y no por "hay un + suelto".

ssize_t sendto(int fd, const void* b, size_t n, int f, const void* a, unsigned l);

// BUG: el desplazamiento está en una suma anidada — `(mensaje+2)+longitud`.
// Antes se escapaba porque a la izquierda del + había otra suma.
void bug_desplazamiento_anidado(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje + 2 + longitud, texto, 2);
}

// BUG: igual con el sumando en medio — `(mensaje+longitud)+4`.
void bug_desplazamiento_anidado_en_medio(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje + longitud + 4, texto, 2);
}

// BUG: dos longitudes convertidas sumadas como TAMAÑO de un envío. Deben
// avisar las dos, y el mensaje debe hablar de tamaño, no de desplazamiento.
void bug_suma_como_tamano(int fd, const char* t1, const char* t2, char* mensaje) {
    uint16_t l1 = strlen(t1);
    uint16_t l2 = strlen(t2);
    l1 = htons(l1);
    l2 = htons(l2);
    sendto(fd, mensaje, l1 + l2 + 4, 0, mensaje, 4);
}

// CORRECTO: la suma está en posición de tamaño pero ningún sumando se
// convirtió. No debe avisar.
void bien_suma_como_tamano_sin_convertir(int fd, const char* t1, char* mensaje) {
    uint16_t l1 = strlen(t1);
    sendto(fd, mensaje, l1 + 4, 0, mensaje, 4);
}

// CORRECTO: el desplazamiento usa una longitud que NO se ha convertido.
void bien_desplazamiento_anidado_sin_convertir(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    memcpy(mensaje + 2 + longitud, texto, 2);
}

// BUG: el buffer no siempre es el primer argumento — en write_n va el
// segundo. Comprueba que la tabla de posiciones no está atada a memcpy.
void bug_desplazamiento_en_write_n(int fd, const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    write_n(fd, mensaje + 2 + longitud, 2);
}

// --- Envoltorios que no cambian el valor: paréntesis y casts ---

// BUG: el cast tapaba el identificador y el aviso se perdía.
void bug_tamano_con_cast(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje, texto, (size_t)longitud + 1);
}

// BUG: el desplazamiento va dentro de un paréntesis — `base + (2 + longitud)`.
void bug_desplazamiento_entre_parentesis(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje + (2 + longitud + 1), texto, 2);
}

// BUG: cast a secas, sin suma, como tamaño de memcpy.
void bug_tamano_solo_cast(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje, texto, (size_t)longitud);
}

// CORRECTO: mismos envoltorios pero sin conversión previa. No debe avisar.
void bien_envoltorios_sin_convertir(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    memcpy(mensaje + (2 + longitud), texto, (size_t)longitud + 1);
}

// --- El += con una suma a la derecha ---

// BUG: el offset avanza con una longitud convertida más el terminador.
// Antes se perdía porque a la derecha del += había una suma, no un nombre.
void bug_offset_mas_igual_con_suma(const char* texto) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    uint16_t offset = 0;
    offset += longitud + 1;
    (void)offset;
}

// CORRECTO: la misma suma sin conversión previa. No debe avisar.
void bien_offset_mas_igual_con_suma(const char* texto) {
    uint16_t longitud = strlen(texto);
    uint16_t offset = 0;
    offset += longitud + 1;
    (void)offset;
}

// --- Resta: PDU construida del final hacia el principio ---
// No hay ningún caso así en los corpus de examen; entra de forma preventiva.
// El signo da igual: lo que importa es que un valor en orden de red intervenga
// en la cuenta.

// BUG: el desplazamiento se calcula restando una longitud ya convertida.
void bug_desplazamiento_con_resta(const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    memcpy(mensaje + 2048 - longitud, texto, 2);
}

// BUG: el offset retrocede con una longitud ya convertida.
void bug_offset_menos_igual(const char* texto) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    uint16_t offset = 2048;
    offset -= longitud;
    (void)offset;
}

// BUG: la resta forma parte del tamaño de un envío.
void bug_tamano_con_resta(int fd, const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    write_n(fd, mensaje, 2048 - longitud);
}

// CORRECTO: las mismas restas sin conversión previa. No deben avisar.
void bien_restas_sin_convertir(int fd, const char* texto, char* mensaje) {
    uint16_t longitud = strlen(texto);
    uint16_t offset = 2048;
    offset -= longitud;
    memcpy(mensaje + 2048 - longitud, texto, 2);
    write_n(fd, mensaje, 2048 - longitud);
    (void)offset;
}

// CORRECTO: el contador de un bucle de lectura, que es como está escrito el
// helper read_n de la referencia. `leidos` nunca viene convertido, así que los
// cientos de `por_leer -= leidos` del corpus deben seguir en silencio.
void bien_contador_de_bucle(int fd, char* buffer, size_t n) {
    size_t por_leer = n;
    while (por_leer > 0) {
        ssize_t leidos = read_n(fd, buffer, por_leer);
        if (leidos <= 0) break;
        por_leer -= leidos;
    }
}

// --- La cuenta pasa por una variable intermedia ---

// BUG: el total se calcula sumando longitudes ya convertidas y se usa para
// enviar. Antes se perdía: la suma se guardaba en `total` y el rastro moría
// ahí. Deben avisar los dos usos de `total`, el envío y la comparación.
void bug_total_por_variable_intermedia(int fd, const char* t1, const char* t2, char* mensaje) {
    uint16_t l1 = strlen(t1);
    uint16_t l2 = strlen(t2);
    l1 = htons(l1);
    l2 = htons(l2);
    int total = 4 + l1 + l2;
    ssize_t escritos = write_n(fd, mensaje, total);
    if (escritos != total) {
        return;
    }
}

// CORRECTO: la misma forma pero sin ninguna longitud convertida. No debe
// avisar — aritmética local de toda la vida.
void bien_total_por_variable_intermedia(int fd, const char* t1, const char* t2, char* mensaje) {
    uint16_t l1 = strlen(t1);
    uint16_t l2 = strlen(t2);
    int total = 4 + l1 + l2;
    ssize_t escritos = write_n(fd, mensaje, total);
    if (escritos != total) {
        return;
    }
}

// CORRECTO: la longitud se convierte DESPUÉS de calcular el total, así que el
// total se calculó con el valor bueno. No debe avisar.
void bien_total_antes_de_convertir(int fd, const char* t1, char* mensaje) {
    uint16_t l1 = strlen(t1);
    int total = 4 + l1;
    l1 = htons(l1);
    write_n(fd, mensaje, total);
    write_n(fd, &l1, 2);
}

// --- Cadenas aditivas en comparaciones y en índices ---
// Sin esto la regla quedaba incoherente consigo misma: `write_n(fd, b, l1+l2)`
// avisaba y `if (x < l1+l2)` no.

// BUG: el límite del bucle es una suma con una longitud ya convertida. Debe
// avisar de `longitud`, que es la culpable.
void bug_comparacion_con_suma(const char* texto, char* buffer) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    for (size_t i = 0; i < (size_t)longitud + 1; i++) {
        buffer[0] = (char)i;
    }
}

// BUG: el índice del array se calcula restando una longitud convertida.
void bug_indice_con_resta(const char* texto, char* buffer, size_t i) {
    uint16_t longitud = strlen(texto);
    longitud = htons(longitud);
    buffer[i - longitud] = 0;
}

// CORRECTO: las mismas formas sin conversión previa. No deben avisar.
void bien_comparacion_e_indice_sin_convertir(const char* texto, char* buffer, size_t i) {
    uint16_t longitud = strlen(texto);
    for (size_t k = 0; k < (size_t)longitud + 1; k++) {
        buffer[0] = (char)k;
    }
    buffer[i - longitud] = 0;
}
