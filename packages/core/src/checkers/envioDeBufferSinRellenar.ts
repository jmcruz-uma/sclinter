import Parser from "web-tree-sitter";
import { identificadorBase } from "./memcpyRepeatedDestination";
import { ESCRITURAS } from "./funcionesDeES";

// Regla: se envía (write/write_n/send/sendto) un buffer declarado en la
// función en el que no se ha escrito nada. Viaja con lo que hubiera en esa
// memoria.
//
// La regla persigue la CONSECUENCIA, no la intención. Los dos casos reales
// del corpus llegan al mismo sitio por caminos distintos:
//
//   PDU suscripcion;                                  // nunca rellena nada
//   write_n(sd, &suscripcion, sizeof(suscripcion));
//
//   std::array<char, 10> envio;
//   memcpy(almacen.data(), &num_textos, 2);           // rellena OTRO buffer
//   ...
//   write_n(csd, envio.data(), 6);                    // y envía este
//
// Adivinar el segundo (un despiste de nombres) sería imposible; comprobar
// que el buffer enviado no se ha tocado es mecánico.
//
// CRITERIO DELIBERADAMENTE ESTRICTO: se avisa solo si el identificador del
// buffer no aparece en NINGÚN otro sitio de la función, salvo su propia
// declaración y los argumentos de las llamadas de envío. Cualquier otra
// aparición —un memcpy, un read, una asignación, un método del contenedor,
// pasarlo a otra función, hasta un cout— cuenta como "puede haberse
// rellenado" y no se avisa.
//
// De ese criterio sale gratis lo que en otras reglas cuesta una excepción
// explícita: si el buffer se pasa a una función del propio fichero que
// pudiera rellenarlo, el identificador aparece y el caso se descarta solo.
// No hace falta análisis interprocedural ni escapatoria alguna.
//
// Tampoco se avisa si la declaración lleva inicializador (`PDU pdu{};`,
// `std::string texto = "hola"`), que es justo la forma correcta de dejar el
// buffer en un estado conocido.
//
// LÍMITE ACEPTADO: si el estudiante rellena el buffer DESPUÉS de enviarlo,
// el identificador aparece y nos callamos. Es un bug real que se deja
// pasar: distinguirlo exigiría razonar por posición, y con bucles (rellenar
// al final de una iteración, enviar al principio de la siguiente) eso da
// falsos positivos con facilidad.
//
// EXCLUSIÓN (decisión del profesor): un struct definido en el fichero cuyos
// campos tengan TODOS inicializador por defecto sí está relleno, y se calla.
// Que solo algunos lo tengan NO basta: en esta asignatura lo normal es
// rellenar los campos del PDU antes de enviarlo, así que un struct a medias
// sigue siendo un error que merece el aviso.

export interface Finding {
  startIndex: number;
  endIndex: number;
  message: string;
}

const SEND_FUNCS = ESCRITURAS;

function nombrePelado(node: Parser.SyntaxNode | null): string {
  return node ? node.text.replace(/\s+/g, "").replace(/^.*::/, "") : "";
}

function recorre(n: Parser.SyntaxNode, visita: (n: Parser.SyntaxNode) => void) {
  visita(n);
  for (const hijo of n.namedChildren) recorre(hijo, visita);
}

/** Structs/clases del fichero cuyos campos tienen TODOS inicializador por
 * defecto (sonda del árbol: cada `field_declaration` lleva entonces un campo
 * `default_value`). Un struct sin campos no cuenta: no hay nada que
 * inicializar y enviarlo sigue sin tener sentido. */
function structsTotalmenteInicializados(root: Parser.SyntaxNode): Set<string> {
  const nombres = new Set<string>();
  recorre(root, (n) => {
    if (n.type !== "struct_specifier" && n.type !== "class_specifier") return;
    const nombre = n.childForFieldName("name")?.text;
    const cuerpo = n.childForFieldName("body");
    if (!nombre || !cuerpo) return;
    const campos = cuerpo.namedChildren.filter((c) => c.type === "field_declaration");
    if (campos.length === 0) return;
    if (campos.every((c) => c.childForFieldName("default_value") !== null)) nombres.add(nombre);
  });
  return nombres;
}

/** Declaraciones locales SIN inicializador: nombre → nodo de la declaración.
 * Las que llevan inicializador (`init_declarator`) quedan fuera a propósito,
 * y los parámetros tampoco entran (los rellena quien llama).
 *
 * `function_declarator` TAMBIÉN queda fuera, y esto no es evidente. Un
 * constructor con paréntesis (`std::string dominio(argv[3]);`) se parsea así,
 * no como `init_declarator`: tree-sitter no tiene tabla de símbolos, y en C++
 * `T(x);` es ambiguo si no se sabe si `T` es un tipo — `argv[3]` es una
 * declaración de parámetro perfectamente válida (parámetro sin nombre, de tipo
 * `argv`, array de 3). Sin poder resolverlo, la gramática elige la rama de
 * función. Con un literal entre los argumentos (`std::string d(argv[3], 3);`)
 * sí desambigua, porque un `3` no puede ser un parámetro, y entonces vuelve a
 * salir `init_declarator`; de ahí que el fallo apareciera solo en unas
 * declaraciones y no en otras.
 *
 * Tres falsos positivos reales del corpus salieron de aquí. Declarar una
 * función dentro del cuerpo de otra es legal pero no se ve en un examen, así
 * que darlo por inicializado es seguro: el error posible es callar de más. */
function declaracionesSinInicializador(fnDef: Parser.SyntaxNode): Map<string, Parser.SyntaxNode> {
  const declaraciones = new Map<string, Parser.SyntaxNode>();
  recorre(fnDef, (n) => {
    if (n.type !== "declaration") return;
    for (let i = 0; i < n.childCount; i++) {
      if (n.fieldNameForChild(i) !== "declarator") continue;
      const declarador = n.child(i);
      if (!declarador) continue;
      if (declarador.type === "init_declarator" || declarador.type === "function_declarator") continue;
      let cur: Parser.SyntaxNode | null = declarador;
      while (cur && cur.type !== "identifier") {
        cur = cur.childForFieldName("declarator") ?? cur.namedChildren[0] ?? null;
      }
      if (cur) declaraciones.set(cur.text, n);
    }
  });
  return declaraciones;
}

function tipoDeclarado(declaracion: Parser.SyntaxNode): string {
  const tipo = declaracion.childForFieldName("type");
  if (!tipo) return "";
  // `struct PDU {...} var;` — el campo `type` es el struct_specifier entero;
  // lo que interesa es su nombre.
  if (tipo.type === "struct_specifier" || tipo.type === "class_specifier") {
    return tipo.childForFieldName("name")?.text ?? "";
  }
  return tipo.text.replace(/\s+/g, "");
}

export function findEnvioDeBufferSinRellenarIssues(
  tree: Parser.Tree,
  _language: Parser.Language
): Finding[] {
  const findings: Finding[] = [];
  const yaInicializados = structsTotalmenteInicializados(tree.rootNode);

  recorre(tree.rootNode, (fnDef) => {
    if (fnDef.type !== "function_definition") return;

    // Llamadas de envío de esta función, con el nombre base de su buffer
    // (siempre el segundo argumento en las cuatro funciones).
    const envios: { nombre: string; llamada: Parser.SyntaxNode; buffer: Parser.SyntaxNode; fn: string }[] = [];
    recorre(fnDef, (n) => {
      if (n.type !== "call_expression") return;
      const bare = nombrePelado(n.childForFieldName("function"));
      if (!SEND_FUNCS.includes(bare)) return;
      const buffer = n.childForFieldName("arguments")?.namedChildren[1];
      const nombre = identificadorBase(buffer ?? null);
      if (buffer && nombre) envios.push({ nombre, llamada: n, buffer, fn: bare });
    });
    if (envios.length === 0) return;

    const declaraciones = declaracionesSinInicializador(fnDef);

    for (const { nombre, llamada, buffer, fn } of envios) {
      const declaracion = declaraciones.get(nombre);
      if (!declaracion) continue;
      if (yaInicializados.has(tipoDeclarado(declaracion))) continue;

      let otrasApariciones = 0;
      recorre(fnDef, (n) => {
        if (n.type !== "identifier" || n.text !== nombre) return;
        if (n.startIndex >= declaracion.startIndex && n.endIndex <= declaracion.endIndex) return;
        for (const otro of envios) {
          if (n.startIndex >= otro.llamada.startIndex && n.endIndex <= otro.llamada.endIndex) return;
        }
        otrasApariciones++;
      });

      if (otrasApariciones === 0) {
        findings.push({
          startIndex: buffer.startIndex,
          endIndex: buffer.endIndex,
          message:
            `${fn}() envía ${nombre}, pero en toda la función no se escribe nada en ${nombre}: ` +
            `viaja con lo que hubiera en esa memoria. Revisa si te has olvidado de rellenarlo, ` +
            `o si rellenaste otra variable por error.`,
        });
      }
    }
  });

  return findings;
}
