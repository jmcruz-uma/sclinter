import Parser from "web-tree-sitter";
import { findSizeofPunteroIssues } from "../checkers/sizeofPuntero";
import { findRepeatedDestinationIssues } from "../checkers/memcpyRepeatedDestination";
import { findArgcArgvMismatchIssues } from "../checkers/argcArgvMismatch";
import { findPollSizeofArgIssues } from "../checkers/pollSizeofArg";
import { findMemcpyContainerAddressDestinationIssues } from "../checkers/memcpyContainerAddressDestination";
import { findMemcpyArrayOverflowIssues } from "../checkers/memcpyArrayOverflow";
import { findMemcpyStringDataProhibitedIssues } from "../checkers/memcpyStringDataProhibited";
import { findMempcpyExtensionGnuIssues } from "../checkers/mempcpyExtensionGnu";
import { findMemcpyArrayAddressStyleIssues } from "../checkers/memcpyArrayAddressStyle";
import { findSignalKillArgsSwappedIssues } from "../checkers/signalKillArgsSwapped";
import { findSinPortNoHtonsIssues, findConversionEscondidaEnMacroIssues } from "../checkers/sinPortNoHtons";
import { findByteswapSobreValorSinTipoIssues } from "../checkers/byteswapSobreValorSinTipo";
import { findEnvioDeBufferSinRellenarIssues } from "../checkers/envioDeBufferSinRellenar";
import { findAcceptSinListenIssues } from "../checkers/acceptSinListen";
import { findEntradaSalidaConSocketEscuchaIssues } from "../checkers/entradaSalidaConSocketEscucha";
import { findForkAntesDeAcceptIssues } from "../checkers/forkAntesDeAccept";
import { findZombiesSinReapIssues } from "../checkers/zombiesSinReap";
import { findHijoSinTerminarIssues } from "../checkers/hijoSinTerminar";
import { findPipeUsoAntesDeCrearIssues } from "../checkers/pipeUsoAntesDeCrear";
import { findPipeExtremosInvertidosIssues } from "../checkers/pipeExtremosInvertidos";
import { findIoContainerAddressIssues } from "../checkers/ioContainerAddress";
import { findIoArrayAddressStyleIssues } from "../checkers/ioArrayAddressStyle";
import { findReadDesdeTecladoIssues } from "../checkers/readDesdeTeclado";
import { findReadNEnTecladoIssues } from "../checkers/readNEnTeclado";
import { findIoStringDataProhibitedIssues } from "../checkers/ioStringDataProhibited";
import { findByteswapUsoLocalIncorrectoIssues } from "../checkers/byteswapUsoLocalIncorrecto";
import { findByteswapComparacionEnVezDeAsignacionIssues } from "../checkers/byteswapComparacionEnVezDeAsignacion";
import { findStructConContenedorDireccionIssues } from "../checkers/structConContenedorDireccion";
import { findSizeofArgvElementoIssues } from "../checkers/sizeofArgvElemento";
import { findSizeofContenedorIssues } from "../checkers/sizeofContenedor";
import { findStructSinStaticAssertIssues } from "../checkers/structSinStaticAssert";
import { findSizeEnVezDeOffsetIssues } from "../checkers/sizeEnVezDeOffset";
import { findSizeContenedorNoByteSinAritmeticaIssues } from "../checkers/sizeContenedorNoByteSinAritmetica";
import { findIoVectorDataIssues } from "../checkers/ioVectorData";
import { findErrnoAsignacionEnVezDeComparacionIssues } from "../checkers/errnoAsignacionEnVezDeComparacion";
import { findMemcpyInvertidoAlExtraerIssues } from "../checkers/memcpyInvertidoAlExtraer";

export interface Rule {
  id: string;
  titulo: string;
  run: (tree: Parser.Tree, language: Parser.Language) => { startIndex: number; endIndex: number; message: string }[];
  /** true si la justificación de la regla depende de construcciones de C++
   * (p.ej. "usa std::cin en vez de read()") aunque el PATRÓN que detecta
   * (read(0, ...)) sea sintaxis C válida y correcta. Sin este campo, la
   * regla se aplicaría igual a ficheros .c puro, donde std::cin ni existe
   * — falso positivo real, no solo ruido. La mayoría de las reglas del
   * catálogo NO necesitan este campo: si el patrón que buscan ya requiere
   * sintaxis de C++ (std::string, std::array...), simplemente no aparece
   * nunca en un fichero .c, así que ya quedan a salvo sin marcarlas. */
  cppOnly?: boolean;
}

// Para añadir una regla nueva a partir de un examen futuro:
//   1. Copia un fichero de src/checkers/ como plantilla.
//   2. Escribe la query de tree-sitter para el patrón concreto.
//   3. Regístrala aquí con un id y un título breve.
// No hace falta tocar nada más: el informe y el CLI la recogen solas.
export const RULES: Rule[] = [
  {
    id: "sizeof-puntero",
    titulo: "sizeof(puntero) en cualquier parte del código — sustituye a memcpy-sizeof-puntero, más general",
    run: findSizeofPunteroIssues,
  },
  {
    id: "memcpy-destino-repetido",
    titulo: "memcpy escribe dos veces en el mismo destino sin desplazar",
    run: findRepeatedDestinationIssues,
  },
  {
    id: "argc-argv-desajuste",
    titulo: "argv[N] accedido más allá de lo que garantiza la comprobación de argc",
    run: findArgcArgvMismatchIssues,
  },
  {
    id: "poll-sizeof",
    titulo: "poll() con sizeof(...) como número de descriptores",
    run: findPollSizeofArgIssues,
  },
  {
    id: "memcpy-direccion-contenedor",
    titulo: "memcpy sobre &variable de std::string o std::vector sobreescribe su representación interna (std::array queda excluido a propósito, ver checker)",
    run: findMemcpyContainerAddressDestinationIssues,
  },
  {
    id: "memcpy-array-overflow",
    titulo: "memcpy con más bytes de los que caben en un std::array<T,N>",
    run: findMemcpyArrayOverflowIssues,
  },
  {
    id: "memcpy-string-data-prohibido",
    titulo: "memcpy en std::string.data() — prohibido siempre por normativa de la asignatura, no solo cuando hay riesgo",
    run: findMemcpyStringDataProhibitedIssues,
  },
  {
    id: "memcpy-array-direccion-estilo",
    titulo: "&std::array en memcpy — correcto, pero se pide .data() por consistencia de estilo",
    run: findMemcpyArrayAddressStyleIssues,
  },
  {
    id: "mempcpy-extension-gnu",
    titulo: "mempcpy — extensión de GNU fuera del estándar (no existe std::mempcpy); además se escapa de las reglas que reconocen memcpy por su nombre",
    run: findMempcpyExtensionGnuIssues,
  },
  {
    id: "signal-kill-args-invertidos",
    titulo: "argumentos de kill()/signal() en el orden equivocado (posición de SIGxxx)",
    run: findSignalKillArgsSwappedIssues,
  },
  {
    id: "sin-port-no-htons",
    titulo: "asignación a sin_port sin pasar por htons() — mensaje deliberadamente sin pista conceptual",
    run: findSinPortNoHtonsIssues,
  },
  {
    id: "conversion-escondida-en-macro",
    titulo: "el valor de sin_port viene de una macro que esconde la conversión de orden de bytes (nivel 4, normativa)",
    run: findConversionEscondidaEnMacroIssues,
  },
  {
    id: "envio-de-buffer-sin-rellenar",
    titulo: "se envía con write/write_n/send/sendto un buffer local en el que no se ha escrito nada en toda la función",
    run: findEnvioDeBufferSinRellenarIssues,
  },
  {
    id: "byteswap-sobre-valor-sin-tipo",
    titulo: "std::byteswap() sobre un literal desnudo o una macro sin tipo — deduce int e intercambia 4 bytes en vez de 2",
    run: findByteswapSobreValorSinTipoIssues,
  },
  {
    id: "accept-sin-listen",
    titulo: "accept() sin listen() previo en la misma función — mensaje sutil",
    run: findAcceptSinListenIssues,
  },
  {
    id: "entrada-salida-con-socket-escucha",
    titulo: "read/read_n/write/write_n/send/recv sobre el socket de escucha en vez del devuelto por accept()",
    run: findEntradaSalidaConSocketEscuchaIssues,
  },
  {
    id: "fork-antes-de-accept",
    titulo: "fork() antes de la primera accept() en la misma función",
    run: findForkAntesDeAcceptIssues,
  },
  {
    id: "zombies-sin-reap",
    titulo: "fork() sin wait()/waitpid() ni signal(SIGCHLD, SIG_IGN) en la misma función",
    run: findZombiesSinReapIssues,
  },
  {
    id: "hijo-sin-terminar",
    titulo: "la rama del hijo no termina explícitamente (exit/return); grave si está en un bucle con fork()",
    run: findHijoSinTerminarIssues,
  },
  {
    id: "pipe-uso-antes-de-crear",
    titulo: "se usa fd[0]/fd[1] antes de que pipe(fd) se haya llamado en la misma función",
    run: findPipeUsoAntesDeCrearIssues,
  },
  {
    id: "pipe-extremos-invertidos",
    titulo: "escribir en fd[0] (lectura) o leer de fd[1] (escritura) de una tubería",
    run: findPipeExtremosInvertidosIssues,
  },
  {
    id: "io-container-direccion",
    titulo: "&contenedor (std::string/std::vector) como buffer en read/read_n/recv/recvfrom/write/write_n/send/sendto",
    run: findIoContainerAddressIssues,
  },
  {
    id: "io-array-direccion-estilo",
    titulo: "&std::array como buffer en esas mismas funciones — correcto, pero se pide .data() por estilo",
    run: findIoArrayAddressStyleIssues,
  },
  {
    id: "read-desde-teclado",
    titulo: "read(0/STDIN_FILENO, ...) — prohibido en C++ por normativa de la asignatura, cualquiera que sea el tipo del destino",
    run: findReadDesdeTecladoIssues,
    // cppOnly de verdad, no por el mensaje: en C leer del teclado con
    // read(0,...) NO está prohibido — en cursos donde no se da scanf puede ser
    // la única forma que conocen. La prohibición es de C++, donde sí hay
    // std::cin/std::getline. OJO: esto NO es el mismo caso que
    // `read-n-en-teclado`, que se marcó cppOnly por error y hubo que revertir
    // (allí read_n() sobre el teclado es un bug igual de real en C, y lo que
    // había que arreglar era el mensaje). Aquí la diferencia es normativa, no
    // de redacción, así que el cppOnly se queda.
    cppOnly: true,
  },
  {
    id: "read-n-en-teclado",
    titulo: "read_n(0/STDIN_FILENO, ...) — exige bytes exactos, no tiene sentido para entrada interactiva (válido en C y en C++)",
    run: findReadNEnTecladoIssues,
  },
  {
    id: "io-string-data-prohibido",
    titulo: "std::string.data() como buffer en read/read_n/recv/recvfrom/write/write_n/send/sendto — prohibido siempre",
    run: findIoStringDataProhibitedIssues,
  },
  {
    id: "byteswap-uso-local-incorrecto",
    titulo: "variable no recibida de red, usada localmente tras un número impar de htons/ntohs/byteswap",
    run: findByteswapUsoLocalIncorrectoIssues,
  },
  {
    id: "byteswap-comparacion-en-vez-de-asignacion",
    titulo: "== en vez de = tras htons/ntohs/std::byteswap — el resultado se descarta",
    run: findByteswapComparacionEnVezDeAsignacionIssues,
  },
  {
    id: "struct-con-contenedor-direccion",
    titulo: "&struct propio (con campo std::string/std::vector) en memcpy/read/write y afines",
    run: findStructConContenedorDireccionIssues,
  },
  {
    id: "sizeof-argv-elemento",
    titulo: "sizeof(argv[i]) da el tamaño de un puntero, no la longitud de la cadena",
    run: findSizeofArgvElementoIssues,
  },
  {
    id: "sizeof-contenedor",
    titulo: "sizeof(std::string/vector/string_view) en vez de .size()",
    run: findSizeofContenedorIssues,
  },
  {
    id: "struct-sin-static-assert",
    titulo: "struct plano (sin contenedores) enviado/recibido entero sin static_assert(sizeof(...)==N) que verifique el padding",
    run: findStructSinStaticAssertIssues,
  },
  {
    id: "size-en-vez-de-offset",
    titulo: "array.size() enviado cuando hay un offset no constante asociado sin usar",
    run: findSizeEnVezDeOffsetIssues,
  },
  {
    id: "size-contenedor-no-byte-sin-aritmetica",
    titulo: "contenedor.size() a pelo (sin aritmética) con elementos no-byte, como tamaño de memcpy o E/S",
    run: findSizeContenedorNoByteSinAritmeticaIssues,
  },
  {
    id: "io-vector-data",
    titulo: "read/recv/memcpy sobre vector<char|uint8_t|byte>.data() estando el vector vacío (sin resize/tamaño) — UB",
    run: findIoVectorDataIssues,
  },
  {
    id: "errno-asignacion-en-vez-de-comparacion",
    titulo: "errno = X dentro de una condición o booleana (se quería errno == X); asignar a errno fuera de una guarda sí es legítimo",
    run: findErrnoAsignacionEnVezDeComparacionIssues,
  },
  {
    id: "memcpy-invertido-al-extraer",
    titulo: "memcpy(buffer_recibido, &campo, n) — argumentos invertidos al extraer: machaca los datos recibidos y el campo se queda sin valor",
    run: findMemcpyInvertidoAlExtraerIssues,
  },
];
