#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>
#include <cstdio>

// Controles de hijo-sin-terminar tras el análisis de terminación alwaysExits.
// Las funciones ok_* NO deben avisar (el hijo termina por todos los caminos);
// las mal_* SÍ deben seguir avisando (el hijo puede caer por el final).

// (a) if/else con exit en TODAS las ramas -> no avisa
void ok_if_else_todas_terminan() {
    pid_t pid = fork();
    if (pid == 0) {
        if (getpid() % 2 == 0) {
            exit(0);
        } else {
            exit(1);
        }
    }
    wait(nullptr);
}

// (b) bucle infinito sin break, con exit dentro -> no avisa.
// Las cinco formas equivalentes deben reconocerse igual: while(1),
// while(true), for(;;), do{}while(1), do{}while(true).
void ok_while_1() {
    pid_t pid = fork();
    if (pid == 0) {
        while (1) { if (getpid() > 0) exit(0); }
    }
    wait(nullptr);
}
void ok_while_true() {
    pid_t pid = fork();
    if (pid == 0) {
        while (true) { if (getpid() > 0) exit(0); }
    }
    wait(nullptr);
}
void ok_for_infinito() {
    pid_t pid = fork();
    if (pid == 0) {
        for (;;) { if (getpid() > 0) exit(0); }
    }
    wait(nullptr);
}
void ok_do_while_1() {
    pid_t pid = fork();
    if (pid == 0) {
        do { if (getpid() > 0) exit(0); } while (1);
    }
    wait(nullptr);
}
void ok_do_while_true() {
    pid_t pid = fork();
    if (pid == 0) {
        do { if (getpid() > 0) exit(0); } while (true);
    }
    wait(nullptr);
}

// (c) exit seguido de un comentario (el bug del comentario) -> no avisa
void ok_exit_con_comentario() {
    pid_t pid = fork();
    if (pid == 0) {
        printf("hijo\n");
        exit(0); // cumplir contrato
    }
    wait(nullptr);
}

// (d) CONTROL: if/else con una rama que NO termina -> SÍ avisa
void mal_if_else_una_rama_cae() {
    pid_t pid = fork();
    if (pid == 0) {
        if (getpid() % 2 == 0) {
            exit(0);
        } else {
            printf("me caigo\n");
        }
    }
    wait(nullptr);
}

// (e) CONTROL: bucle finito que cae por el final -> SÍ avisa
void mal_bucle_finito_cae() {
    pid_t pid = fork();
    if (pid == 0) {
        int n = 3;
        while (n-- > 0) {
            printf("iter\n");
        }
    }
    wait(nullptr);
}
