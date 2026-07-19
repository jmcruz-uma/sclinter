#include <sys/socket.h>
#include <unistd.h>
#include <cstddef>

ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);

// --- Alias intra-función de lectura-con-socket-escucha ---

void bug_alias_directo(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    int aux = sd;               // alias del socket de escucha
    char buf[64];
    read(aux, buf, sizeof(buf)); // bug: debería ser csd
}

void bien_alias_de_csd(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    int conectado = csd;         // alias del socket CONECTADO, no del de escucha
    char buf[64];
    read(conectado, buf, sizeof(buf)); // correcto
}

// --- Paso a función local (nivel 4) ---

void manejar_conexion(int fd, struct sockaddr* addr, socklen_t* len) {
    char buf[64];
    read(fd, buf, sizeof(buf));
}

void bug_paso_a_funcion_propia(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    manejar_conexion(sd, addr, len); // bug: se pasa el de escucha, no csd
}

void bien_paso_a_funcion_propia(int sd, struct sockaddr* addr, socklen_t* len) {
    listen(sd, 5);
    int csd = accept(sd, addr, len);
    manejar_conexion(csd, addr, len); // correcto
}

void bien_paso_antes_de_accept(int sd, struct sockaddr* addr, socklen_t* len) {
    // sd se pasa a close() ANTES de que exista ningún accept() en esta
    // función que lo marque como "de escucha ya consumido" — de todas
    // formas close() no está definida en el fichero, así que ni entraría
    // en el chequeo de función propia.
    close(sd);
}

// --- Alias de extremos de pipe ---

void bug_alias_extremo_lectura(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    int fd_lectura = mi_pipe[0];
    write_n(fd_lectura, &senal, sizeof(senal)); // bug: fd_lectura es el extremo de lectura
}

void bien_alias_extremo_correcto(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    int fd_escritura = mi_pipe[1];
    write_n(fd_escritura, &senal, sizeof(senal)); // correcto
}
