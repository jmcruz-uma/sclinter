import Parser from "web-tree-sitter";
import { RULES } from "./index";

export interface ReportFinding {
  ruleId: string;
  ruleTitulo: string;
  line: number;
  message: string;
}

export function buildReport(
  code: string,
  tree: Parser.Tree,
  language: Parser.Language,
  opts: { isC?: boolean } = {}
): ReportFinding[] {
  const findings: ReportFinding[] = [];
  const rules = opts.isC ? RULES.filter((r) => !r.cppOnly) : RULES;

  for (const rule of rules) {
    for (const f of rule.run(tree, language)) {
      const before = code.slice(0, f.startIndex);
      const line = before.split("\n").length;
      findings.push({
        ruleId: rule.id,
        ruleTitulo: rule.titulo,
        line,
        message: f.message,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line);
  return findings;
}

export interface RangedFinding {
  ruleId: string;
  ruleTitulo: string;
  message: string;
  startIndex: number;
  endIndex: number;
}

/** Igual que buildReport, pero conserva startIndex/endIndex en vez de reducir a
 * un número de línea — lo necesita la extensión de VS Code para poder
 * subrayar el fragmento exacto, no solo la línea entera. */
export function buildRangedReport(
  tree: Parser.Tree,
  language: Parser.Language,
  opts: { isC?: boolean } = {}
): RangedFinding[] {
  const findings: RangedFinding[] = [];
  const rules = opts.isC ? RULES.filter((r) => !r.cppOnly) : RULES;

  for (const rule of rules) {
    for (const f of rule.run(tree, language)) {
      findings.push({
        ruleId: rule.id,
        ruleTitulo: rule.titulo,
        message: f.message,
        startIndex: f.startIndex,
        endIndex: f.endIndex,
      });
    }
  }

  return findings;
}

export function formatReport(fileName: string, findings: ReportFinding[]): string {
  const lines: string[] = [];
  lines.push(`=== Informe previo a entrega — ${fileName} ===`);
  lines.push("");

  if (findings.length === 0) {
    lines.push("Sin avisos de las reglas conocidas. Esto NO es una garantía de que el");
    lines.push("ejercicio esté bien: solo confirma que no aparece ninguno de los patrones");
    lines.push("de error mecánico ya catalogados.");
  } else {
    for (const f of findings) {
      lines.push(`  [línea ${f.line}] (${f.ruleId}) ${f.message}`);
    }
    lines.push("");
    lines.push(`${findings.length} aviso(s). Revísalos antes de entregar — no bloquean la`);
    lines.push("entrega, son pistas sobre errores mecánicos típicos de convocatorias anteriores.");
  }

  return lines.join("\n");
}
