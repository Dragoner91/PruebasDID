// Línea base de desempeño en PC (métricas del OE5, salvo Gas y latencia en red):
// restricciones, tiempo de witness y de prueba, verificación off-chain, tamaño de
// la prueba y de los artefactos que habría que empaquetar en la app móvil.
//
// Uso: node scripts/bench.js [N]   (N repeticiones por circuito, por defecto 30)
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const N = Number(process.argv[2] || 30);

const CASOS = {
  mayoria_edad: { fechaNacimiento: 19950617, fechaActual: 20261013, edadMinima: 18 },
  vigencia: { fechaExpiracion: 20300101, fechaActual: 20261013 },
};

function estadisticas(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const media = s.reduce((a, b) => a + b, 0) / s.length;
  const desv = Math.sqrt(s.reduce((a, b) => a + (b - media) ** 2, 0) / (s.length - 1 || 1));
  const pct = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const r = (x) => Math.round(x * 100) / 100;
  return { media: r(media), mediana: r(pct(50)), desv: r(desv), p95: r(pct(95)), min: r(s[0]), max: r(s[s.length - 1]) };
}

const tam = (f) => fs.statSync(f).size;

async function medir(c, entrada) {
  const dir = path.join(BUILD, c);
  const wasm = path.join(dir, `${c}_js`, `${c}.wasm`);
  const zkey = path.join(dir, `${c}_final.zkey`);
  const vkeyFile = path.join(dir, `${c}_vkey.json`);
  const vkey = JSON.parse(fs.readFileSync(vkeyFile, "utf8"));
  const r1cs = await snarkjs.r1cs.info(path.join(dir, `${c}.r1cs`));

  const tWitness = [], tProve = [], tTotal = [], tVerify = [];
  let proof, publicSignals;

  for (let i = 0; i <= N; i++) {
    const wtns = { type: "mem" };
    const t0 = performance.now();
    await snarkjs.wtns.calculate(entrada, wasm, wtns);
    const t1 = performance.now();
    ({ proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns));
    const t2 = performance.now();
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    const t3 = performance.now();
    if (!ok) throw new Error(`La prueba de ${c} no verificó en la repetición ${i}`);
    if (i === 0) continue; // la primera repetición es de calentamiento (carga de WASM/zkey)
    tWitness.push(t1 - t0);
    tProve.push(t2 - t1);
    tTotal.push(t2 - t0);
    tVerify.push(t3 - t2);
  }

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  return {
    circuito: c,
    restricciones: r1cs.nConstraints,
    entradasPublicas: r1cs.nPubInputs,
    entradasPrivadas: r1cs.nPrvInputs,
    repeticiones: N,
    tiempos_ms: {
      witness: estadisticas(tWitness),
      prueba: estadisticas(tProve),
      witnessMasPrueba: estadisticas(tTotal),
      verificacionOffChain: estadisticas(tVerify),
    },
    tamanos_bytes: {
      // Groth16: 8 elementos de 32 bytes (A: 2, B: 4, C: 2) + 32 por señal pública.
      pruebaBinaria: 32 * 8,
      senalesPublicasBinarias: 32 * publicSignals.length,
      pruebaJSON: Buffer.byteLength(JSON.stringify(proof)),
      calldataSolidityTexto: Buffer.byteLength(calldata),
      wasm: tam(path.join(dir, `${c}_js`, `${c}.wasm`)),
      zkey: tam(zkey),
      vkey: tam(vkeyFile),
    },
  };
}

(async () => {
  const entorno = {
    fecha: new Date().toISOString(),
    so: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0].model.trim(),
    nucleos: os.cpus().length,
    ramGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    snarkjs: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "snarkjs", "package.json"), "utf8")).version,
    circom: execSync("circom --version").toString().trim(),
  };

  const resultados = [];
  for (const [c, entrada] of Object.entries(CASOS)) {
    console.log(`Midiendo ${c} (${N} repeticiones + 1 de calentamiento)...`);
    resultados.push(await medir(c, entrada));
  }
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();

  const salida = { entorno, resultados };
  const dirRes = path.join(ROOT, "resultados");
  fs.mkdirSync(dirRes, { recursive: true });
  const archivo = path.join(dirRes, `bench-pc-${entorno.fecha.slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify(salida, null, 2));

  console.log("\nEntorno:", entorno);
  console.table(
    resultados.map((r) => ({
      circuito: r.circuito,
      restricciones: r.restricciones,
      "witness ms (mediana)": r.tiempos_ms.witness.mediana,
      "prueba ms (mediana)": r.tiempos_ms.prueba.mediana,
      "total ms (media±desv)": `${r.tiempos_ms.witnessMasPrueba.media} ± ${r.tiempos_ms.witnessMasPrueba.desv}`,
      "total ms (p95)": r.tiempos_ms.witnessMasPrueba.p95,
      "verif. ms (mediana)": r.tiempos_ms.verificacionOffChain.mediana,
      "zkey KB": Math.round(r.tamanos_bytes.zkey / 1024),
      "wasm KB": Math.round(r.tamanos_bytes.wasm / 1024),
    }))
  );
  console.log(`Resultados guardados en ${path.relative(ROOT, archivo)}`);
})();
