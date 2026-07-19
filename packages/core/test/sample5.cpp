#include <csignal>
#include <sys/types.h>
#include <unistd.h>

void manejadora(int signum) { (void)signum; }

void bug_kill_invertido(pid_t pid_padre) {
    // Caso real del catálogo (alumno_002, ejercicio 3).
    kill(SIGUSR1, pid_padre);
}

void bien_kill(pid_t pid_padre) {
    kill(pid_padre, SIGUSR1);
}

void bug_signal_invertido() {
    signal(manejadora, SIGALRM);
}

void bien_signal() {
    signal(SIGALRM, manejadora);
}
