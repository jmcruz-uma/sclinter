#include <string>

// Control de argc-argv-desajuste: `argc - 1` es ARITMÉTICA, no una
// comparación. Acceder a argv[1] sin validar argc NO debe disparar por
// confundir la resta con "argc comparado contra 1" (falso positivo real).
int usa_argc_en_resta(int argc, char* argv[]) {
    int num = argc - 1;
    std::string t = argv[1];
    (void)num; (void)t;
    return 0;
}

// CONTROL que SÍ debe avisar: comparación real que garantiza argv[0..1],
// pero se accede a argv[2].
int valida_argc_de_verdad(int argc, char* argv[]) {
    if (argc < 2) return 1;
    std::string a = argv[1];
    std::string b = argv[2];
    (void)a; (void)b;
    return 0;
}

// CONTROL de falso positivo (repro real de transport-performance-lab,
// server.cpp — patrón idéntico en las 5 implementaciones del repo): la
// guarda inicial es una disyunción cerrada (argc queda en [2,4]) y cada
// argv[i] posterior está bajo un `if` más estrecho que lo cubre. NINGÚN
// acceso a argv aquí debe disparar SC31.
int guardas_compuestas_ok(int argc, char* argv[]) {
    if (argc < 2 || argc > 4) return 1;
    std::string ruta = argv[1];               // argc >= 2  -> OK
    int p = 0, t = 0;
    if (argc >= 3) p = std::stoi(argv[2]);    // argc >= 3  -> OK
    if (argc == 4) t = std::stoi(argv[3]);    // argc == 4  -> OK
    (void)ruta; (void)p; (void)t;
    return 0;
}

// CONTROL que SÍ debe avisar pese a la guarda de disyunción: argc en
// [2,4] garantiza como mucho argv[0..1], pero se accede a argv[4] sin
// ninguna comprobación más estrecha.
int disyuncion_pero_se_pasa(int argc, char* argv[]) {
    if (argc < 2 || argc > 4) return 1;
    std::string x = argv[4];
    (void)x;
    return 0;
}

// CONTROL que SÍ debe avisar: el `if` que envuelve el acceso es
// demasiado flojo — `argc >= 2` no garantiza argv[2].
int if_envolvente_demasiado_flojo(int argc, char* argv[]) {
    if (argc >= 2) {
        std::string y = argv[2];
        (void)y;
    }
    return 0;
}

// PASO 0 (dos pasos: primero "¿se comprobó argc en absoluto?", luego
// lo de siempre) — CONTROL que SÍ debe avisar: `argc` no se menciona
// en ningún punto de la función, y se accede a argv[1] a ciegas.
int sin_comprobar_argc_en_absoluto(int argc, char* argv[]) {
    std::string a = argv[1];
    (void)a;
    return argc;
}

// PASO 0 — CONTROL que NO debe avisar: argv[0] (el nombre del
// programa) siempre es válido, se compruebe argc o no.
int solo_argv0_sin_comprobar(int argc, char* argv[]) {
    std::string nombre = argv[0];
    (void)nombre;
    return argc;
}

// PASO 0 — CONTROL que NO debe avisar: la función NO declara `argc`
// como parámetro propio, solo recibe `argv` (presumiblemente ya
// validado por quien la llama). Sin `argc` en el ámbito de esta
// función no hay nada que ella pudiera comprobar — exigirlo sería
// análisis interprocedural, explícitamente fuera de alcance (ver
// CLAUDE.md, límite intra-función).
void auxiliar_sin_parametro_argc(char* argv[]) {
    std::string a = argv[2];
    (void)a;
}
