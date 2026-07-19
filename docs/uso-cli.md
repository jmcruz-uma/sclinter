# sclinter — modo consola

Si usas VS Code, instala mejor la extensión (avisa solo al guardar, sin
tocar la terminal). Esto es para quien prefiera un terminal, o un editor
distinto de VS Code.

## Requisitos

Solo `node` (cualquier versión reciente). Nada más — el analizador es
autocontenido.

## Instalación

Necesitas el paquete `core` compilado y el `cli` compilado. Si te han
pasado el monorepo entero:

```
npm install
npm run build:core
npm run build:cli
```

Si en el futuro se publica un paquete ya compilado y listo (sin código
fuente ni necesidad de compilar nada), esta sección se actualizará con
esas instrucciones más simples — por ahora, compilar es el único camino.

## Uso

```
node packages/cli/out/bin/check.js mi_ejercicio.cpp
```

Un atajo cómodo, si no quieres escribir la ruta completa cada vez:

```
alias sclinter='node /ruta/al/repo/packages/cli/out/bin/check.js'
sclinter mi_ejercicio.cpp
```

## Cómo leer el resultado

```
=== Informe previo a entrega — mi_ejercicio.cpp ===

  [línea 40] (argc-argv-desajuste) Se compara argc contra 3 en esta...

1 aviso(s). Revísalos antes de entregar — no bloquean la entrega...
```

- **No es un compilador**: si tu código no compila, eso se arregla aparte
  (`g++ -Wall` primero, siempre).
- **No bloquea nada**: puedes entregar aunque salgan avisos — son pistas,
  no errores garantizados, pero merece la pena mirarlos dos veces.
- **"Sin avisos" no es sinónimo de "está bien"**: el catálogo conoce un
  conjunto concreto de fallos típicos, no revisa si tu solución cumple el
  enunciado ni si el enfoque tiene sentido.

## Diferencia con `.c` y `.cpp`

Algunas reglas son exclusivas de C++ (por ejemplo, la que prohíbe `read()`
sobre el teclado sugiere `std::cin`, que no existe en C) — el analizador
mira la extensión real del fichero para decidir si aplican o no. Un `.c`
y un `.cpp` con el mismo código pueden dar avisos distintos, a propósito.
