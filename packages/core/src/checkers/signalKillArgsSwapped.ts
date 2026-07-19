import Parser from "web-tree-sitter";

// Regla: kill(pid, sig) y signal(sig, handler) tienen la señal en
// posiciones DISTINTAS (segunda en kill, primera en signal) — mezclar
// el orden es un error clásico. Se detecta buscando un identificador que
// coincida con un nombre de señal POSIX conocido (SIGALRM, SIGUSR1...)
// en la posición equivocada:
//   - kill(SIGxxx, ...)   -> el primer argumento debería ser el pid
//   - signal(..., SIGxxx) -> el segundo argumento debería ser el manejador
//
// No intenta verificar el caso contrario (que el argumento "correcto"
// sea realmente del tipo esperado) porque a menudo es una variable, no
// un literal SIGxxx — eso ya no es un patrón sintáctico fiable.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

// Conjunto de nombres de señal POSIX/Linux. Extraído verificando contra
// las cabeceras reales del sistema (no de memoria):
//   grep -rhE "^#define[[:space:]]+SIG[A-Z0-9]+[[:space:]]+[0-9]" \
//     /usr/include/*/bits/signum-generic.h /usr/include/*/bits/signum-arch.h \
//     /usr/include/*/asm/signal.h
// más SIGRTMIN/SIGRTMAX (macros con valor calculado en tiempo de
// ejecución en glibc, no literales, pero el nombre sigue siendo válido
// como identificador a detectar).
//
// IMPORTANTE: SIG_IGN, SIG_DFL y SIG_ERR (valores especiales de manejador
// para signal(), no nombres de señal) NO deben estar aquí a propósito —
// signal(SIGPIPE, SIG_IGN) es código perfectamente correcto y NO debe
// marcarse. Ver test/sample6.cpp. Tampoco SIGSTKSZ/MINSIGSTKSZ: empiezan
// por "SIG" pero son constantes de tamaño de pila, no señales.
const SIGNAL_NAMES = new Set([
  "SIGHUP", "SIGINT", "SIGQUIT", "SIGILL", "SIGTRAP", "SIGABRT", "SIGIOT",
  "SIGBUS", "SIGFPE", "SIGKILL", "SIGUSR1", "SIGSEGV", "SIGUSR2", "SIGPIPE",
  "SIGALRM", "SIGTERM", "SIGSTKFLT", "SIGCHLD", "SIGCLD", "SIGCONT", "SIGSTOP",
  "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG", "SIGXCPU", "SIGXFSZ", "SIGVTALRM",
  "SIGPROF", "SIGWINCH", "SIGIO", "SIGPOLL", "SIGPWR", "SIGSYS", "SIGUNUSED",
  "SIGLOST", "SIGRTMIN", "SIGRTMAX",
]);

const CALL_QUERY = `
(call_expression
  function: (_) @func
  arguments: (argument_list
    . (_) @arg0
    . (_) @arg1
    .)
) @call
`;

export function findSignalKillArgsSwappedIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(CALL_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg0 = match.captures.find((c) => c.name === "arg0")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    if (!funcNode || !arg0 || !arg1) continue;

    const isKill = /(^|::)kill$/.test(funcNode.text);
    const isSignal = /(^|::)signal$/.test(funcNode.text);
    if (!isKill && !isSignal) continue;

    if (isKill && arg0.type === "identifier" && SIGNAL_NAMES.has(arg0.text)) {
      findings.push({
        startIndex: arg0.startIndex,
        endIndex: arg0.endIndex,
        message:
          `kill(${arg0.text}, ...) — el primer argumento de kill() es el pid, el segundo la señal. ` +
          `Parece que están al revés (kill(pid_t pid, int sig)).`,
      });
    }

    if (isSignal && arg1.type === "identifier" && SIGNAL_NAMES.has(arg1.text)) {
      findings.push({
        startIndex: arg1.startIndex,
        endIndex: arg1.endIndex,
        message:
          `signal(..., ${arg1.text}) — el primer argumento de signal() es la señal, el segundo el ` +
          `manejador. Parece que están al revés (signal(int signum, sighandler_t handler)).`,
      });
    }
  }

  return findings;
}
