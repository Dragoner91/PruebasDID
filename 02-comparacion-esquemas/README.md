# Prueba 02 — Comparación de esquemas: Groth16 vs PLONK vs FFLONK

**Objetivo de la propuesta:** justificar la elección del esquema zk-SNARK (marco teórico y OE2) con datos propios. También adelanta las métricas del OE5: Gas, tiempo y tamaño de la prueba.
**Fecha:** 2026-10-13
**Estado:** ✅ completada. Los 6 verificadores (3 esquemas × 2 circuitos) aceptan la prueba válida y rechazan la alterada.

## Resumen
| | **Groth16** | PLONK | FFLONK |
|---|---|---|---|
| Gas de verificación (tx completa) | **~214–221k** | ~294–295k (+35%) | **~217–218k** (empate) |
| Gas de despliegue del verificador | **~350–369k** | ~1.28–1.33 M | ~3.13–3.21 M |
| Tiempo de prueba en PC (total, media) | **37–53 ms** | 255–275 ms (~6×) | 315–325 ms (~7×) |
| Tamaño de la prueba | **256 B** | 768 B | 768 B |
| Clave de prueba (`.zkey`, va en el teléfono) | **48–52 KB** | 385–425 KB (~8×) | 577–618 KB (~12×) |
| *Trusted setup* | Por circuito | Universal | Universal |

**Conclusión:** para esta tesis, **Groth16 es la mejor opción**. Empata con FFLONK como el más barato de verificar en Ethereum y supera claramente a los dos alternativos en las métricas del lado del teléfono: tiempo de prueba y tamaño de la clave. Su única desventaja, el setup por circuito, es manejable con tres conjuntos de predicados y ya está declarada en la limitación 4 de la propuesta.

---

## 1. Marco teórico

Los tres esquemas viven en snarkjs, usan la misma curva **BN254** (la que soportan los *precompiles* de Ethereum) y parten del mismo circuito Circom. Difieren en **cómo representan las restricciones** y en **qué compromiso criptográfico usan**.

### Groth16 (Jens Groth, 2016)
- **Aritmetización:** R1CS → QAP. Cada restricción es `(A·s)×(B·s)=(C·s)`; las restricciones lineales son "gratis", porque se absorben en las otras.
- **Prueba:** 3 puntos de curva (A, B en G2 y C), es decir, 8 palabras de 32 bytes = **256 B**.
- **Verificación:** una ecuación con **4 emparejamientos** (*pairings*) más una multiplicación escalar por señal pública.
- **Setup:** fase 1 universal (Powers of Tau) más **fase 2 por circuito**. Cambiar el circuito obliga a rehacer la fase 2.

### PLONK (Gabizon, Williamson y Ciobotaru, 2019)
- **Aritmetización:** "puertas" de la forma `qL·a + qR·b + qO·c + qM·a·b + qC = 0` más un *argumento de permutación* que conecta los cables. Las sumas **sí cuestan puertas**. Por eso el mismo circuito pasa de 99 restricciones R1CS a **184 puertas PLONK**.
- **Compromisos KZG:** el probador se compromete a varios polinomios (9 puntos G1) y revela sus evaluaciones (6 escalares), es decir, 24 palabras = **768 B**.
- **Setup universal:** basta con el Powers of Tau; no hay fase 2 por circuito.
- **Verificación:** 2 *pairings*, pero muchas más multiplicaciones escalares y aritmética de campo, así que en la práctica cuesta más Gas que Groth16.

### FFLONK (Gabizon y Khovratovich, 2021)
- Variante de PLONK que **agrupa varios polinomios en uno solo** mediante FFTs, de modo que el verificador hace menos operaciones de curva. Es lo que lleva su Gas al nivel de Groth16.
- El costo se traslada al probador: polinomios de mayor grado, por lo que la prueba es **la más lenta** y la clave de prueba **la más grande**. Además, exige un Powers of Tau de al menos `9·dominio` puntos.
- El contrato verificador es el más grande (~61 KB de código fuente), y **desplegarlo cuesta unas 9 veces más que el de Groth16**.

### Por qué importa para la tesis
| Métrica | Quién la paga | Impacto en el proyecto |
|---|---|---|
| Gas de verificación | Cada verificación (recurrente) | Planteamiento del problema: "costo de la verificación en cadena" (OE5) |
| Gas de despliegue | Una vez por circuito | Costo único; poco relevante en Sepolia |
| Tiempo de prueba y tamaño de la `.zkey` | El teléfono del titular, en cada presentación | *Client-side proving* en gama media (OE4 y OE5) |
| Tipo de setup | El proyecto, una vez por circuito | Limitación 4 de la propuesta |

---

## 2. Cómo reproducir
```bash
npm install
npm run setup    # ptau, setup de los 3 esquemas y export de los verificadores .sol
npm run bench    # tiempos y tamaños (N=30); guarda build/muestras.json
npm run gas      # despliega en Hardhat y mide el Gas (requiere bench)
```
Los circuitos se leen de `../01-circuito-umbral-edad/circuits` (única fuente). Requiere `circom` 2.2.x en el PATH.

---

## 3. Resultados

### 3.1 Restricciones
| Circuito | R1CS (Groth16) | Puertas PLONK / FFLONK | Dominio FFLONK |
|---|---|---|---|
| mayoria_edad | 99 | 184 | 256 |
| vigencia | 88 | 165 | 256 |

### 3.2 Gas en Ethereum
Hardhat 2.29.1 (red local, hardfork `osaka`), solc 0.8.24 con optimizador (200 runs), verificadores generados por `snarkjs zkey export solidityverifier`. Detalle en `resultados/gas-hardhat-2026-10-13.json`.

| Circuito | Esquema | **Gas verificación (tx)** | Ejecución | Calldata | Bytes calldata | Gas despliegue |
|---|---|---|---|---|---|---|
| mayoria_edad | Groth16 | **221 101** | 195 625 | 4 476 | 324 | 368 637 |
| mayoria_edad | PLONK | 295 202 | 261 558 | 12 644 | 836 | 1 329 187 |
| mayoria_edad | FFLONK | **217 919** | 184 263 | 12 656 | 836 | 3 212 198 |
| vigencia | Groth16 | **214 273** | 188 937 | 4 336 | 292 | 349 856 |
| vigencia | PLONK | 294 248 | 260 756 | 12 492 | 804 | 1 275 874 |
| vigencia | FFLONK | **216 892** | 183 376 | 12 516 | 804 | 3 134 487 |

"Gas verificación (tx)" es `eth_estimateGas` de una transacción que solo llama a `verifyProof`. Incluye los 21 000 de base y el calldata (EIP-2028: 16 gas por byte no nulo y 4 por byte nulo). En un sistema real, la verificación irá dentro de otra transacción (OE3), así que lo comparable entre esquemas es la ejecución más el calldata.

**Observaciones:**
- En Groth16, la diferencia entre circuitos (~6.8k) corresponde a la **señal pública extra** (`edadMinima`): una multiplicación escalar (ecMul, 6 000 gas) más una suma (ecAdd) y su calldata. Esto confirma que **el Gas no depende del tamaño del circuito, sino del número de señales públicas**.
- FFLONK ejecuta menos que Groth16 (~184k frente a ~189–196k), pero su prueba triplica el calldata. En el total, empatan.
- Los costos los dominan los *precompiles* de *pairing* (EIP-1108: 45 000 + 34 000 por par).

### 3.3 Tiempos y tamaños en PC
i7-12700H, 32 GB, Windows 11, Node 24.6, snarkjs 0.7.6, circom 2.2.3. N = 30 más 1 de calentamiento. Detalle en `resultados/bench-pc-2026-10-13.json`.

| Circuito | Esquema | Prueba (mediana) | Witness + prueba (media ± desv) | p95 | Verif. off-chain (mediana) | Prueba | `.zkey` | `vkey` |
|---|---|---|---|---|---|---|---|---|
| mayoria_edad | Groth16 | **26.8 ms** | **37.0 ± 6.2 ms** | 52.1 ms | 8.2 ms | **256 B** | **52 KB** | 3.0 KB |
| mayoria_edad | PLONK | 257.1 ms | 254.8 ± 37.6 ms | 287.3 ms | 14.6 ms | 768 B | 425 KB | 2.0 KB |
| mayoria_edad | FFLONK | 304.1 ms | 315.3 ± 8.8 ms | 330.7 ms | 9.9 ms | 768 B | 618 KB | 1.1 KB |
| vigencia | Groth16 | **42.4 ms** | **53.4 ± 2.4 ms** | 56.1 ms | 12.4 ms | **256 B** | **48 KB** | 2.9 KB |
| vigencia | PLONK | 259.8 ms | 275.0 ± 17.0 ms | 311.3 ms | 14.7 ms | 768 B | 385 KB | 2.0 KB |
| vigencia | FFLONK | 305.2 ms | 325.1 ± 14.7 ms | 352.5 ms | 10.3 ms | 768 B | 577 KB | 1.1 KB |

El tiempo de witness (~7–12 ms) es el mismo para los tres, porque usan el mismo `.wasm`. Las diferencias están en la generación de la prueba.

---

## 4. Verificación de la metodología
- **API según el código de snarkjs 0.7.6:** `groth16.prove`, `plonk.prove` y `fflonk.prove` reciben el witness en memoria; `*.verify(vkey, públicas, prueba)`.
- **`fflonk.exportSolidityCallData(públicas, prueba)` invierte el orden** de los argumentos respecto a Groth16 y PLONK (`prueba, públicas`). Lo verificamos en el código fuente y lo tuvimos en cuenta.
- **El calldata textual de PLONK omite la coma** entre la prueba y las señales públicas (`...][...`), por lo que no es JSON válido. Los valores se extraen con una expresión regular.
- **Cada contrato se probó en ambos sentidos:** acepta la prueba válida y rechaza la misma prueba con una señal pública alterada. Así se descarta haber medido el Gas de un camino de error.
- **Avisos del compilador:** "parámetro no usado" en los verificadores PLONK y FFLONK. Es código generado por snarkjs que lee el calldata en ensamblador; es inofensivo.
- **Setup de Groth16:** el mismo flujo documentado y verificado de la prueba 01 (contribución, beacon y `zkey verify`). PLONK y FFLONK no tienen fase 2 por diseño.

## 5. Referencias
Consultadas el 2026-10-13. Formato similar al de la propuesta, para reutilizarlas en la redacción final.

**Artículos de los esquemas:**
1. Groth, J. (2016). "On the Size of Pairing-Based Non-interactive Arguments". *Advances in Cryptology – EUROCRYPT 2016*, Lecture Notes in Computer Science, Volume 9666, Páginas: 305-326. Springer. https://doi.org/10.1007/978-3-662-49896-5_11 — Preprint: https://eprint.iacr.org/2016/260
2. Gabizon, A., Williamson, Z. J., y Ciobotaru, O. (2019). "PLONK: Permutations over Lagrange-bases for Oecumenical Noninteractive arguments of Knowledge". *Cryptology ePrint Archive*, Paper 2019/953. https://eprint.iacr.org/2019/953
3. Gabizon, A., y Khovratovich, D. (2021). "fflonk: a Fast-Fourier inspired verifier efficient version of PlonK". *Cryptology ePrint Archive*, Paper 2021/1167. https://eprint.iacr.org/2021/1167

**Costos de Gas en Ethereum (precompiles y calldata):**

4. Buterin, V., y Reitwiessner, C. (2017). *EIP-196: Precompiled contracts for addition and scalar multiplication on the elliptic curve alt_bn128*. https://eips.ethereum.org/EIPS/eip-196
5. Reitwiessner, C., y Buterin, V. (2017). *EIP-197: Precompiled contracts for optimal ate pairing check on the elliptic curve alt_bn128*. https://eips.ethereum.org/EIPS/eip-197
6. Swende, M. H., et al. (2019). *EIP-1108: Reduce alt_bn128 precompile gas costs*. https://eips.ethereum.org/EIPS/eip-1108
7. Akhunov, A., et al. (2019). *EIP-2028: Transaction data gas cost reduction*. https://eips.ethereum.org/EIPS/eip-2028

**Herramientas:**

8. Iden3. (s.f.). *snarkjs* [Repositorio de GitHub]. https://github.com/iden3/snarkjs (ya citada como [15] en la propuesta). Groth16, PLONK y FFLONK; exportación de verificadores Solidity.
9. Nomic Foundation. (s.f.). *Hardhat Documentation*. https://hardhat.org/docs (ya citada como [16] en la propuesta).

> **Verificar antes de citar:** los autores y años de los EIP están tomados de memoria. Confirmarlos en la cabecera de cada EIP.

## 6. Limitaciones
- Los tiempos son de **PC**. En un teléfono de gama media se espera que sean varias veces mayores; lo importante aquí es la **relación** entre esquemas, que debería mantenerse. Se confirmará en la prueba móvil.
- **Gas medido en la red local de Hardhat**, no en Sepolia. El Gas es determinista, así que debería coincidir en Sepolia si ambas redes están en el mismo hardfork. Se confirmará al desplegar (OE3 y OE5).
- **Hardhat 2** se usó solo como banco de pruebas EVM. Para la prueba de contratos (OE3) conviene decidir entre Hardhat 2 y 3.
- Son circuitos muy pequeños. Con circuitos grandes (p. ej. al verificar la firma del emisor), las diferencias **absolutas** en tiempo de prueba y tamaño de la `.zkey` crecerán (a la misma proporción, cientos de ms se vuelven segundos), mientras que el Gas de verificación seguirá prácticamente constante.
