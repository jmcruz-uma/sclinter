#include <unistd.h>
#include <cstddef>

ssize_t read_n(int fd, void* data, size_t n);
ssize_t write_n(int fd, const void* data, size_t n);

// --- usar el descriptor antes de pipe() ---

void bug_uso_antes_de_pipe() {
    int mi_pipe[2];
    char c;
    read(mi_pipe[0], &c, 1);
    pipe(mi_pipe);
}

void bien_orden(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    write(mi_pipe[1], &senal, sizeof(senal));
}

// --- extremos invertidos ---

void bug_escribe_en_extremo_lectura(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    write(mi_pipe[0], &senal, sizeof(senal));
}

void bug_lee_de_extremo_escritura() {
    int mi_pipe[2];
    pipe(mi_pipe);
    char c;
    read(mi_pipe[1], &c, 1);
}

void bien_extremos_correctos(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    write(mi_pipe[1], &senal, sizeof(senal));
    char c;
    read(mi_pipe[0], &c, 1);
}

// --- las mismas dos reglas, pero con read_n/write_n en vez de read/write ---

void bug_uso_antes_de_pipe_con_n() {
    int mi_pipe[2];
    char c;
    read_n(mi_pipe[0], &c, 1);
    pipe(mi_pipe);
}

void bug_escribe_en_extremo_lectura_con_n(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    write_n(mi_pipe[0], &senal, sizeof(senal));
}

void bug_lee_de_extremo_escritura_con_n() {
    int mi_pipe[2];
    pipe(mi_pipe);
    char c;
    read_n(mi_pipe[1], &c, 1);
}

void bien_extremos_correctos_con_n(int senal) {
    int mi_pipe[2];
    pipe(mi_pipe);
    write_n(mi_pipe[1], &senal, sizeof(senal));
    char c;
    read_n(mi_pipe[0], &c, 1);
}
