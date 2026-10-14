# Prueba 01 — Circuitos de predicados de umbral (mayoría de edad y vigencia)

**Objetivo de la propuesta:** OE2 (circuitos zk-SNARK), conjunto 1 de predicados: *comparación contra un umbral*. También adelanta el criterio de privacidad del OE4.d y una línea base de las métricas del OE5.
**Fecha:** 2026-10-13
**Estado:** ✅ completada, con 28/28 pruebas superadas y el flujo verificado contra la documentación oficial (sección 5).

Contenido:
1. [Qué se construyó](#1-qué-se-construyó)
2. [Marco teórico](#2-marco-teórico)
3. [Cómo reproducir](#3-cómo-reproducir)
4. [Resultados](#4-resultados)
5. [Conformidad con la documentación oficial](#5-conformidad-con-la-documentación-oficial)
6. [Hallazgos](#6-hallazgos)
7. [Referencias](#7-referencias)
8. [Limitaciones y pendientes](#8-limitaciones-y-pendientes)

---

## 1. Qué se construyó

| Archivo | Descripción |
|---|---|
| `circuits/umbral.circom` | Plantillas `MayoriaEdad` y `Vigencia` |
| `circuits/mayoria_edad.circom` | `main`: privada `fechaNacimiento`; públicas `fechaActual`, `edadMinima` |
| `circuits/vigencia.circom` | `main`: privada `fechaExpiracion`; pública `fechaActual` |
| `test/circuitos.test.js` | Pruebas unitarias sobre el witness (acepta y rechaza) |
| `test/pruebas.test.js` | Pruebas Groth16 de extremo a extremo, manipulación y privacidad |
| `test/fixtures/mayoria_edad_sin_cotas.circom` | Control negativo, vulnerable a propósito |
| `scripts/setup.js` | Compilación y *trusted setup* completo (fases 1 y 2 con beacon y verificación) |
| `scripts/bench.js` | Métricas de desempeño (N repeticiones) |
| `build/bitacora-setup.json` | Valores de los beacons usados (generado) |

---

## 2. Marco teórico

### 2.1 Dónde encaja en la tesis
En el **Triángulo de Confianza** (emisor, titular y verificador), el verificador necesita saber *algo* sobre el titular, como "es mayor de edad" o "su credencial está vigente", sin recibir el documento completo. Es la "paradoja de la verificación" del planteamiento del problema.

Esta prueba construye la pieza que resuelve esa paradoja para el **primer conjunto de predicados** de la propuesta (OE2.a), la comparación contra un umbral:

```
   Titular (teléfono)                           Verificador
   ──────────────────                           ───────────
   fechaNacimiento (privada) ─┐
   fechaActual, edadMinima ───┼─► [ circuito ] ─► prueba π (256 B) ──► verify(vk, π, públicas) → sí/no
                              │    + clave de
                              │      prueba
   nunca sale del dispositivo ┘
```

Lo que el verificador aprende es solo `fechaActual`, `edadMinima` y que **el predicado se cumple**. Nada más.

### 2.2 Pruebas de conocimiento cero (ZKP)
Una ZKP es un protocolo entre un **probador** (el titular) y un **verificador** para una afirmación del tipo "conozco un valor secreto *w* (el **witness**) tal que *R(x, w)* se cumple", donde *x* son los datos públicos. Debe cumplir tres propiedades:

| Propiedad | Significado | En esta prueba |
|---|---|---|
| **Completitud** | Si la afirmación es verdadera, el probador honesto convence al verificador. | Un adulto siempre puede generar una prueba que verifica (tests "acepta" y "la prueba válida verifica"). |
| **Solidez** (*soundness*) | Si es falsa, ningún probador tramposo convence al verificador, salvo con probabilidad despreciable. | Un menor no puede generar la prueba; alterar las señales públicas invalida la prueba (tests "rechaza"). |
| **Conocimiento cero** | El verificador no aprende nada aparte de que la afirmación es verdadera. | La fecha de nacimiento no aparece en la prueba, las señales públicas ni el calldata (test de privacidad). |

### 2.3 zk-SNARK
**Z**ero-**K**nowledge **S**uccinct **N**on-interactive **AR**gument of **K**nowledge:
- **Sucinto:** la prueba es diminuta y se verifica rápido, *independientemente del tamaño del cómputo*. En Groth16 son siempre 3 puntos de curva elíptica (256 bytes).
- **No interactivo:** un único mensaje del probador al verificador, sin rondas de preguntas y respuestas. Por eso la verificación la puede hacer un contrato inteligente.
- **Argumento:** la solidez es computacional, es decir, se basa en problemas criptográficos difíciles sobre curvas elípticas.
- **De conocimiento:** el probador no solo demuestra que *existe* un witness válido, sino que *lo conoce*.

### 2.4 De la afirmación al circuito: aritmética en un campo finito
Un zk-SNARK no prueba programas arbitrarios, sino **sistemas de restricciones aritméticas** sobre un campo finito 𝔽ₚ. Aquí *p* es el primo de 254 bits de la curva **BN254 (bn128)**, la que Ethereum soporta de forma nativa con *precompiles*.

- **Señales:** las variables del circuito, que son elementos de 𝔽ₚ. Son privadas por defecto; en el `main` se declaran públicas las que el verificador debe conocer (`{public [fechaActual, edadMinima]}`).
- **R1CS** (*Rank-1 Constraint System*): Circom traduce cada restricción a la forma `(A·s) × (B·s) = (C·s)`. Aquí `s` es el vector de todas las señales `[1, públicas, privadas, intermedias]`. Cada restricción admite **a lo sumo una multiplicación** entre señales.
- **Witness:** una asignación de valores a todas las señales que satisface todas las restricciones. Lo calcula el **generador de witness** (`.wasm`) a partir de las entradas.
- **Número de restricciones:** es la medida de "tamaño" del circuito y determina el tiempo de generación de la prueba, aproximadamente *O(n log n)* por las FFT y las multiplicaciones multi-escalares (MSM). Por eso la propuesta pide documentarlo (OE2.c).

En Circom, `<==` asigna un valor **y** crea la restricción, mientras que `===` solo crea la restricción. Nuestro código usa únicamente estas dos formas. El operador `<--`, que asigna sin restringir y es la fuente típica de vulnerabilidades, no aparece en nuestro código.

### 2.5 El problema de comparar en un campo finito
En 𝔽ₚ **no existe un orden "<"**: los números "dan la vuelta" módulo *p*. Por ejemplo, `-1` es en realidad `p-1`, un número gigantesco. Para comparar hay que **descomponer en bits**:

- **`Num2Bits(n)`** impone `bᵢ·(bᵢ−1) = 0` (cada bᵢ vale 0 o 1) y `Σ bᵢ·2ⁱ = x`. Si existe tal descomposición, entonces **x < 2ⁿ**. Es una *prueba de rango*.
- **`LessThan(n)`** (circomlib) calcula `in[0] + 2ⁿ − in[1]` y lo descompone en *n+1* bits: si el bit *n* es 0, entonces `in[0] < in[1]`. **Esto solo es correcto si ambas entradas ya son menores que 2ⁿ**, algo que circomlib **no verifica**.

Por eso acotamos todas las entradas con `Num2Bits` antes de compararlas. El control `mayoria_edad_sin_cotas` demuestra el ataque: con `fechaNacimiento = p−1` (es decir, −1), la suma `−1 + 180000 = 179999` resulta "menor" que la fecha actual y un witness falso pasa. Con las cotas, `p−1` no cabe en 27 bits y el ataque se rechaza.

### 2.6 Diseño de los predicados
- **Codificación AAAAMMDD:** 13/10/2026 → `20261013`. El orden numérico coincide con el cronológico, y sumar `k·10000` avanza *k* años conservando mes y día:
  - `edad ≥ edadMinima  ⇔  fechaNacimiento + edadMinima·10000 ≤ fechaActual`
  - `vigente  ⇔  fechaExpiracion ≥ fechaActual`
- **Tamaños de bits:** 99991231 < 2²⁷, así que las fechas usan 27 bits. La edad usa 8 bits (≤ 255). La suma cabe en 28 bits, que es el tamaño del comparador.
- **Aserción en lugar de salida:** el resultado se impone con `cumple === 1` en vez de exponerse como un bit de salida. Así, si el predicado es falso, **no existe witness y por tanto no existe prueba**. Un bit de salida público "0" revelaría además que el titular es menor de edad.
- **Divulgación selectiva:** el verificador elige el umbral (`edadMinima` es pública) y recibe solo la respuesta. Es el principio de **minimización de datos** (RGPD art. 5 y W3C VC §8) que cita la propuesta.

### 2.7 Groth16 y el *trusted setup*
Groth16 es el esquema zk-SNARK con **pruebas más pequeñas y verificación más barata** (tres emparejamientos bilineales). Por eso es el más usado en Ethereum. Su costo es que necesita una **configuración de confianza por circuito**:

1. **Fase 1, Powers of Tau** (universal, sirve para cualquier circuito de hasta 2ⁿ restricciones): se generan los puntos `τⁱ·G` para un secreto `τ`. Usamos 2¹² = 4096, más que suficiente para 99 restricciones.
2. **Fase 2** (específica del circuito): a partir del R1CS y la fase 1 se generan la **clave de prueba** (`.zkey`) y la **clave de verificación** (`vkey.json`).

Los secretos aleatorios usados (*toxic waste*) deben destruirse: quien los conozca puede **fabricar pruebas falsas** que verifican. Por eso las ceremonias reales tienen muchos participantes, y basta con que **uno** sea honesto y destruya su aporte (modelo *1-de-N*). Al final se aplica un **beacon aleatorio**, un valor público impredecible como el hash de un bloque futuro, para que el último participante no pueda sesgar el resultado.

Nuestro setup es **académico**: una contribución por fase con entropía local y un beacon local registrado en `build/bitacora-setup.json`. Corresponde a la **limitación 4** de la propuesta.

### 2.8 Generación en el cliente (*client-side proving*)
El titular necesita el generador de witness (`.wasm`, ~39 KB) y la clave de prueba (`.zkey`, ~52 KB). Con ellos calcula el witness y la prueba **en su propio dispositivo**, de modo que la fecha de nacimiento nunca se transmite. Al verificador le basta la clave de verificación, pública y de ~3 KB, o el contrato que la contenga (OE3).

### 2.9 Relación con las métricas del OE5
| Métrica OE5 | Qué la determina | Valor observado aquí |
|---|---|---|
| Tamaño de la prueba | Constante en Groth16 | 256 B más 32 B por señal pública |
| Gas de verificación | ~constante: emparejamientos más 1 multiplicación escalar por señal pública | Se medirá en la prueba del contrato |
| Tiempo en el móvil | Número de restricciones | 99 y 88 restricciones → ~40 ms en PC |
| Latencia total | Prueba más red más confirmación del bloque | Se medirá en Sepolia |

---

## 3. Cómo reproducir
```bash
npm install
npm run setup     # compila (con --inspect) y ejecuta el trusted setup en build/
npm test          # 28 pruebas
npm run bench     # o: node scripts/bench.js 100
```
Requiere `circom` 2.2.x en el PATH (instalado con `cargo install --locked --git https://github.com/iden3/circom.git --tag v2.2.3 circom`).

---

## 4. Resultados

### 4.1 Correctitud (OE2.c)
- **MayoriaEdad: acepta** adulto claro, cumpleaños exactamente hoy, edad mínima 21, nacido el 29-feb consultado el 01-mar y edad mínima 0.
- **MayoriaEdad: rechaza** a quien cumple mañana, al menor de edad, a quien tiene 20 años si se pide 21, al nacido el 29-feb consultado el 28-feb, el ataque `p-1` y valores fuera de rango en las tres entradas.
- **Control sin cotas:** el ataque `p-1` **pasa**, lo que confirma que las cotas son necesarias.
- **Vigencia:** acepta una fecha futura o igual a hoy; rechaza una expirada ayer, el ataque `p-1` y valores fuera de rango.
- **Extremo a extremo:** la prueba válida verifica, y la verificación falla si se altera `edadMinima` o `fechaActual`. Un menor no puede generar la prueba.
- **Privacidad (criterio OE4.d):** el atributo privado no aparece, ni en decimal ni en hexadecimal, en las señales públicas, la prueba ni el calldata para Solidity.

### 4.2 Restricciones
| Circuito | No lineales | Lineales | **Total** | Entradas públicas | Entradas privadas |
|---|---|---|---|---|---|
| mayoria_edad | 91 | 8 | **99** | 2 | 1 |
| vigencia | 82 | 6 | **88** | 1 | 1 |

### 4.3 Desempeño en PC (línea base, no son las métricas del móvil)
Entorno: i7-12700H (20 hilos), 32 GB RAM, Windows 11, Node 24.6, snarkjs 0.7.6, circom 2.2.3. N = 30 más 1 de calentamiento. Detalle en `resultados/bench-pc-2026-10-13.json`.

| Circuito | Witness (mediana) | Prueba (mediana) | Total media ± desv | Total p95 | Verif. off-chain (mediana) |
|---|---|---|---|---|---|
| mayoria_edad | 8.0 ms | 30.3 ms | 40.4 ± 7.2 ms | 57.5 ms | 9.5 ms |
| vigencia | 8.5 ms | 30.1 ms | 41.6 ± 7.7 ms | 54.2 ms | 10.0 ms |

| Tamaños | mayoria_edad | vigencia |
|---|---|---|
| Prueba binaria (Groth16) | 256 B | 256 B |
| Señales públicas | 64 B | 32 B |
| `.wasm` (generador de witness) | 39 KB | 38 KB |
| `.zkey` (clave de prueba) | 52 KB | 48 KB |
| `vkey.json` | 3.0 KB | 2.9 KB |

---

## 5. Conformidad con la documentación oficial
Revisión hecha el 2026-10-13 contra docs.circom.io, el README de snarkjs, el código de circomlib 2.0.5 y el README de circom_tester.

| Práctica | Fuente | Estado |
|---|---|---|
| Entradas públicas declaradas en `main` con `{public [...]}`; el resto, privadas por defecto | docs.circom.io › Signals | ✅ |
| Usar `<==`/`===`; evitar `<--` salvo que no haya alternativa | docs.circom.io › Signals | ✅ No usamos `<--` |
| Compilar con `--inspect` y atender sus avisos | docs.circom.io › Compiling; README snarkjs (paso 10) | ✅ Agregado. Nuestro código no genera avisos (ver nota 1) |
| Salidas de subcomponentes ignoradas a propósito con `_ <== Num2Bits(n)(x);` | docs.circom.io › Code quality › Inspect | ✅ Adoptado |
| Componentes anónimas (requieren circom ≥ 2.1.0) | docs.circom.io › Anonymous components | ✅ `pragma circom 2.1.6` y compilador 2.2.3 |
| Ruta de librerías con `-l` | `circom --help` | ✅ `-l node_modules` |
| Fase 1: `new → contribute → beacon → prepare phase2 → verify` | README snarkjs (pasos 1–8) | ✅ |
| Fase 2: `groth16 setup → zkey contribute → zkey beacon → zkey verify → export verificationkey` | README snarkjs (pasos 15–22) | ✅ |
| No usar la `.zkey` inicial (`_0000`) | README snarkjs (paso 15) | ✅ Se borra |
| Potencia de tau ≥ log₂(restricciones) | README snarkjs | ✅ 2¹² = 4096 ≥ 99 |
| Comprobar el witness contra el R1CS (`wtns check`) | README snarkjs (paso 14) | ✅ Equivalente: `checkConstraints` de circom_tester |
| API de Node: `groth16.fullProve` y `groth16.verify` | README snarkjs | ✅ (más `wtns.calculate` y `groth16.prove` por separado en el bench) |
| Terminar los workers al final | README snarkjs (`process.exit(0)`) | ✅ `curve_bn128.terminate()` y `mocha --exit` |
| `wasm_tester(ruta, {include})` → `calculateWitness` → `checkConstraints` | README y código de circom_tester | ✅ |
| `LessThan(n)` exige `n ≤ 252` y operandos < 2ⁿ (este último no lo verifica circomlib) | código de circomlib `comparators.circom` | ✅ n = 27 y 28; operandos acotados con `Num2Bits` |

**Nota 1:** `--inspect` muestra un aviso `CA02` *dentro de circomlib*, en `LessThan(n)`: los bits `n2b.out[0..n-1]` no se usan. Es intencional, porque `LessThan` solo necesita el bit de signo `n2b.out[n]`, y la descomposición completa es la que garantiza el rango. No es código nuestro.

**Nota 2:** según `circom --help` de la versión instalada, el nivel de optimización por defecto es `--O1`. Lo dejamos así, porque es lo mismo que usa circom_tester, de modo que las pruebas y el build compilan igual.

**Diferencias deliberadas respecto a producción** (justificadas por la limitación 4 de la propuesta):
- Una sola contribución por fase, en lugar de varias de participantes independientes.
- El beacon es aleatorio local, en lugar de un valor público impredecible (p. ej. el hash de un bloque futuro de Ethereum).
- La fase 1 se genera localmente. Una mejora sin costo sería usar el `.ptau` de la ceremonia pública Perpetual Powers of Tau (Hermez/Polygon, 54 contribuciones más un beacon), que el README de snarkjs ofrece para que "cualquier proyecto" parta de ella. Queda pendiente de decisión porque implica descargar el archivo.

---

## 6. Hallazgos
1. **Las cotas de rango son imprescindibles.** Sin `Num2Bits`, una fecha "negativa" (`p-1`) produce un witness válido y "prueba" la mayoría de edad. circomlib no protege contra esto; la responsabilidad es del diseñador del circuito.
2. **Sucintitud confirmada:** la prueba mide 256 bytes con independencia del circuito. Solo crecen las señales públicas, a 32 B cada una.
3. **Estos predicados aislados son muy baratos** (~100 restricciones, ~40 ms en PC). El costo real aparecerá al vincularlos a una credencial firmada (sección 7).
4. **Convención del 29-feb:** quien nace el 29-feb alcanza la edad el **01-mar** en años no bisiestos. Es una decisión de negocio a documentar en los requerimientos (OE1).
5. **Riesgo de "búsqueda por umbral":** como `edadMinima` la elige el verificador, uno malicioso podría pedir pruebas con 18, 19, 20… y deducir la edad por bisección. El conocimiento cero protege cada prueba individual, pero no la *suma* de respuestas. Mitigación: la wallet debe mostrar el predicado exacto y pedir consentimiento, y se pueden fijar umbrales permitidos por tipo de credencial. Esto es un requisito para el OE1 y el OE4.

---

## 7. Referencias
Consultadas el 2026-10-13. Formato similar al de la propuesta, para reutilizarlas en la redacción final.

1. Iden3. (s.f.). *Circom 2 Documentation*. https://docs.circom.io/ (ya citada como [12] en la propuesta). Páginas usadas:
   - *Signals*: https://docs.circom.io/circom-language/signals/
   - *Compiling circuits*: https://docs.circom.io/getting-started/compiling-circuits/
   - *Proving circuits*: https://docs.circom.io/getting-started/proving-circuits/
   - *Code quality – inspect*: https://docs.circom.io/circom-language/code-quality/inspect/
   - *Anonymous components and tuples*: https://docs.circom.io/circom-language/anonymous-components-and-tuples/
2. Iden3. (s.f.). *snarkjs* [Repositorio de GitHub], README: flujo de *trusted setup* (Powers of Tau, fase 2, beacon y verificación). https://github.com/iden3/snarkjs (ya citada como [15] en la propuesta).
3. Iden3. (s.f.). *circomlib* [Repositorio de GitHub]. Plantillas `comparators.circom` (`LessThan`, `LessEqThan`, `GreaterEqThan`) y `bitify.circom` (`Num2Bits`). https://github.com/iden3/circomlib
4. Iden3. (s.f.). *circom_tester* [Repositorio de GitHub]. https://github.com/iden3/circom_tester
5. Groth, J. (2016). "On the Size of Pairing-Based Non-interactive Arguments". *EUROCRYPT 2016*, LNCS 9666, Páginas: 305-326. https://doi.org/10.1007/978-3-662-49896-5_11
6. Bowe, S., Gabizon, A., y Miers, I. (2017). "Scalable Multi-party Computation for zk-SNARK Parameters in the Random Beacon Model". *Cryptology ePrint Archive*, Paper 2017/1050. https://eprint.iacr.org/2017/1050 — Fundamento de la ceremonia Powers of Tau y del beacon aleatorio.
7. Parlamento Europeo y Consejo de la Unión Europea. (2016). RGPD, Artículos 5 y 25 (ya citada como [7] en la propuesta). Principio de minimización de datos.

## 8. Limitaciones y pendientes
- **El witness no está vinculado a la credencial:** hoy el titular puede ingresar cualquier `fechaNacimiento`. El circuito debe verificar la firma del emisor sobre un compromiso de los atributos (p. ej. Poseidon y EdDSA BabyJubJub). Esto sumará miles de restricciones y es la medición crítica para el móvil.
- **No se valida el formato de la fecha** (p. ej. `20081399` pasa). Pierde relevancia cuando el emisor firma los atributos.
- **`fechaActual` es pública, pero alguien debe fijarla:** el contrato verificador debe compararla con `block.timestamp`, o el verificador debe imponerla. Esto corresponde a la prueba de contratos.
- **Sin anti-replay:** falta un *nonce* o *challenge* del verificador como señal pública.
- **Setup académico:** ver la sección 5.
