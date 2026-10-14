# Prueba 03 — WebAssembly y snarkjs en React Native (Hermes vs WebView)

**Objetivo de la propuesta:** OE4 (DApp móvil con *client-side proving* usando React Native y snarkjs). Valida el **riesgo técnico principal** del stack aprobado: snarkjs necesita WebAssembly, y no se sabía si el motor de React Native lo soporta.
**Fecha:** 2026-10-13/14
**Estado:** ✅ completada en el emulador. ⏳ Pendiente de repetir en un teléfono físico de gama media.

## Conclusión
| Pregunta | Respuesta |
|---|---|
| ¿Hermes (React Native 0.87.1) soporta WebAssembly? | **No.** `typeof WebAssembly === "undefined"`. Hermes anunció soporte para WASM en 2026 como *early preview*, pero **no viene habilitado** en el Hermes que distribuye React Native 0.87.1. |
| ¿Se puede ejecutar snarkjs directamente en Hermes? | **No.** Al cargarse falla incluso antes de usar WASM: React Native no puede crear un `Blob` a partir de un `ArrayBuffer` (snarkjs prepara así sus workers), y en modo release ese error **cierra la app**. Tampoco hay `TextDecoder` ni `Worker`. |
| ¿Se puede ejecutar snarkjs dentro de una **WebView** de React Native? | **Sí.** La WebView de Android (Chromium) tiene WebAssembly y Workers. Genera pruebas Groth16 válidas y **re-verificadas de forma independiente en Node**. |
| ¿Respeta el stack de la propuesta? | **Sí.** React Native, snarkjs y Circom sin cambios; la WebView es un componente de React Native (`react-native-webview`), sin servidor ni red. El witness nunca sale del dispositivo. |

**Decisión recomendada para el OE4:** generar las pruebas con **snarkjs dentro de una WebView oculta y en modo multihilo**. Si en un teléfono de gama media resultara lenta con circuitos grandes (p. ej. al verificar la firma del emisor), la alternativa es un prover nativo (rapidsnark o mopro), lo que implicaría un cambio de stack a justificar.

## Qué se hizo
App mínima de React Native 0.87.1 (`app/`, compilada en **modo release**) que al abrirse ejecuta en secuencia:
1. **Diagnóstico de Hermes:** qué APIs ofrece el motor.
2. **WASM mínimo en Hermes:** instanciar un módulo de 41 bytes escrito a mano (`add(i32, i32)`).
3. **snarkjs en Hermes:** `groth16.fullProve` del circuito `mayoria_edad` (prueba 01) en modo de un hilo.
4. **Diagnóstico de la WebView.**
5. **snarkjs en la WebView**, en un hilo y en varios hilos.

Cada paso registra su resultado en `logcat` (`RESULTADO_JSON`). `scripts/recolectar.js` lo recoge y **vuelve a verificar en Node** cada prueba generada en el dispositivo con la vkey de la prueba 01.

Los artefactos del circuito (`.wasm`, `.zkey`, vkey) y `snarkjs.min.js` se **empaquetan dentro de la app** (`scripts/generar-artefactos.js`): la prueba no usa red ni sistema de archivos.

## Resultados (emulador)
Entorno: emulador Android 15 (API 35, x86_64, 4 núcleos, 4 GB) en i7-12700H con aceleración WHPX; React Native 0.87.1; Hermes `250829098.0.17` (Static Hermes, bytecode v98); WebView Chrome 124; snarkjs 0.7.6. N = 10 más 1 de calentamiento. Detalle en `resultados/emulador-x86_64-android15-2026-10-14.json`.

### Capacidades de cada motor
| API | Hermes | WebView (Chrome 124) |
|---|---|---|
| `WebAssembly` | ❌ no definido | ✅ |
| `Worker` | ❌ | ✅ (4 núcleos) |
| `BigInt` | ✅ | ✅ |
| `TextEncoder` / `TextDecoder` | ✅ / ❌ | ✅ / ✅ |
| `crypto.getRandomValues` | ✅ (con `react-native-get-random-values`) | ✅ |
| `SharedArrayBuffer` | ❌ | ❌ (página sin *cross-origin isolation*) |

### snarkjs Groth16 (`mayoria_edad`, 99 restricciones)
| Motor | Resultado | 1ª ejecución | Prueba (mediana) | Media ± desv | p95 | Verificación | Re-verificada en Node |
|---|---|---|---|---|---|---|---|
| Hermes | ❌ falla al cargar snarkjs | — | — | — | — | — | — |
| WebView, 1 hilo | ✅ | 192 ms | 150.8 ms | 150.8 ± 12.2 ms | 178.3 ms | 25.6 ms | ✅ |
| **WebView, varios hilos** | ✅ | 51 ms | **46.4 ms** | 46.3 ± 4.6 ms | 53.1 ms | 22.8 ms | ✅ |

Para comparar: en el PC (prueba 01) la mediana fue ~38–40 ms. **Los tiempos del emulador NO representan un teléfono real**: el emulador corre sobre el CPU x86 del PC. La medición válida para el OE5 debe hacerse en un dispositivo ARM de gama media.

## Hallazgos
1. **WebAssembly en Hermes no está disponible** en React Native 0.87.1, pese al anuncio de 2026. Esto confirma el riesgo señalado en `CLAUDE.md` y descarta usar snarkjs "tal cual" en el hilo de JavaScript de la app.
2. **El fallo de snarkjs en Hermes cierra la app** en modo release (error no capturado al crear un `Blob`). En la DApp real, snarkjs **nunca debe importarse en el hilo de Hermes**.
3. **La WebView es viable y respeta el stack:** pruebas correctas, verificables por terceros, sin red. El modo multihilo es ~3× más rápido que el de un hilo.
4. **Sin `SharedArrayBuffer`** en la WebView (la página no está aislada), snarkjs usa Workers con paso de mensajes, lo que basta para este caso.

## Problemas encontrados durante la prueba (y su solución)
- **El primer build de Android tardó ~29 min:** Gradle descargó el NDK 27.1 y las Build-Tools 37. Los siguientes builds tardan ~30 s.
- **Error propio en la app:** `useRef(new Promise(...))` recreaba la promesa en cada render y la app esperaba a la WebView para siempre. Se corrigió creándola una sola vez y se añadió un **límite de 120 s por paso**.
- **Cierre de la app** por el error no capturado de snarkjs en Hermes: se registra con `ErrorUtils.setGlobalHandler` para que el resultado quede documentado.

## Cómo reproducir
```bash
# 1. Artefactos (requiere `npm run setup` en 01-circuito-umbral-edad)
npm install
npm run artefactos
# 2. Compilar e instalar (con un emulador o un teléfono conectado por USB)
cd app && npm install
cd android && gradlew assembleRelease "-PreactNativeArchitectures=x86_64,arm64-v8a"
adb install -r app/build/outputs/apk/release/app-release.apk
adb logcat -c && adb shell am start -n com.wasmprobe/.MainActivity
# 3. Esperar ~1 min y recolectar
adb logcat -d -s ReactNativeJS:V > logcat.txt
npm run recolectar -- logcat.txt <etiqueta-del-dispositivo>
```

## Referencias
Consultadas el 2026-10-13. Formato similar al de la propuesta, para reutilizarlas en la redacción final.

**Sobre WebAssembly en Hermes:**
1. Mikov, T. [@tmikov]. (2026, febrero). *WebAssembly Comes to Hermes* [Publicación en X]. https://x.com/tmikov/status/2023821160241393839
   — **Fuente primaria**: anuncio del mantenedor de Hermes. ⚠️ No se pudo abrir directamente (X exige inicio de sesión). Su contenido se conoce por resúmenes de buscadores: soporte de WASM 1.0, memoria lineal, tablas, la API `WebAssembly` de JavaScript y compilación anticipada a bytecode con `hermesc`, descrito como *"early preview"* y *"not yet ready for production use"*. **Verificar el texto antes de citarlo.**
2. Callstack. (2026). *React Native Evals, Expo SDK 55, and WebAssembly in Hermes* [Boletín]. https://www.callstack.com/newsletters/react-native-evals-expo-sdk-55-and-webassembly-in-hermes
   — Fuente secundaria. Menciona la posibilidad de precompilar WASM a bytecode de Hermes. No indica versión ni si viene habilitado por defecto.
3. Callstack. (2026). *React Native 0.84: Hermes v1, WebAssembly, and Ecosystem Shifts* [Transmisión]. https://www.callstack.com/events/react-native-0-84-and-other-news
   — Fuente secundaria. Asocia React Native 0.84 (febrero de 2026) con Hermes V1 por defecto y con WebAssembly.
4. Meta Platforms, Inc. (s.f.). *WASM support within Hermes?* (Issue #429). GitHub, facebook/hermes. https://github.com/facebook/hermes/issues/429
   — Antecedente histórico: confirma que Hermes no exponía `WebAssembly` antes de 2026.

**Sobre provers alternativos para móvil:**

5. Privacy & Scaling Explorations (PSE). (s.f.). *Mopro: Comparison of Circom Provers*. https://pse.dev/blog/mopro-comparison-of-circom-provers
   — Compara snarkjs con provers nativos (rapidsnark y otros) para circuitos Circom.

**Documentación de las herramientas usadas:**

6. Iden3. (s.f.). *snarkjs* [Repositorio de GitHub]. https://github.com/iden3/snarkjs (ya citada como [15] en la propuesta).
7. react-native-webview. (s.f.). *React Native WebView* [Repositorio de GitHub]. https://github.com/react-native-webview/react-native-webview
8. Meta Platforms, Inc. (s.f.). *Using Hermes*. React Native Documentation. https://reactnative.dev/docs/hermes

> **Nota para la tesis:** la evidencia más fuerte es **nuestra propia medición** (sección "Resultados"): Hermes `250829098.0.17` incluido en React Native 0.87.1 no expone `WebAssembly`. Las fuentes 1–3 sirven para contextualizar que el soporte existe en desarrollo, pero no estaba disponible en la versión evaluada.

## Pendientes
- **Repetir en un teléfono físico Android 13+ de gama media** (el APK ya incluye arm64-v8a). Es la medición que vale para el OE5.
- Repetir cuando el circuito incluya la **verificación de la firma del emisor**, porque el tiempo crecerá con las restricciones.
- Vigilar el soporte de WebAssembly en Hermes: si React Native lo habilita, se podría prescindir de la WebView.
