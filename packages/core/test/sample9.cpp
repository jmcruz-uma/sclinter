#include <unistd.h>
#include <cstdlib>
#include <csignal>
#include <sys/wait.h>

// --- zombis ---

void bug_sin_reap() {
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    }
}

void bien_con_waitpid() {
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    } else {
        waitpid(pid, nullptr, 0);
    }
}

void bien_con_sigchld_ignore() {
    signal(SIGCHLD, SIG_IGN);
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    }
}

// --- hijo que no termina ---

void bien_hijo_termina_con_exit() {
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    }
    waitpid(pid, nullptr, 0);
}

void bien_hijo_termina_con_return() {
    pid_t pid = fork();
    if (pid == 0) {
        return;
    }
    waitpid(pid, nullptr, 0);
}

void aviso_suave_sin_bucle() {
    // No termina explícitamente, pero no hay bucle con fork() alrededor:
    // aviso suave, no "gravísimo".
    pid_t pid = fork();
    if (pid == 0) {
        int x = 1;
        (void)x;
    }
    waitpid(pid, nullptr, 0);
}

void gravisimo_hijo_puede_volver_a_forkar() {
    while (true) {
        pid_t pid = fork();
        if (pid == 0) {
            int x = 1;
            (void)x;
            // Sin exit()/return: el hijo vuelve a la cabecera del while
            // y puede volver a hacer fork().
        }
        waitpid(pid, nullptr, 0);
    }
}
