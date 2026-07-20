# sclinter

Extensión de VS Code que integra un catálogo de errores típicos de la asignatura
Software de Comunicaciones (ETSI Telecomunicación, UMA) directamente en el editor.

## Qué hace

Al **guardar** o **abrir** un fichero `.c`/`.cpp`, subraya en amarillo
(como aviso, nunca como error) cualquiera de los patrones del
catálogo: desde `sizeof(puntero)` hasta el orden de los extremos de una
tubería, pasando por el manejo correcto de `htons`/`ntohs`/`byteswap`.

También puedes forzar una revisión manual con la paleta de comandos
(`Ctrl+Shift+P` → "sclinter: revisar este fichero ahora").

## Aviso

Un linter no es un compilador ni ejecuta el código: solo busca patrones
conocidos. Puede dar algún falso positivo (marcar algo correcto) o
pasar por alto un fallo. Tómalo como una ayuda, no como una garantía.

## Instalación

Desde el `.vsix`:

```
code --install-extension sclinter-1.0.4.vsix
```

O desde VS Code: `Extensiones` → menú `...` → `Instalar desde VSIX...`.
