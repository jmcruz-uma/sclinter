#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#include <netinet/in.h>

// --- accept() sin listen() ---

void bug_accept_sin_listen(int sd, struct sockaddr* addr, socklen_t* len) {
    int csd = accept(sd, addr, len);
    (void)csd;
}

void bien_accept_con_listen(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    (void)csd;
}

// --- leer/escribir con el socket de escucha en vez del aceptado ---

void bug_lectura_socket_escucha(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    char buf[64];
    // Bug: debería ser csd, no sd.
    read(sd, buf, sizeof(buf));
}

void bien_lectura_socket_aceptado(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    char buf[64];
    read(csd, buf, sizeof(buf));
}

// --- fork() antes de accept() ---

void bug_fork_antes_de_accept(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    pid_t pid = fork();
    if (pid == 0) {
        int csd = accept(sd, addr, len);
        (void)csd;
    }
}

void bien_fork_despues_de_accept(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    pid_t pid = fork();
    if (pid == 0) {
        (void)csd;
    }
}
