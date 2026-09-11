# Catálogo de reglas de sclinter

La herramienta avisa de errores y/o formas de programar propensas a errores. Este catálogo sirve para localizar cada error y obtener un comentario más descriptivo del mismo.

## Cómo se debe interpretar un aviso

```
  [línea 90] (SC03) El valor asignado a sin_port no parece correcto.
```

`SC03` es el **código de la regla**: con él puedes buscar aquí qué significa el aviso.

Todas las reglas se muestran como `Warning` (aviso amarillo en VS Code), nunca
como `Error`. La herramienta no puntúa, no impide entregar y no sustituye al
compilador: puede equivocarse, y que no diga nada no garantiza que el ejercicio
esté bien.

Los fragmentos entre `<>` son marcadores: en pantalla aparece el nombre real de
la variable, función o tipo que haya en tu fichero.

Si una regla menciona alguna función no estándar, como `read_n`/`write_n`, se reconocen también otras variantes como `readn`, `readN` y `read_N`, y sus equivalentes de escritura. Son funciones auxiliares clásicas para dotar de semántica "lee todo/escribe todo" a las operaciones de E/S.  

## Los códigos

Se organizan por bloques de familia, con huecos libres al final de cada uno para las
reglas que se añadan en el futuro. Así, `SC5x` significa siempre «procesos».

| Rango | Familia | Reglas |
|---|---|---|
| [`SC01`–`SC09`](#sc01) | Orden de bytes y conversiones | 6 |
| [`SC10`–`SC19`](#sc10) | Montaje y extracción de PDU | 8 |
| [`SC20`–`SC29`](#sc20) | Contenedores de C++ y `.data()` | 8 |
| [`SC30`–`SC39`](#sc30) | `sizeof`, punteros y `argv` | 5 |
| [`SC40`–`SC49`](#sc40) | Sockets y descriptores | 4 |
| [`SC50`–`SC59`](#sc50) | Procesos y señales | 5 |
| [`SC60`–`SC69`](#sc60) | Tuberías | 2 |


<a id="sc01"></a>

## Orden de bytes y conversiones  ·  `SC01`–`SC09`

Pasar un valor de orden de host a orden de red, y al revés.

| Código | Qué detecta |
|---|---|
| **SC01** | Un valor que en el punto de uso está en **orden de red** se usa como si estuviera en orden de host. El caso típico no es un dato recibido, sino al revés: una longitud o un contador calculados en local (`strlen`, `.size()`, `argc`) que se convierten **para enviarlos** y después se reutilizan localmente — ahí ya no valen el número que se calculó. Contextos vigilados: tamaño de `memcpy`/`read_n`/`write_n`, cualquier comparación (lo que cubre los límites de `for`/`while`/`do-while` y las condiciones de `if`), incremento de offset (`+=`), desplazamiento en un buffer e índice `[X]`. El criterio es la **paridad** de conversiones (`htons`/`ntohs`/`htonl`/`ntohl`/`std::byteswap`), no cuál se llamó: son involuciones, así que un número impar deja el valor en orden de red y uno par lo devuelve al de host. Por eso el idioma correcto de recepción (leer → convertir → usar) **no se marca**; se reconoce como origen de red la lectura directa, la extracción con `memcpy`/`mempcpy` desde un buffer leído y los campos de un struct leído. **Tampoco avisa** si: el valor de red se usa **sin convertir** (cero conversiones, p. ej. un campo de 1 byte, donde el orden da igual); la variable (o el struct del que sale) se pasó por **referencia no-const** a una función del propio fichero cuyo efecto sobre ese parámetro no queda demostrado; o la conversión está en una rama de un `if`/`else` **mutuamente excluyente** con el uso. Si ese efecto sí queda demostrado se sigue el rastro a través de la llamada, lo que incluye el **doble swap**: un helper que entrega el dato ya convertido y un llamante que vuelve a convertirlo. Sí avisa cuando la conversión está dentro de un `if` y el uso viene **después** de ese `if`. |
| **SC02** | La conversión de orden de bytes no tiene la anchura del dato. Avisa cuando **se pierde información**: el argumento es más ancho que la conversión (`red = htons(red)` con `red` de 32 bits, se van 2 bytes) o el destino más estrecho (`cabecera = htons(cabecera)` con `cabecera` de 8 bits, se trunca). Avisa también sobre `std::byteswap` con un argumento **sin anchura declarada** (`int`, `short`, `long`, `size_t`): al ser una plantilla deduce el tipo e intercambia los 4 u 8 bytes del entero, y guardarlo en un campo de 2 lo deja a **0** — con `htons` el mismo código funciona, porque su prototipo estrecha el argumento. Sobre un valor de **1 byte**, `std::byteswap` no hace nada y se marca como error de concepto. Y en `htons`/`ntohl` con enteros sin anchura declarada, aunque funcionen, se recuerda que un campo del protocolo se declara con un entero de longitud fija. **No avisa** cuando las anchuras coinciden, ni cuando el destino solo es más ancho (ensanchar no pierde nada), ni cuando el destino es un campo de una cabecera del sistema, que no se puede resolver. |
| **SC03** | Asignación a `sin_port` sin pasar por `htons()`/`std::byteswap`. *"El valor asignado a sin_port no parece correcto."* **No avisa** si: el valor asignado **ya venía convertido** (una variable, o un campo de struct como `cliente.puerto`, al que antes en la misma función se le aplicó `htons`/`byteswap`); la asignación está en una rama de un `if`/`else` sobre *endianness* cuya rama hermana sí convierte el campo; hay más adelante en la función un `if` de *endianness* que lo convierte (patrón "valor por defecto, sobreescrito solo si hace falta"); el valor sale de una función definida en el propio fichero; o viene de una macro que ya convierte (ese caso lo avisa SC06). La conversión tiene que ser **anterior** al uso: si se convierte después, el campo se queda con el valor crudo y sí se avisa. La condición de *endianness* se reconoce escrita en línea, a través de una constante con nombre propio (`const bool ISLITTLE = (std::endian::native == ...);`) y a través de una bandera `bool` que se pone dentro de un `if` de *endianness* (`bool soylittle = false; if (std::endian::native == ...) soylittle = true;`). |
| **SC04** | `x == htons(x);` como sentencia completa — comparación en vez de asignación, el resultado se descarta sin efecto. |
| **SC05** | `std::byteswap()` sobre un **literal entero desnudo** (`std::byteswap(54321)`) o sobre una **macro sin tipo a la vista** (`#define PORT 54321`). `std::byteswap` deduce el tipo de su argumento, y un literal entero es `int`: intercambia 4 bytes en vez de 2 y al guardar el resultado en un `uint16_t` se trunca a 0, sin un solo aviso del compilador ni con `-Wall -Wextra`. `htons()` no tiene este problema porque su prototipo (`uint16_t htons(uint16_t)`) ya fija el tipo del parámetro. **No avisa** si el cuerpo de la macro deja el tipo escrito (un cast, un `static_cast`, un nombre de tipo entero) ni, naturalmente, si el argumento es una variable o una constante con tipo. Solo ve macros definidas con `#define` en el propio fichero. |
| **SC06** | El valor asignado a `sin_port` viene de una **macro del propio fichero cuyo cuerpo contiene la conversión** de orden de bytes (`htons`/`ntohs`/`htonl`/`ntohl`/`std::byteswap`) — p.ej. `#define PORT (htons(54321))` y luego `dir.sin_port = PORT;`. El código funciona; se marca porque la macro esconde la conversión y no se puede ver, al leer la asignación, si está o no. También detecta la conversión doble (`sin_port = htons(PORT)` con `htons` dentro de `PORT`, que deja el puerto del revés). **No persigue las macros en general**: `#define PUERTO 54321` con `htons(PUERTO)` en el punto de uso es correcto y no se marca. |


<a id="sc10"></a>

## Montaje y extracción de PDU  ·  `SC10`–`SC19`

Construir el mensaje que se envía, y sacar los campos del que se recibe.

| Código | Qué detecta |
|---|---|
| **SC10** | `memcpy(almacen.data(), &campo, 2)` en vez de `memcpy(&campo, almacen.data(), 2)` al sacar un campo de un buffer recibido: la copia va al revés, el campo se queda sin valor y se machacan los datos que llegaron. El destino tiene que ser un buffer **leído de la red antes** y que **no se envíe después** (montar la respuesta encima del buffer recibido es legítimo), y además tiene que haber evidencia de que la variable no es el origen de los datos: o es un **parámetro por referencia** no-const al que no se ha escrito nada, o se **lee justo después** sin escritura en medio. El origen también puede ser un **contenedor sin dimensionar** (`memcpy(almacen.data(), texto.data(), n)` con `texto` un `std::string`/`std::vector` al que nunca se le hizo `resize`/`assign`): copiar de su `.data()` es copiar de la nada. Construir un mensaje para enviarlo tiene la misma forma de llamada y **no se marca**. |
| **SC11** | `&struct` **plano** (sin `std::string`/`std::vector`) enviado/recibido entero, sin que exista un `static_assert(sizeof(Tipo) == N)` en el fichero — el compilador puede meter *padding* entre campos sin que se note. |
| **SC12** | `contenedor.size()` **a pelo** (sin ninguna aritmética alrededor) como tamaño de `memcpy` o de las 8 funciones de E/S, con elementos que no ocupan 1 byte — `.size()` da el número de elementos, no de bytes. En cuanto hay aritmética (`.size() * sizeof(T)`) no avisa. |
| **SC13** | Dos `memcpy` de la misma función escriben en el mismo destino sin desplazamiento entre medias. El destino se reconoce escrito de cualquier forma equivalente (`&pdu`, `(uint8_t*)&pdu`, `static_cast<void*>(&pdu)`, `std::addressof(pdu)`). **Mensaje según la forma del destino**: si es un buffer, *"…¿Has olvidado avanzar el puntero para no pisar lo que ya habías escrito?"*; si es la dirección de una variable, *"…extraen del mismo buffer sobre la misma variable, con desplazamientos distintos: el segundo pisa el valor del primero. ¿Querías dos variables distintas?"* **No avisa** si: el offset avanzó entre las dos llamadas (PDU construida campo a campo); las dos escrituras son a **variables distintas que comparten nombre** (una sombrea a la otra); el buffer se **envió** (`write`/`write_n`/`send`/`sendto`) entre medias; las dos copias traen **lo mismo desde el mismo sitio** (misma extracción repetida en dos ramas de un `if`/`else`); o el destino es una variable y los dos orígenes son **buffers distintos** (reutilizarla para dos mensajes sin relación es normal). |
| **SC14** | Se envía con `write`/`write_n`/`send`/`sendto` un buffer declarado en la función en el que **no se ha escrito nada**: viaja con lo que hubiera en esa memoria. Cubre tanto al que se olvida de rellenarlo como al que rellena otra variable por error. El criterio es estricto: basta con que el nombre del buffer aparezca en cualquier otro sitio de la función —un `memcpy`, un `read`, una asignación, un método del contenedor, pasarlo a otra función— para que no se avise. Tampoco avisa si la declaración lleva inicializador (`Pdu pdu{};`), si el buffer es un parámetro (lo rellena quien llama), o si su tipo es un struct del fichero con **todos** sus campos inicializados por defecto — que solo algunos lo tengan no basta. Si el buffer se rellena **después** de enviarlo, tampoco se avisa. |
| **SC15** | Llamada a `mempcpy`. El código funciona con `g++` sobre glibc, así que no es un bug. `mempcpy` es una **extensión de GNU**, no está en el estándar y **`std::mempcpy` no existe** (el compilador responde *"'mempcpy' is not a member of 'std'; did you mean 'memcpy'?"*); solo se declara porque `g++` define `_GNU_SOURCE` por su cuenta, de modo que con otra biblioteca estándar el código deja de compilar. Lo único que aporta sobre `memcpy` es el valor de retorno (`dst + n` en vez de `dst`). Tiene además una consecuencia práctica: las reglas que reconocen la copia por el nombre `memcpy` no ven un `mempcpy`, y el aviso `-Wclass-memaccess` del propio `g++` tampoco — el mismo bug escrito con `mempcpy` pasa desapercibido para todos. Solo se marca `mempcpy`; `memccpy` **no** entra (es de POSIX, no de GNU, y su firma es distinta). |
| **SC16** | `array.size()` usado para enviar cuando hay una variable de offset asociada con al menos un incremento **no constante** sin usar en el envío. No avisa si todos los incrementos del offset son literales/`sizeof(...)`: podría ser un protocolo de tamaño fijo donde `.size()` es correcto. |
| **SC17** | `memcpy` con un tamaño literal mayor que el `std::array<T,N>` de destino/origen. |


<a id="sc20"></a>

## Contenedores de C++ y `.data()`  ·  `SC20`–`SC29`

`std::string`, `std::vector` y `std::array` usados como si fueran memoria en bruto.

| Código | Qué detecta |
|---|---|
| **SC20** | `std::string.data()` como buffer en `read`/`read_n`/`recv`/`recvfrom` (el string es **destino**) — se desaconseja. En `write`/`write_n`/`send`/`sendto` (**origen**) está permitido. |
| **SC21** | `memcpy` con `std::string.data()` como **destino** — se desaconseja siempre. Como **origen** (solo lectura) sí está permitido, no requiere `resize()` previo. |
| **SC22** | Las 8 funciones de E/S sobre `&variable` (`std::string`/`std::vector`) — vuelca la representación interna, no el contenido. Tiene en cuenta el **ámbito**: si en ese punto el nombre corresponde a otra variable que lo sombrea, no se avisa. |
| **SC23** | `&array` (`std::array`) en las 8 funciones de E/S — correcto, pero se usa siempre `.data()` por consistencia. Tiene en cuenta el **ámbito**: si en ese punto el nombre corresponde a otra variable que lo sombrea (p.ej. un `char` declarado dentro de un bloque), no se avisa. |
| **SC24** | `&struct` (definido en el fichero) con algún campo `std::string`/`std::vector`, pasado a `memcpy`/las 8 funciones de E/S — vuelca punteros internos del campo, no su contenido. Tiene en cuenta el **ámbito**: si en ese punto el nombre corresponde a otra variable que lo sombrea, no se avisa. |
| **SC25** | `memcpy` sobre `&variable` donde `variable` es `std::string`/`std::vector` — vuelca la representación interna, no el contenido. `std::array` queda excluido (`&arr == arr.data()`). Tiene en cuenta el **ámbito**: si en ese punto el nombre corresponde a otra variable que lo sombrea, no se avisa. |
| **SC26** | `&array` (siendo `std::array`) como destino/origen de `memcpy` — correcto, pero se usa siempre `.data()` por consistencia con `std::string`/`std::vector`. Tiene en cuenta el **ámbito**: si en ese punto el nombre corresponde a otra variable que lo sombrea, no se avisa. |
| **SC27** | `X.data()` como **destino** de `read`/`read_n`/`recv`/`recvfrom` (2º arg) o de `memcpy` (1er arg), siendo `X` un `std::vector<char\|uint8_t\|std::byte>` **declarado vacío y sin dimensionar** antes del uso. `.data()` de un vector vacío (tamaño 0) no apunta a memoria escribible — UB. No avisa si el vector se dimensionó con `resize(n)`, con constructor de tamaño (`std::vector<...> X(n)`) o con una asignación; **`reserve()` NO cuenta** (cambia la capacidad, no el tamaño). Solo mira vectores declarados en la función: un parámetro por referencia pudo dimensionarlo quien llama. |


<a id="sc30"></a>

## `sizeof`, punteros y `argv`  ·  `SC30`–`SC39`

Medidas que no miden lo que uno cree.

| Código | Qué detecta |
|---|---|
| **SC30** | `sizeof(argv[i])` — siempre el tamaño de un puntero (`char*`), nunca la longitud de la cadena. Hace falta `strlen(argv[i])`. |
| **SC31** | Se accede a `argv[N]` (N>0) fuera de lo que garantiza la comprobación previa de `argc`, o sin haber comprobado `argc` en absoluto. *"Se compara argc contra \<K\>... Aquí se accede a argv[\<N\>], fuera de lo comprobado."* / *"Se accede a argv[\<N\>] sin comprobar que se hayan recibido suficientes argumentos. Para evitar leer memoria fuera de argv, chequea siempre primero el valor de argc."* |
| **SC32** | `sizeof(variable)` con `variable` de tipo `std::string`/`std::vector`/`std::string_view` — da el tamaño del objeto, no del contenido. Hace falta `.size()`. `std::array` excluido. |
| **SC33** | `sizeof(X)` donde `X` es `&expresión` o una variable declarada como puntero, en **cualquier** parte del código (no solo dentro de `memcpy`). *"sizeof(\<X\>) mide el puntero (normalmente 8 bytes), no el objeto al que apunta."* |
| **SC34** | `sizeof(...)` como segundo argumento de `poll()` (debe ser el número de descriptores, no un tamaño en bytes). |


<a id="sc40"></a>

## Sockets y descriptores  ·  `SC40`–`SC49`

Qué descriptor toca en cada momento, y de dónde se lee.

| Código | Qué detecta |
|---|---|
| **SC40** | **Modo 1**: `read`/`read_n`/`write`/`write_n`/`send`/`recv` sobre el mismo descriptor que se pasó a `accept()` (el socket de escucha), en vez del que `accept()` devuelve. *"\<X\> es el socket que espera conexiones, no el que habla con un cliente concreto..."* **Modo 2**: pasar ese descriptor (o un alias suyo) como argumento a una función **definida por el estudiante en el mismo fichero**, después del `accept()` — se considera un error siempre, sin importar qué haga esa función por dentro. Las funciones de biblioteca (`close`, `poll`, `setsockopt`...) quedan excluidas. **Rastrea alias** dentro de la función en los dos modos (`int aux = sd; read(aux, ...)`). |
| **SC41** | `read(0/STDIN_FILENO, ...)` — se desaconseja siempre; la entrada por teclado se trata como secuencia de caracteres (`std::cin`/`std::getline`). **Solo C++** — no se aplica a ficheros `.c`, donde `std::cin` no existe y `read()` ahí es correcto. |
| **SC42** | `read_n(0/STDIN_FILENO, ...)` — exige un número exacto de bytes, no tiene sentido para entrada interactiva de longitud variable. **Se aplica igual a C y C++** (a diferencia de SC41). |
| **SC43** | `accept()` sobre un socket que no ha llamado antes a `listen()` en la misma función. |


<a id="sc50"></a>

## Procesos y señales  ·  `SC50`–`SC59`

`fork`, terminación del hijo, recogida de zombis y señales.

| Código | Qué detecta |
|---|---|
| **SC50** | La rama del hijo (`if (pid == 0)`) no termina con `exit()`/`return`. Mensaje "grave" si está dentro de un bucle que también hace `fork()`; "suave" en caso contrario. Se reconocen como terminación las cadenas `if`/`else` en las que todas las ramas terminan y los bucles infinitos sin `break` que escape. |
| **SC51** | `fork()` sin `wait()`/`waitpid()` (fuera de la rama del hijo) ni `signal(SIGCHLD, SIG_IGN)` en la misma función, ni una manejadora de `SIGCHLD` (registrada con `signal`) que recoja con `wait()`/`waitpid()`. |
| **SC52** | `fork()` ocurre antes del primer `accept()` en la misma función (solo si hay algún `accept()` presente). |
| **SC53** | `errno = X` (asignación) dentro de la **guarda** de un `if`/`for`/`while`/`do-while` o de una **operación booleana** (`&&`, `\|\|`, `!`) — se quería `errno == X`. La condición no compara: toma el valor asignado (una constante de error no es cero → siempre cierta) y además pisa el errno real. Caso típico: `do{...}while((r<0) && (errno = EINTR));`. Asignar a `errno` **fuera** de una guarda es legítimo y no se marca (`errno = 0;` antes de una llamada, `errno = ETIMEDOUT;` para señalizar un error). |
| **SC54** | Argumentos de `kill()`/`signal()` en el orden equivocado (pid↔señal, o señal↔manejador). |


<a id="sc60"></a>

## Tuberías  ·  `SC60`–`SC69`

Extremos de la tubería y orden de creación.

| Código | Qué detecta |
|---|---|
| **SC60** | Escribir en `fd[0]` (extremo de lectura) o leer de `fd[1]` (extremo de escritura) — convención POSIX fija. Cubre `read`/`read_n`/`recv` y `write`/`write_n`/`send`. **Rastrea alias** dentro de la función (`int fd_lectura = mi_pipe[0]; write_n(fd_lectura, ...);`). |
| **SC61** | Se usa `fd[0]`/`fd[1]` antes de que `pipe(fd)` se haya llamado en ese punto de la función. Cubre `read`/`read_n`/`write`/`write_n`. |

