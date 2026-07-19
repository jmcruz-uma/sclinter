#include <csignal>
#include <sys/types.h>
#include <unistd.h>

void bien_ignorar() {
    signal(SIGPIPE, SIG_IGN);
}

void bien_por_defecto() {
    signal(SIGCHLD, SIG_DFL);
}

void bug_rtmin_invertido(pid_t pid) {
    // SIGRTMIN también debe detectarse en la posición equivocada.
    kill(SIGRTMIN, pid);
}

void bien_rtmin(pid_t pid) {
    kill(pid, SIGRTMIN);
}

void trampa_sigstksz_no_es_senal() {
    // SIGSTKSZ empieza por "SIG" pero es un tamaño de pila, no una señal.
    // No debe activar ninguna regla relacionada con kill/signal.
    int tamano = SIGSTKSZ;
    (void)tamano;
}
