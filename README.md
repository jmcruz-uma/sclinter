# sclinter (monorepo)

Catálogo de errores mecánicos típicos de Software de Comunicaciones (UMA,
Departamento de Lenguajes y Ciencias de la Computación). Tres paquetes,
un solo repositorio:

```
packages/
├── core/              ← el motor: 30 reglas + tree-sitter. ÚNICA fuente de verdad.
├── cli/                ← interfaz de línea de comandos, depende de core
└── vscode-extension/   ← extensión de VS Code, NO depende de core en tiempo
                           de ejecución (ver más abajo, es importante)
```

**Regla de oro: el código de detección solo se edita en `packages/core/src/`.**
Ni `packages/cli` ni `packages/vscode-extension` tienen su propia copia de
las reglas — `cli` importa `core` como paquete normal; `vscode-extension`
se sincroniza con un script antes de cada build (explicado abajo).

## Arranque rápido

```
npm install          # una sola vez, instala los tres paquetes
npm run build:core    # compila el motor
npm run build:cli     # compila el CLI
node packages/cli/out/bin/check.js algun_fichero.cpp
```

O, más cómodo, ambas cosas de una vez:

```
npm run test:regression
```

Ejecuta el CLI contra los 33 ficheros de `packages/core/test/` y avisa si
alguno hace que el programa reviente. **No sustituye a revisar a mano**
que el número de avisos de cada fichero es el esperado — es solo la red
de seguridad mínima de "¿sigue funcionando sin explotar?".

## Trabajar en una regla existente, o añadir una nueva

1. Edita/crea el fichero en `packages/core/src/checkers/`.
2. Regístrala (si es nueva) en `packages/core/src/rules/index.ts`.
3. `npm run test:regression` para comprobar que no rompes nada.
4. Si tienes un caso de prueba nuevo, añádelo a `packages/core/test/` con
   el patrón `sampleN.cpp` (o `.c` si aplica).

Con esto, el CLI ya refleja el cambio. La extensión de VS Code **no**, hasta
que hagas el siguiente paso.

## Publicar el cambio en la extensión de VS Code

Aquí está la parte que hay que tener clara, porque no es tan directa como
cabría esperar de un monorepo normal.

### Por qué la extensión no depende de `core` como paquete del workspace

Se probó, y **no funciona bien**: `vsce` (la herramienta oficial que
genera el `.vsix`) no gestiona correctamente los paquetes enlazados por
*npm workspaces* — en las pruebas, listaba ficheros duplicados y llegaba a
colar ficheros de fuera de la carpeta de la extensión dentro del paquete
final. No es un problema de configuración mal puesta; es una limitación
real de la herramienta al operar dentro de un monorepo. La solución que
se adoptó, después de comprobar que funciona de verdad: la extensión
**no tiene ninguna dependencia hacia `core` en su `package.json`** — en
su lugar, un script copia el código fuente de `core` dentro de la propia
extensión antes de compilar, dejando un paquete autocontenido, exactamente
igual que si fuera un proyecto de extensión independiente sin monorepo de
por medio.

### El flujo completo

```
npm run build:extension     # build:core + sincroniza + compila la extensión
npm run package:extension   # todo lo anterior + genera el .vsix
```

El `.vsix` resultante aparece en `packages/vscode-extension/*.vsix`.

**Importante**: `npm run package:extension` empaqueta en un directorio
**temporal fuera del repo** (`os.tmpdir()`), no dentro de
`packages/vscode-extension` directamente — es la misma cautela de antes:
incluso con la extensión ya sincronizada y sin depender de `core`,
ejecutar `vsce package` estando *dentro* de una carpeta anidada en un
workspace de npm seguía dando problemas en las pruebas. El script
(`packages/vscode-extension/scripts/package-isolated.js`) copia todo lo
necesario a un directorio limpio, instala ahí desde cero, empaqueta, y
trae el `.vsix` de vuelta. Es más lento que un `vsce package` normal
(reinstala `node_modules` cada vez), pero es la versión que **se ha
comprobado que funciona** sin sorpresas — no merece la pena arriesgarse a
"optimizarlo" sin volver a probarlo a fondo.

### Antes de subir la versión del `.vsix`

1. Sube el número de versión en `packages/vscode-extension/package.json`
   (campo `"version"`) — VS Code no reinstala una versión con el mismo
   número sobre otra ya instalada.
2. `npm run package:extension`.
3. Prueba el `.vsix` de verdad (`code --install-extension ...`) antes de
   repartirlo — nada de lo anterior sustituye a abrirlo en un VS Code
   real y comprobar que el subrayado aparece donde debe.

## Icono de la extensión

`packages/vscode-extension/icon.png` (256×256). Si se cambia, comprobar
que el PNG no tenga chunks corruptos (pasó una vez: un perfil de color
ICC con el CRC mal, que algunas herramientas rechazaban) — `identify
archivo.png` o abrirlo con Pillow (`Image.open(...).verify()`) antes de
darlo por bueno.

## Documentación adicional

- `docs/uso-cli.md` — instrucciones para instalar y usar el CLI, pensadas
  para repartir a los estudiantes o a otros profesores (sustituye a la
  antigua "plantilla de práctica" con tareas de VS Code integradas — ya
  no hace falta, la extensión cubre ese caso mejor).
