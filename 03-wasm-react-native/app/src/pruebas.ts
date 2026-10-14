// Pruebas que se ejecutan directamente en el motor JS de React Native (Hermes).
import { WASM_B64, ZKEY_B64, VKEY } from './generado/artefactos';

export const ENTRADA = { fechaNacimiento: 19950617, fechaActual: 20261013, edadMinima: 18 };

const ahora = (): number => {
  const perf = (globalThis as any).performance;
  return perf?.now ? perf.now() : Date.now();
};

// Decodificador base64 propio: no depende de que el motor tenga `atob`.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ABytes(b64: string): Uint8Array {
  const limpio = b64.replace(/=+$/, '');
  const salida = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let buffer = 0, bits = 0, j = 0;
  for (let i = 0; i < limpio.length; i++) {
    buffer = (buffer << 6) | ALFABETO.indexOf(limpio[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida[j++] = (buffer >> bits) & 0xff;
    }
  }
  return salida;
}

export function estadisticas(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const media = s.reduce((a, b) => a + b, 0) / s.length;
  const desv = Math.sqrt(s.reduce((a, b) => a + (b - media) ** 2, 0) / (s.length - 1 || 1));
  const pct = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const r = (x: number) => Math.round(x * 10) / 10;
  return { n: s.length, media: r(media), mediana: r(pct(50)), desv: r(desv), p95: r(pct(95)), min: r(s[0]), max: r(s[s.length - 1]) };
}

// 1. ¿Qué ofrece el motor?
export function diagnosticoMotor() {
  const g: any = globalThis;
  return {
    motor: g.HermesInternal ? 'Hermes' : 'otro',
    hermes: g.HermesInternal?.getRuntimeProperties?.() ?? null,
    webAssembly: typeof g.WebAssembly,
    webAssemblyApi: g.WebAssembly ? Object.getOwnPropertyNames(g.WebAssembly) : [],
    bigInt: typeof g.BigInt,
    textEncoder: typeof g.TextEncoder,
    textDecoder: typeof g.TextDecoder,
    cryptoGetRandomValues: typeof g.crypto?.getRandomValues,
    worker: typeof g.Worker,
    sharedArrayBuffer: typeof g.SharedArrayBuffer,
    atob: typeof g.atob,
  };
}

// 2. Módulo WASM mínimo escrito a mano: exporta add(i32, i32) -> i32.
const WASM_ADD = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // cabecera "\0asm" v1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // tipo: (i32, i32) -> i32
  0x03, 0x02, 0x01, 0x00, // función 0 de tipo 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export "add"
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // local.get 0 + local.get 1
]);

export async function wasmMinimo() {
  const g: any = globalThis;
  if (typeof g.WebAssembly === 'undefined') {
    return { ok: false, error: 'WebAssembly no está definido en este motor' };
  }
  const valido = g.WebAssembly.validate(WASM_ADD);
  const { instance } = await g.WebAssembly.instantiate(WASM_ADD);
  const suma = instance.exports.add(2, 40);
  const memoria = new g.WebAssembly.Memory({ initial: 1, maximum: 64 });
  memoria.grow(8);
  return { ok: valido && suma === 42, valido, suma, paginasMemoria: memoria.buffer.byteLength / 65536 };
}

// 3. snarkjs (Groth16) directamente en el motor, en modo de un hilo.
export async function snarkjsEnMotor(n: number) {
  const snarkjs = require('./generado/snarkjs');
  const wasm = base64ABytes(WASM_B64);
  const zkey = base64ABytes(ZKEY_B64);
  const tiempos: number[] = [], verifs: number[] = [];
  let proof: any, publicSignals: any, ok = true;
  for (let i = 0; i <= n; i++) {
    const t0 = ahora();
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(ENTRADA, wasm, zkey, undefined, undefined, { singleThread: true }));
    const t1 = ahora();
    ok = ok && (await snarkjs.groth16.verify(VKEY, publicSignals, proof));
    const t2 = ahora();
    tiempos.push(t1 - t0);
    verifs.push(t2 - t1);
  }
  return { ok, tiempos, verifs, proof, publicSignals };
}
