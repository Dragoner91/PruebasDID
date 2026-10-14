// Prueba 03: ¿puede React Native ejecutar WebAssembly y generar pruebas Groth16?
// Al abrirse, la app ejecuta en secuencia:
//   1. Diagnóstico del motor JS (Hermes)
//   2. Módulo WASM mínimo en Hermes
//   3. snarkjs (Groth16, circuito mayoria_edad) en Hermes
//   4. Diagnóstico de la WebView
//   5. snarkjs en la WebView, en un hilo y en varios hilos
// Cada resultado se muestra en pantalla y se registra en logcat con el prefijo
// "RESULTADO_JSON" para recolectarlo desde el PC.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { diagnosticoMotor, ENTRADA, estadisticas, snarkjsEnMotor, wasmMinimo } from './src/pruebas';
import { VKEY, WASM_B64, ZKEY_B64, SNARKJS_VERSION } from './src/generado/artefactos';
import { WEBVIEW_HTML } from './src/generado/webviewHtml';

const N = 10; // repeticiones medidas (más 1 de calentamiento)
const LIMITE_MS = 120000; // tiempo máximo por paso

type Paso = { nombre: string; estado: 'pendiente' | 'ok' | 'falla'; detalle?: string };

function registrar(nombre: string, datos: unknown) {
  console.log('RESULTADO_JSON ' + JSON.stringify({ nombre, datos }));
}

// Al cargar snarkjs en Hermes se lanza un error no capturado (RN no puede crear un
// Blob desde un ArrayBuffer) que en modo release cierra la app. Se registra como
// resultado de la prueba en vez de dejar que termine el proceso.
const ErrorUtilsGlobal = (globalThis as any).ErrorUtils;
ErrorUtilsGlobal?.setGlobalHandler((error: any, esFatal?: boolean) => {
  registrar('error_global_no_capturado', { esFatal, error: String(error?.stack ?? error) });
});

// Ningún paso puede quedarse esperando en silencio.
function conLimite<T>(p: Promise<T>, que: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rechazar) =>
      setTimeout(() => rechazar(new Error(`Tiempo agotado (${LIMITE_MS / 1000} s): ${que}`)), LIMITE_MS),
    ),
  ]);
}

// Separa la repetición de calentamiento (incluye compilar WASM y construir la curva).
function resumirTiempos(r: { tiempos: number[]; verifs: number[] }) {
  return {
    primeraEjecucionMs: Math.round(r.tiempos[0]),
    pruebaMs: estadisticas(r.tiempos.slice(1)),
    verificacionMs: estadisticas(r.verifs.slice(1)),
  };
}

function textoTiempos(ok: boolean, t: ReturnType<typeof resumirTiempos>) {
  return (
    `verifica: ${ok}\n1ª ejecución: ${t.primeraEjecucionMs} ms\n` +
    `prueba: mediana ${t.pruebaMs.mediana} ms (media ${t.pruebaMs.media} ± ${t.pruebaMs.desv})`
  );
}

export default function App() {
  const [pasos, setPasos] = useState<Paso[]>([]);
  const webview = useRef<WebView>(null);
  const pendientes = useRef(new Map<string, (m: any) => void>());
  // La promesa se crea una sola vez: un `useRef(new Promise(...))` la recrearía en
  // cada render y el aviso "listo" de la WebView resolvería una promesa descartada.
  const lista = useRef<{ promesa: Promise<void>; resolver: () => void } | null>(null);
  if (!lista.current) {
    let resolver: () => void = () => {};
    const promesa = new Promise<void>((res) => (resolver = res));
    lista.current = { promesa, resolver };
  }

  const actualizar = (p: Paso) =>
    setPasos((prev) => [...prev.filter((x) => x.nombre !== p.nombre), p]);

  const alMensaje = useCallback((e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.id === 'listo') return lista.current?.resolver();
    pendientes.current.get(m.id)?.(m);
    pendientes.current.delete(m.id);
  }, []);

  const enWebView = (orden: object, id: string) =>
    new Promise<any>((resolve) => {
      pendientes.current.set(id, resolve);
      webview.current?.postMessage(JSON.stringify({ ...orden, id }));
    });

  useEffect(() => {
    async function paso(nombre: string, fn: () => Promise<{ ok: boolean; detalle: string; datos: unknown }>) {
      actualizar({ nombre, estado: 'pendiente' });
      try {
        const { ok, detalle, datos } = await conLimite(fn(), nombre);
        registrar(nombre, { ok, ...(datos as object) });
        actualizar({ nombre, estado: ok ? 'ok' : 'falla', detalle });
      } catch (err: any) {
        const error = String(err?.stack ?? err);
        registrar(nombre, { ok: false, error });
        actualizar({ nombre, estado: 'falla', detalle: error.split('\n').slice(0, 3).join('\n') });
      }
    }

    (async () => {
      registrar('inicio', { plataforma: Platform.OS, version: Platform.Version, constantes: Platform.constants, snarkjs: SNARKJS_VERSION, n: N, entrada: ENTRADA });

      await paso('1. Diagnóstico de Hermes', async () => {
        const d = diagnosticoMotor();
        return { ok: true, detalle: JSON.stringify(d, null, 1), datos: d };
      });

      await paso('2. WASM mínimo en Hermes', async () => {
        const r = await wasmMinimo();
        return { ok: r.ok, detalle: JSON.stringify(r), datos: r };
      });

      await paso('3. snarkjs Groth16 en Hermes', async () => {
        const r = await snarkjsEnMotor(N);
        const t = resumirTiempos(r);
        return { ok: r.ok, detalle: textoTiempos(r.ok, t), datos: { ...t, proof: r.proof, publicSignals: r.publicSignals } };
      });

      await paso('4. Diagnóstico de la WebView', async () => {
        await lista.current!.promesa;
        const m = await enWebView({ cmd: 'diag' }, 'diag');
        return { ok: m.ok, detalle: JSON.stringify(m.datos ?? m.error, null, 1), datos: m.datos ?? { error: m.error } };
      });

      for (const singleThread of [true, false]) {
        await paso(`5. snarkjs Groth16 en WebView (${singleThread ? '1 hilo' : 'varios hilos'})`, async () => {
          const m = await enWebView(
            { cmd: 'probar', n: N, entrada: ENTRADA, wasm: WASM_B64, zkey: ZKEY_B64, vkey: VKEY, singleThread },
            `probar-${singleThread}`,
          );
          if (!m.ok) return { ok: false, detalle: m.error, datos: { error: m.error } };
          const t = resumirTiempos(m.datos);
          return { ok: m.datos.ok, detalle: textoTiempos(m.datos.ok, t), datos: { ...t, proof: m.datos.proof, publicSignals: m.datos.publicSignals } };
        });
      }

      registrar('fin', {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={estilos.contenedor}>
        <StatusBar barStyle="dark-content" />
        <Text style={estilos.titulo}>Prueba 03 · WebAssembly en React Native</Text>
        <ScrollView>
          {pasos.map((p) => (
            <View key={p.nombre} style={estilos.paso}>
              <Text style={estilos.nombre}>
                {p.estado === 'pendiente' ? '⏳' : p.estado === 'ok' ? '✅' : '❌'} {p.nombre}
              </Text>
              {p.detalle ? <Text style={estilos.detalle}>{p.detalle}</Text> : null}
            </View>
          ))}
        </ScrollView>
        {/* WebView oculta: solo ejecuta snarkjs; no carga nada de la red. */}
        <WebView
          ref={webview}
          style={estilos.webview}
          source={{ html: WEBVIEW_HTML }}
          originWhitelist={['*']}
          onMessage={alMensaje}
          javaScriptEnabled
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const estilos = StyleSheet.create({
  contenedor: { flex: 1, backgroundColor: '#fff', padding: 12 },
  titulo: { fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#111' },
  paso: { marginBottom: 10, padding: 8, borderRadius: 6, backgroundColor: '#f3f4f6' },
  nombre: { fontSize: 15, fontWeight: '600', color: '#111' },
  detalle: { fontSize: 12, fontFamily: 'monospace', color: '#333', marginTop: 4 },
  webview: { width: 1, height: 1, opacity: 0 },
});
