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
