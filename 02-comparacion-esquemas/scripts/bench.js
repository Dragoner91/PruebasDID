// Mide tiempo de prueba y verificación off-chain, y tamaño de prueba y claves,
// para Groth16, PLONK y FFLONK sobre los mismos circuitos y entradas.
// Guarda además una prueba de muestra por combinación (build/muestras.json) para
// medir el Gas de verificación con scripts/gas.js.
//
// Uso: node scripts/bench.js [N]   (por defecto 30 repeticiones + 1 de calentamiento)
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const N = Number(process.argv[2] || 30);
const ESQUEMAS = ["groth16", "plonk", "fflonk"];
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

// Convierte el calldata textual de snarkjs en los argumentos de verifyProof.
// PLONK y FFLONK: (uint256[24] prueba, uint256[n] públicas). El exportador de PLONK
// omite la coma entre ambos arreglos, por eso se extraen los valores con una regex.
async function argumentosSolidity(esquema, proof, publicSignals) {
  if (esquema === "groth16") {
    return JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
  }
  const texto =
    esquema === "plonk"
      ? await snarkjs.plonk.exportSolidityCallData(proof, publicSignals)
      : await snarkjs.fflonk.exportSolidityCallData(publicSignals, proof); // orden invertido en la API de snarkjs
  const valores = texto.match(/0x[0-9a-fA-F]{64}/g);
  return [valores.slice(0, valores.length - publicSignals.length), valores.slice(-publicSignals.length)];
}

async function medir(c, esquema, entrada) {
  const dir = path.join(BUILD, c);
  const wasm = path.join(dir, `${c}_js`, `${c}.wasm`);
  const zkey = path.join(dir, `${c}_${esquema}.zkey`);
  const vkeyFile = path.join(dir, `${c}_${esquema}_vkey.json`);
  const vkey = JSON.parse(fs.readFileSync(vkeyFile, "utf8"));
  const api = snarkjs[esquema];

  const tWitness = [], tProve = [], tTotal = [], tVerify = [];
  let proof, publicSignals;
  for (let i = 0; i <= N; i++) {
    const wtns = { type: "mem" };
    const t0 = performance.now();
    await snarkjs.wtns.calculate(entrada, wasm, wtns);
    const t1 = performance.now();
    ({ proof, publicSignals } = await api.prove(zkey, wtns));
    const t2 = performance.now();
    const ok = await api.verify(vkey, publicSignals, proof);
    const t3 = performance.now();
    if (!ok) throw new Error(`${esquema}/${c}: la prueba no verificó (repetición ${i})`);
    if (i === 0) continue; // calentamiento
    tWitness.push(t1 - t0);
    tProve.push(t2 - t1);
    tTotal.push(t2 - t0);
    tVerify.push(t3 - t2);
  }

  const args = await argumentosSolidity(esquema, proof, publicSignals);
  const palabrasPrueba = args.slice(0, -1).flat(Infinity).length; // todo menos las señales públicas
  return {
    resultado: {
      circuito: c,
      esquema,
      repeticiones: N,
      tiempos_ms: {
        witness: estadisticas(tWitness),
        prueba: estadisticas(tProve),
        witnessMasPrueba: estadisticas(tTotal),
        verificacionOffChain: estadisticas(tVerify),
      },
      tamanos_bytes: {
        pruebaCalldata: palabrasPrueba * 32,
        senalesPublicas: publicSignals.length * 32,
        zkey: fs.statSync(zkey).size,
        vkey: fs.statSync(vkeyFile).size,
        verificadorSol: fs.statSync(path.join(ROOT, "contracts", `${c}_${esquema}.sol`)).size,
      },
    },
    muestra: { args, publicSignals },
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
  const info = JSON.parse(fs.readFileSync(path.join(BUILD, "info-setup.json"), "utf8"));

  const resultados = [];
  const muestras = {};
  for (const [c, entrada] of Object.entries(CASOS)) {
    muestras[c] = {};
    for (const e of ESQUEMAS) {
      console.log(`Midiendo ${c} / ${e} (${N} repeticiones + 1 de calentamiento)...`);
      const { resultado, muestra } = await medir(c, e, entrada);
      resultado.restricciones = e === "groth16" ? (await snarkjs.r1cs.info(path.join(BUILD, c, `${c}.r1cs`))).nConstraints : info.circuitos[c][e === "plonk" ? "restriccionesPlonk" : "restriccionesFflonk"];
      resultado.contrato = info.circuitos[c][`contrato_${e}`];
      resultados.push(resultado);
      muestras[c][e] = { ...muestra, contrato: resultado.contrato };
    }
  }
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();

  fs.writeFileSync(path.join(BUILD, "muestras.json"), JSON.stringify(muestras, null, 2));
  const dirRes = path.join(ROOT, "resultados");
  fs.mkdirSync(dirRes, { recursive: true });
  const archivo = path.join(dirRes, `bench-pc-${entorno.fecha.slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ entorno, resultados }, null, 2));

  console.log("\nEntorno:", entorno);
  console.table(
    resultados.map((r) => ({
      circuito: r.circuito,
      esquema: r.esquema,
      restricciones: r.restricciones,
      "prueba ms (mediana)": r.tiempos_ms.prueba.mediana,
      "total ms (media±desv)": `${r.tiempos_ms.witnessMasPrueba.media} ± ${r.tiempos_ms.witnessMasPrueba.desv}`,
      "verif ms (mediana)": r.tiempos_ms.verificacionOffChain.mediana,
      "prueba B": r.tamanos_bytes.pruebaCalldata,
      "zkey KB": Math.round(r.tamanos_bytes.zkey / 1024),
    }))
  );
  console.log(`Resultados guardados en ${path.relative(ROOT, archivo)}`);
})();
