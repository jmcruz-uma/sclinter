#include <cstring>
#include <cstdint>

// sample52 — mempcpy-extension-gnu (nivel 4, normativa).
//
// `mempcpy` es una extensión de GNU: no está en el estándar y `std::mempcpy`
// no existe (comprobado con g++-14: "'mempcpy' is not a member of 'std'").
// Compila aquí solo porque g++ define _GNU_SOURCE por su cuenta.
//
// Además de la razón de normativa, tiene una consecuencia práctica: las
// reglas del catálogo que reconocen la copia por el nombre literal `memcpy`
// no ven un `mempcpy`, así que el bug de debajo se pierde entero. Los dos
// últimos casos de este fichero son ese par, sacado de una entrega real.

// --- AVISA: la llamada de siempre ---
void bug_mempcpy(char* destino, const char* origen) {
    mempcpy(destino, origen, 4);
}

// --- AVISA: con el operador de ámbito global delante ---
void bug_mempcpy_ambito_global(char* destino, const char* origen) {
    ::mempcpy(destino, origen, 4);
}

// --- AVISA: aunque se use el valor de retorno (lo único que aporta) ---
void bug_mempcpy_usando_retorno(char* destino, const char* origen) {
    void* fin = mempcpy(destino, origen, 4);
    (void)fin;
}

// --- CORRECTO: memcpy a secas, que la asignatura acepta ---
void bien_memcpy(char* destino, const char* origen) {
    memcpy(destino, origen, 4);
}

// --- CORRECTO: std::memcpy, que es la forma que se enseña ---
void bien_std_memcpy(char* destino, const char* origen) {
    std::memcpy(destino, origen, 4);
}

// --- CORRECTO: no es una llamada, solo un nombre parecido ---
void bien_nombre_parecido(char* destino, const char* origen) {
    int mempcpy_pendiente = 1;
    (void)mempcpy_pendiente;
    memcpy(destino, origen, 4);
}

// --- El par de la entrega real: el MISMO bug escrito de las dos formas ---
// Volcar bytes crudos sobre un std::string sobreescribe su representación
// interna, no su contenido. Con `memcpy` lo caza memcpy-direccion-contenedor;
// con `mempcpy` esa regla no lo ve, y solo salta esta.
//
// OJO al compilar este fichero: g++ emite -Wclass-memaccess en la versión con
// `memcpy` y NO dice nada en la de `mempcpy`. Esa asimetría es deliberada en
// el ejemplo — al cambiar de función se pierde el aviso de g++ además del
// nuestro, y es una de las razones de peso de esta regla.

#include <string>

// Dos avisos: el de esta regla y el de memcpy-direccion-contenedor.
void bug_memcpy_sobre_string(const char* origen) {
    std::string destino;
    memcpy(&destino, origen, 4);
}

// Un solo aviso, el de esta regla — y ese es justo el punto: sin ella, este
// código se iría sin decir nada.
void bug_mempcpy_sobre_string(const char* origen) {
    std::string destino;
    mempcpy(&destino, origen, 4);
}
