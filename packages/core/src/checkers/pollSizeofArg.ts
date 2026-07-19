import Parser from "web-tree-sitter";

// Regla: el segundo argumento de poll() es el NÚMERO de descriptores a
// vigilar (nfds_t), no un tamaño en bytes. Pasar un sizeof(...) ahí es
// casi con toda seguridad un error, sea lo que sea lo que hay dentro del
// sizeof (si es un array de N elementos, se quiso poner N; si es una
// única estructura pollfd, se quiso poner 1).

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const POLL_QUERY = `
(call_expression
  function: (_) @func
  arguments: (argument_list
    . (_) @arg0
    . (_) @arg1
    . (_) @arg2
    .)
) @call
`;

export function findPollSizeofArgIssues(
  tree: Parser.Tree,
  language: Parser.Language
): Finding[] {
  const query = language.query(POLL_QUERY);
  const findings: Finding[] = [];

  for (const match of query.matches(tree.rootNode)) {
    const funcNode = match.captures.find((c) => c.name === "func")?.node;
    const arg1 = match.captures.find((c) => c.name === "arg1")?.node;
    if (!funcNode || !arg1) continue;

    if (!/(^|::)poll$/.test(funcNode.text)) continue;
    if (!/^sizeof\s*\(/.test(arg1.text)) continue;

    findings.push({
      startIndex: arg1.startIndex,
      endIndex: arg1.endIndex,
      message:
        `El segundo argumento de poll() es el número de descriptores a vigilar, no un tamaño ` +
        `en bytes. "${arg1.text}" probablemente no es lo que quieres pasar aquí.`,
    });
  }

  return findings;
}
