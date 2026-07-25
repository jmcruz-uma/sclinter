#include <unistd.h>
#include <sys/wait.h>
#include <csignal>
#include <cstdlib>

// Caso de control de la EXCEPCIÓN de zombies-sin-reap: recoger a los hijos
// dentro de la manejadora de SIGCHLD es reaping válido, aunque el wait()
// quede en una función distinta de la del fork(). Este fichero NO debe
// disparar zombies-sin-reap (falso positivo real de alumno_005 en
// Evaluacion). El caso que SÍ debe seguir disparando (fork sin reaping en
// ningún sitio) vive en sample8/sample9/sample11.

void manejadora_sigchld(int) {
    wait(nullptr);
}

void bien_reap_en_manejadora_sigchld() {
    signal(SIGCHLD, manejadora_sigchld);
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    }
    // El padre no llama a wait() aquí: lo hace la manejadora al llegar
    // SIGCHLD. No es un olvido, es el idioma correcto.
}
