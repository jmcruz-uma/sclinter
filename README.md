# sclinter (una herramienta para la asignatura Software de Comunicaciones)

Este proyecto incluye dos herramientas de tipo **linter**, que buscan errores de concepto en el código habitual que implementamos en la asignatura Software de Comunicaciones de la ETSI Telecomunicaicón, en la Universidad de Málaga. Un linter no es un compilador, ni tampco ejecuta nada. Se basa en buscar reglas preestablecidas y, en algunas ocasiones podría dar falsos positivos (decir que algo está mal cuando está bien) o negativos (no detectar algún fallo flagrante). Tómenlo como una ayuda, ¡aunque no sea infalible!

Las herramientas que aquí se incluyen son una interfaz de línea de comandos (*cli*, basada en node.js) y una extensión para Visual Studio Code. Ambas dependen de un motor de reglas.

Organización del repositorio

```
packages/
├── core/              aquí está el motor de reglas; es el núcleo del proyecto
├── cli/               esta es la interfaz de línea de comandos, que depende de core
└── vscode-extension/  extensión para VS Code
```

## Arranque rápido

```
npm install           # una sola vez, instala los tres paquetes
npm run build:core    # compila el motor
npm run build:cli     # compila el CLI
node packages/cli/out/bin/check.js algun_fichero.cpp #para probar el linter
```

El proyecto incluye un test de regresión, muy recomendable si se van a añadir nuevas reglas:

```
npm run test:regression
```

Ese comando ejecuta el CLI contra los ficheros de `packages/core/test/` y avisa si alguno hace que el programa reviente. **No sustituye a revisar a mano**
que el número de avisos de cada fichero es el esperado, pero es el chequeo mínimo y deseable cuando se hacen cambios o añadidos a las reglas.

## Cómo trabajar sobre una regla existente, o cómo añadir una nueva

1. Edita/crea el fichero en `packages/core/src/checkers/`.
2. Regístrala (si es nueva) en `packages/core/src/rules/index.ts`.
3. `npm run test:regression` para comprobar que no rompes nada.
4. Si tienes un caso de prueba nuevo, añádelo a `packages/core/test/` con
   el patrón `sampleN.cpp` (o `.c` si aplica).

Con esto, la herramienta CLI ya reflejará el cambio. Sin embargo, la extensión de VS Code hay que recrearla de nuevo, como explica la siguiente sección:

## Cómo reflejar cambios en la extensión de VS Code

La extensión **no tiene ninguna dependencia hacia `core` en su `package.json`**. Un script copia el código fuente de `core` dentro de la propia
extensión antes de compilarla, dejando un paquete autocontenido.

```
npm run build:extension     # build:core + sincroniza + compila la extensión
npm run package:extension   # todo lo anterior + genera el .vsix
```

El `.vsix` resultante aparece en `packages/vscode-extension/*.vsix`.

### Para cambiar el número de versión el `.vsix`

1. Sube el número de versión en `packages/vscode-extension/package.json`
   (campo `"version"`), porque podría pasar que VS Code no reinstale una versión con el mismo número sobre otra ya instalada.
2. Ejecuta `npm run package:extension`.
3. Prueba el `.vsix` instalándolo (`code --install-extension ...`) o desde el marketplace del entorno gráfico

## Documentación adicional

- `docs/uso-cli.md` : contiene las instrucciones para instalar y usar el linter en modo consola, el CLI