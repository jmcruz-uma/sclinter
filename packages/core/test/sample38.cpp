#include <cerrno>
#include <poll.h>

// sample38 — errno-asignacion-en-vez-de-comparacion.
// Lo que delata el bug es el CONTEXTO (asignar dentro de una guarda o de una
// booleana), no el valor asignado: asignar a errno fuera de una condición es
// legítimo y aparece en el código de referencia de la asignatura.
//
// NOTA: los tres casos con bug producen a propósito el aviso -Wparentheses
// del compilador ("suggest parentheses around assignment used as truth
// value"); es justo el patrón que la regla detecta. El fichero compila.

// --- Deben AVISAR ---

// El caso real de examen: reintento de poll() con `=` en vez de `==`.
// La condición siempre es cierta (EINTR != 0) → bucle infinito.
int bug_do_while(pollfd *pfd) {
    int r;
    do {
        r = poll(pfd, 1, -1);
    } while ((r < 0) && (errno = EINTR));
    return r;
}

// Guarda de if, sin operación booleana de por medio.
int bug_guarda_if() {
    if (errno = EINTR) {
        return 1;
    }
    return 0;
}

// Guarda de for: aquí la condición NO va envuelta en ningún nodo extra.
int bug_guarda_for() {
    int n = 0;
    for (; errno = EAGAIN;) {
        break;
    }
    return n;
}

// --- Deben CALLAR ---

// Limpiar errno antes de una llamada: idioma correcto, está en referencia.c.
int bien_errno_cero(pollfd *pfd) {
    errno = 0;
    return poll(pfd, 1, 0);
}

// Señalizar un error desde una función propia: idioma correcto (read_for).
int bien_senaliza_error(int r) {
    if (r == 0) {
        errno = ETIMEDOUT;
        return 0;
    }
    return r;
}

// La comparación correcta, que es lo que se pretendía en los casos de arriba.
int bien_comparacion(pollfd *pfd) {
    int r;
    do {
        r = poll(pfd, 1, -1);
    } while ((r < 0) && (errno == EINTR));
    return r;
}
