#include <unistd.h>
#include <sys/wait.h>
#include <cstdlib>

void f() {
    pid_t pid = fork();
    if (pid == 0) {
        wait(0);
        exit(0);
    }
}

void bien_wait_en_el_padre() {
    pid_t pid = fork();
    if (pid == 0) {
        exit(0);
    } else {
        wait(0);
    }
}
