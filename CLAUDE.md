# Contexto del TEG — Instrucciones para Claude (entorno de pruebas)

> Fuente: `PropuestaTEG_GaudeanoParra 30-09-2026.pdf` (última versión de la propuesta, derivada de `PropuestaTEG_GaudeanoParra_Revisada4.docx`).
> Propósito de este archivo: darte (Claude) el contexto mínimo necesario para construir prototipos y ejecutar pruebas técnicas del Trabajo Especial de Grado en el repositorio `D:\PruebasDID`.

## 0. Organización de este repositorio
- Cada prueba vive en su propia subcarpeta `NN-tema-corto` (p. ej. `01-circuito-umbral-edad`), con su propio `package.json` y dependencias.
- Cada prueba tiene un `README.md` con: objetivo, OE de la propuesta al que corresponde, cómo reproducirla, resultados (con entorno y fecha) y hallazgos o pendientes.
- `circom` está instalado globalmente vía `cargo install` (Windows). snarkjs, circomlib y las herramientas de prueba se instalan localmente en cada prueba (`npx snarkjs ...`).
- Los artefactos generados (`build/`, `*.ptau`, `*.zkey`, `*.wasm`, `*.r1cs`) se regeneran con los scripts y no se versionan.

---

## 1. Qué es el proyecto

**Título:** Sistema Descentralizado de Identificación (DID) usando Pruebas de Cero Conocimiento (zk-SNARKs)
**Institución:** UCAB — Escuela de Ingeniería Informática. Tesistas: Guillermo Gaudeano y Victoria Parra. Tutor: Antonio Russoniello. Revisor: Francis Ferrer.
**Metodología:** XP (eXtreme Programming): iteraciones cortas, pruebas primero, historias de usuario.

**Objetivo general:** Desarrollar un sistema de identidad descentralizada sobre **Ethereum** que, mediante **zk-SNARKs**, permita verificar credenciales digitales **desde un dispositivo móvil** sin exponer los datos personales del titular.

**Problema que resuelve (en una línea):** la "paradoja de la verificación". Hoy, para probar un atributo (p. ej. mayoría de edad), el usuario entrega el documento completo. Se busca **divulgación selectiva / minimización de datos** mediante predicados demostrados con ZK, generados **en el teléfono** (*client-side proving*) y verificados **on-chain** a bajo costo de Gas.

**Tres limitaciones del estado actual que el sistema ataca a la vez:**
1. Sobreexposición de atributos.
2. Trazabilidad de metadatos en la cadena (correlación de llaves públicas o estados).
3. Costo de verificación en cadena (Gas).

---

## 2. Arquitectura: Triángulo de Confianza (W3C)

| Actor | Rol | Dónde vive |
|---|---|---|
| **Emisor (Issuer)** | Firma credenciales (VC) sobre el titular y registra objetos criptográficos en la cadena. Se asume confiable (no se resuelve el KYC físico). | Backend o script (datos **sintéticos**) |
| **Titular (Holder)** | Guarda VCs y llaves en su wallet móvil y **genera la prueba localmente**. El *witness* **nunca** sale del dispositivo. | App Android (React Native) |
| **Verificador (Verifier)** | Solicita un predicado y valida la prueba contra el registro sin contactar al emisor. | Smart contract verificador en Sepolia (más el cliente que lo invoca) |

**Regla de oro de privacidad:** en la cadena solo hay **objetos criptográficos y estados de credenciales** (llaves públicas, compromisos/hashes, revocación). **Nunca datos personales.**

### Flujo de presentación (lo que hay que probar de punta a punta)
1. El emisor emite una VC (datos sintéticos) al titular.
2. El verificador envía una solicitud (qué predicado necesita).
3. El titular selecciona la credencial y el predicado en la app.
4. La app genera la prueba zk-SNARK **en el dispositivo**.
5. Se envía la prueba más las señales públicas, y el contrato verificador devuelve válido o inválido.

### Fases de un zk-SNARK (según la propuesta)
Circuito aritmético (restricciones) → *trusted setup* (clave de prueba y clave de verificación) → el titular genera la prueba con su *witness* → el verificador contrasta la prueba con la clave de verificación.

---

## 3. Objetivos específicos y entregables (el alcance)

### OE1 — Requerimientos y arquitectura lógica
- Analizar W3C **DID v1.0** y **VC Data Model v2.0**.
- Modelar el Triángulo de Confianza: qué va on-chain y qué queda off-chain; protocolos entre componentes; criterios de conformidad con los **ERC** aplicables al registro de identificadores.
- Requerimientos no funcionales: privacidad y restricciones de ejecución en móvil.
- **Entregable:** documento de arquitectura (RF y RNF, diagrama de secuencia y flujo de datos del triángulo).

### OE2 — Circuitos zk-SNARK en Circom
Tres **conjuntos de predicados**:
1. **Comparación contra umbral**: p. ej. `edad >= 18`, credencial no vencida (`fechaExp > hoy`).
2. **Igualdad / pertenencia**: p. ej. `nacionalidad == X` o `nacionalidad ∈ {…}`.
3. **Rango**: p. ej. `a <= edad <= b`.

Para cada uno: diseñar restricciones, implementarlo en **Circom**, ejecutar el *trusted setup* (claves de prueba y de verificación) y hacer **pruebas unitarias** que acepten las entradas válidas y **rechacen las inválidas**. **Documentar el número de restricciones** de cada circuito, porque afecta directamente el tiempo de prueba.
- **Entregable:** circuitos compilados y verificados, claves y documentación de restricciones.

### OE3 — Smart contracts (Solidity) en Ethereum
- **DID Registry**: asocia el DID con su documento DID y sus llaves públicas; gestiona la actualización y la **revocación** de credenciales.
- **Verificador**: recibe la prueba, la valida contra la clave de verificación del circuito y emite el resultado sin acceder a datos del titular.
- Definir qué se almacena on-chain (solo objetos criptográficos y estados).
- Pruebas unitarias y de integración en **local (Hardhat)** y luego despliegue en **Sepolia**.
- **Entregable:** contratos desplegados y verificados en Sepolia, suite de pruebas y documentación de interfaces públicas.

### OE4 — DApp móvil (wallet)
- Guardar VCs, administrar llaves y **generar pruebas localmente**.
- Flujo completo: solicitud → selección de credencial y predicado → prueba en el dispositivo → envío.
- Interfaz que haga "transparente" la criptografía; resguardo local de la llave privada.
- **Criterio de aceptación clave:** los atributos usados como **entrada privada** del circuito **no aparecen** ni en los datos de la transacción enviada a la red ni en las **señales públicas** de la prueba.
- **Entregable:** APK instalable en Android 13 o superior.

### OE5 — Evaluación de desempeño en Sepolia
Por **cada conjunto de predicados**, con **repeticiones sucesivas** para obtener valores representativos, medir:
| Métrica | Unidad / nota |
|---|---|
| Consumo de **Gas** de la verificación on-chain | unidades de Gas (no en moneda; cualquier valor en USD o ETH es solo referencial) |
| **Tiempo de generación de la prueba** en el móvil | ms (gama media; debe ser "compatible con uso interactivo") |
| **Tamaño** de la prueba | bytes |
| **Latencia total** del flujo de verificación | ms o s (desde la solicitud hasta el resultado, incluida la confirmación en Sepolia) |

Validar los resultados contra los RNF del OE1. **Entregable:** informe comparativo por predicado y análisis de viabilidad móvil.

---

## 4. Stack tecnológico fijado por la propuesta

| Capa | Tecnología | Versión mínima |
|---|---|---|
| Contratos | Solidity | ≥ 0.8.20 |
| Circuitos | Circom | ≥ 2.0 |
| Integración cripto | JavaScript | — |
| Móvil | React Native | ≥ 0.72 |
| Prover | snarkjs | — |
| Cliente blockchain | ethers.js | — |
| Dev contratos | Hardhat | — |
| Red | Ethereum **Sepolia** (testnet) | — |
| Estándares | W3C DID v1.0, VC v2.0 y ERC aplicables | — |
| SO móvil | **Android 13+** únicamente | — |
| Idioma de la UI | **Solo español** | — |

**No cambies el stack sin señalarlo explícitamente.** Si una prueba demuestra que una pieza no funciona (p. ej. snarkjs en React Native), documenta el hallazgo y propone alternativas, pero deja claro que implica modificar lo aprobado en la propuesta.

---

## 5. Fuera de alcance (no implementar)
- Validez legal o reconocimiento gubernamental de las credenciales.
- KYC físico: el emisor es un *trust anchor* y se trabaja con **datos sintéticos**.
- Ceremonia MPC multiparte del *trusted setup*: se usa un setup académico y se asume válido.
- Recuperación de llaves (Social Recovery): solo almacenamiento local estándar.
- iOS, otros idiomas y mainnet.
- El sistema depende de Internet y de Sepolia; no hay modo offline.

---

## 6. Plan de pruebas sugerido para el entorno nuevo

> Lo siguiente **no está en la propuesta**: son mis recomendaciones para reducir riesgo técnico pronto. Trátalas como hipótesis a validar.

### Fase A — Circuitos (sin móvil)
1. Montar el entorno: `circom` 2.x, `snarkjs` y `circomlib` (usar los `comparators`: `LessThan`, `GreaterEqThan`, `IsEqual`).
2. Escribir los 3 circuitos (umbral, igualdad/pertenencia y rango) y un `Powers of Tau` pequeño más el setup **Groth16** por circuito (encaja con "setup por circuito" de la propuesta).
3. Pruebas unitarias (p. ej. `circom_tester` + mocha): casos válidos, inválidos y bordes (exactamente 18 años, límites del rango, valores fuera de campo o negativos).
4. Registrar `#restricciones` (`snarkjs r1cs info`) y el tiempo de `fullProve` en PC como línea base.

### Fase B — Contratos (Hardhat local)
1. Exportar el verificador: `snarkjs zkey export solidityverifier`, uno por circuito.
2. Contrato DID Registry (revisar **ERC-1056 / `did:ethr`** como referencia de conformidad ERC).
3. Revocación: estado on-chain por credencial (hash o compromiso, nunca datos).
4. Tests de integración con prueba real → `verifyProof` → medir Gas con `hardhat-gas-reporter`.
5. Desplegar en Sepolia y repetir la medición de Gas (debería coincidir con local; el Gas es determinista).

### Fase C — Prover en móvil (**riesgo técnico principal**)
- snarkjs depende de WebAssembly y Web Workers; el motor **Hermes** de React Native **no** soporta WASM de forma nativa. Opciones a evaluar:
  1. snarkjs dentro de un **WebView** oculto (es lo que más respeta el stack de la propuesta).
  2. Prover nativo (rapidsnark o mopro) vía módulo nativo, que implicaría un cambio de stack y habría que justificarlo.
- Medir en un dispositivo **Android 13+ de gama media** real (no en el emulador para métricas finales): tiempo de prueba, RAM pico y tamaño de los artefactos `.wasm`/`.zkey` empaquetados.

### Fase D — Flujo end-to-end y criterio de privacidad
- Prueba automatizada que inspeccione el `calldata` de la transacción y las `publicSignals` y **falle** si aparece cualquier atributo privado (fecha de nacimiento, nacionalidad en claro, etc.).
- Repetir N veces por predicado (sugerencia: N ≥ 30) y reportar la media, la mediana, la desviación estándar y el p95.

### Puntos de diseño abiertos que conviene señalar a los tesistas
- **Vincular el witness a la credencial firmada:** si el circuito solo recibe `fechaNacimiento` como entrada privada, el titular podría mentir. Lo usual es que el emisor firme un compromiso (p. ej. Poseidon hash de los atributos con firma **EdDSA BabyJubJub**) y que el circuito verifique la firma o el compromiso. Esto aumenta mucho las restricciones y el tiempo en el móvil, así que conviene medirlo.
- **Anti-replay / anti-correlación:** incluir un *nonce* o *challenge* del verificador como señal pública, y evaluar *nullifiers* para que dos verificaciones no sean enlazables (relacionado con el problema de metadatos de la sección 1).
- **Fecha "hoy" en predicados de vencimiento y edad:** debe ser una señal pública (o el `block.timestamp` comparado en el contrato), no una entrada controlada por el titular.
- **"ERC para tokens de datos de identificación":** la propuesta lo menciona sin especificar cuál; hay que definir si se usa ERC-1056, un SBT (ERC-5192) u otro.

---

## 7. Reglas para trabajar en este proyecto
- Responde y documenta **en español**.
- **Nunca** pongas datos personales reales en circuitos, contratos, tests ni commits: solo datos sintéticos.
- No uses llaves privadas con fondos reales; solo cuentas de Sepolia, con llaves en `.env` fuera del control de versiones.
- Cada resultado de medición debe registrar: dispositivo o modelo, versión de Android, versión de circom/snarkjs, número de restricciones, N de repeticiones y fecha (los datos de Sepolia varían con la congestión).
- Mantén la trazabilidad **prueba → objetivo específico (OE1–OE5)** para que los resultados puedan citarse directamente en el TEG.
- **Cada README de prueba debe incluir una sección "Referencias"** con todas las fuentes consultadas (documentación, artículos, EIPs, anuncios), en el formato de la propuesta y con la fecha de consulta. Indica si cada fuente es primaria o secundaria, marca con ⚠️ lo que no se pudo verificar directamente y señala cuándo ya está citada en la propuesta (p. ej. "[15] en la propuesta"). Su propósito es reutilizarlas en la redacción final de la tesis.

## 8. Referencias técnicas clave
- W3C DID Core v1.0: https://www.w3.org/TR/did-core/
- W3C VC Data Model v2.0: https://www.w3.org/TR/vc-data-model-2.0/
- Circom: https://docs.circom.io/
- snarkjs: https://github.com/iden3/snarkjs
- Solidity: https://docs.soliditylang.org/
- Hardhat / Ethereum dev docs: https://ethereum.org/en/developers/docs/
- React Native: https://reactnative.dev/docs/getting-started

---

## 9. App Emisora (herramienta aparte, NO es la DApp del OE4)

> Decisión de los tesistas (2026-10-13): se construirá una **aplicación separada** que hace de **Emisor (Issuer)** del Triángulo de Confianza, con el único fin de generar y firmar las credenciales que usará la billetera. **No forma parte de los objetivos específicos de la propuesta.** Es una herramienta de soporte del "entorno controlado provisto de datos sintéticos" (limitación 3) y se documenta en la arquitectura (OE1) como tal. No debe mezclarse con el código de la billetera.

### Propósito y flujo
1. **Captura de datos:** escaneo de una cédula con OCR **en el dispositivo** (la imagen nunca sale del teléfono ni se guarda) **o** generación de datos sintéticos con un botón.
2. **Revisión del operador:** los datos extraídos se muestran en un formulario editable y el operador los confirma. Esto simula el KYC que la propuesta deja fuera del alcance.
3. **Construcción de la credencial** en formato **W3C VC v2** (`@context`, `type`, `issuer` = DID del emisor, `validFrom`, `credentialSubject`, `proof`), vinculada a la llave pública de la billetera del titular.
4. **Firma:** los atributos se codifican como elementos del campo BN254, se comprometen con **Poseidon** y se firman con **EdDSA sobre BabyJubJub**, la firma que verificará el circuito (`EdDSAPoseidonVerifier` de circomlib).
5. **Entrega a la billetera** por código QR o enlace profundo.
6. **Registro on-chain:** la llave pública del emisor se publica en el DID Registry (OE3). Opcionalmente también la revocación de credenciales.

### Atributos de la cédula y predicados que alimentan
| Atributo | Predicado |
|---|---|
| Fecha de nacimiento | Mayoría de edad (conjunto 1, prueba 01) |
| Prefijo V/E del número de cédula | Nacionalidad: igualdad o pertenencia (conjunto 2) |
| Fecha de vencimiento | Vigencia (conjunto 1, prueba 01) |
| Número, nombres, apellidos | Solo dentro de la credencial; nunca se revelan |

### Tecnología (la misma que la DApp real)
- **React Native** (≥ 0.72, solo Android 13+) y **ethers.js** v6 para el registro on-chain.
- **Firma:** `@zk-kit/eddsa-poseidon` (JS puro, sin WASM, compatible con Hermes). **No usar `circomlibjs`** en la app: depende de `ffjavascript` (WebAssembly, no soportado por Hermes) y de ethers v5, y no se mantiene desde 2022. Puede usarse en scripts de Node para contrastar resultados.
- **OCR local:** ML Kit Text Recognition (`@react-native-ml-kit/text-recognition`) y cámara con `react-native-vision-camera`. Sin servicios en la nube.
- **Llave privada del emisor:** almacenamiento cifrado con `react-native-keychain` (Android Keystore no soporta BabyJubJub de forma nativa; se cifra la llave con una llave del Keystore).
- **Apps separadas:** por decisión de los tesistas, la App Emisora y la billetera son proyectos **totalmente independientes**, sin código compartido por ahora. Como el formato de la credencial, la codificación de atributos a elementos del campo y el hash Poseidon deben ser **idénticos** en ambas (si no, las firmas no verificarán en el circuito), se mantendrán **vectores de prueba** comunes (entrada → atributos codificados → hash → firma esperada) que ambos proyectos deben pasar.

### Reglas específicas
- **Datos personales reales:** las imágenes de cédulas reales solo se procesan en el dispositivo para probar el OCR. **Nunca** se guardan, se suben al repositorio ni se usan en Sepolia. Todo lo que llega a la blockchain, los tests o los benchmarks usa **datos sintéticos**.
- La llave del emisor es de prueba y se genera para el entorno académico.
- **Orden de construcción:** primero el núcleo criptográfico como script de Node (emisor sintético, firma y circuito que la verifica, en la prueba 03); después la app React Native con OCR, que solo envuelve ese núcleo con interfaz.
- **Pendientes de verificar en la prueba 03:** que `@zk-kit/eddsa-poseidon` produzca firmas aceptadas por `EdDSAPoseidonVerifier` de circomlib, y el costo en restricciones de verificar la firma dentro del circuito.
