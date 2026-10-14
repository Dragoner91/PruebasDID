// Compila los circuitos y ejecuta el trusted setup Groth16 de cada uno,
// siguiendo el flujo documentado en el README de snarkjs:
//   Fase 1: powersoftau new -> contribute -> beacon -> prepare phase2 -> verify
//   Fase 2: groth16 setup -> zkey contribute -> zkey beacon -> zkey verify -> export vkey
//
// Setup ACADÉMICO (limitación 4 de la propuesta): una contribución por fase con
// entropía local y un beacon aleatorio local. En producción, la fase 1 se toma de
// una ceremonia pública y la fase 2 se hace con varios participantes
// independientes y un beacon público (p. ej. el hash de un bloque futuro).
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const SNARKJS = `node "${path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs")}"`;
const CIRCUITOS = ["mayoria_edad", "vigencia"];
const POTENCIA_TAU = 12; // admite circuitos de hasta 2^12 = 4096 restricciones
const ITERACIONES_BEACON = 10; // 2^10 iteraciones del hash del beacon (valor del README)

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

const aleatorio = () => crypto.randomBytes(32).toString("hex");
const bitacora = { fecha: new Date().toISOString(), potenciaTau: POTENCIA_TAU, beacons: {} };

fs.mkdirSync(BUILD, { recursive: true });

// Fase 1: Powers of Tau (independiente del circuito, se reutiliza).
const ptau = path.join(BUILD, `pot${POTENCIA_TAU}_final.ptau`);
if (!fs.existsSync(ptau)) {
  const p0 = path.join(BUILD, `pot${POTENCIA_TAU}_0000.ptau`);
  const p1 = path.join(BUILD, `pot${POTENCIA_TAU}_0001.ptau`);
  const pBeacon = path.join(BUILD, `pot${POTENCIA_TAU}_beacon.ptau`);
  bitacora.beacons.fase1 = aleatorio();
  run(`${SNARKJS} powersoftau new bn128 ${POTENCIA_TAU} "${p0}"`);
  run(`${SNARKJS} powersoftau contribute "${p0}" "${p1}" --name="UCAB academico" -e="${aleatorio()}"`);
  run(`${SNARKJS} powersoftau beacon "${p1}" "${pBeacon}" ${bitacora.beacons.fase1} ${ITERACIONES_BEACON} -n="Beacon final fase 1"`);
  run(`${SNARKJS} powersoftau prepare phase2 "${pBeacon}" "${ptau}"`);
  run(`${SNARKJS} powersoftau verify "${ptau}"`);
  for (const f of [p0, p1, pBeacon]) fs.rmSync(f);
}

// Fase 2: compilación y setup específico de cada circuito.
for (const c of CIRCUITOS) {
  const dir = path.join(BUILD, c);
  fs.mkdirSync(dir, { recursive: true });
  run(`circom "circuits/${c}.circom" --r1cs --wasm --sym --inspect -o "${dir}" -l node_modules`);

  const r1cs = path.join(dir, `${c}.r1cs`);
  const z0 = path.join(dir, `${c}_0000.zkey`);
  const z1 = path.join(dir, `${c}_0001.zkey`);
  const zFinal = path.join(dir, `${c}_final.zkey`);
  bitacora.beacons[c] = aleatorio();
  run(`${SNARKJS} groth16 setup "${r1cs}" "${ptau}" "${z0}"`);
  run(`${SNARKJS} zkey contribute "${z0}" "${z1}" --name="UCAB academico" -e="${aleatorio()}"`);
  run(`${SNARKJS} zkey beacon "${z1}" "${zFinal}" ${bitacora.beacons[c]} ${ITERACIONES_BEACON} -n="Beacon final fase 2"`);
  run(`${SNARKJS} zkey verify "${r1cs}" "${ptau}" "${zFinal}"`);
  run(`${SNARKJS} zkey export verificationkey "${zFinal}" "${path.join(dir, `${c}_vkey.json`)}"`);
  for (const f of [z0, z1]) fs.rmSync(f);
}

// Los beacons se publican: cualquiera puede re-verificar las claves con ellos.
fs.writeFileSync(path.join(BUILD, "bitacora-setup.json"), JSON.stringify(bitacora, null, 2));
console.log("\nSetup completo. Artefactos y bitácora en build/");
