// Punto de entrada público de @sclinter/core. Tanto el CLI como
// la extensión de VS Code consumen la herramienta a través de este
// fichero — no importan directamente de src/checkers/ ni src/rules/.
export { Rule, RULES } from "./rules/index";
export { ReportFinding, RangedFinding, buildReport, buildRangedReport, formatReport } from "./rules/report";
