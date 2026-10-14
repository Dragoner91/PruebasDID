// Prepara los tres esquemas (Groth16, PLONK y FFLONK) sobre los MISMOS circuitos
// de la prueba 01 y exporta un contrato verificador Solidity por esquema y circuito.
//
// Diferencia clave entre esquemas, visible en este script:
//   - Groth16: setup específico por circuito (fase 2 con contribución y beacon).
//   - PLONK y FFLONK: setup universal; la .zkey sale directamente del ptau, sin
//     contribuciones por circuito.
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const CIRCUITOS_DIR = path.join(ROOT, "..", "01-circuito-umbral-edad", "circuits");
const CONTRATOS = path.join(ROOT, "contracts");
const SNARKJS = `node "${path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs")}"`;
const CIRCUITOS = ["mayoria_edad", "vigencia"];
const ESQUEMAS = ["groth16", "plonk", "fflonk"];
const POTENCIA_TAU = 12;
const ITERACIONES_BEACON = 10;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  const salida = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  process.stdout.write(salida);
  return salida;
}

const aleatorio = () => crypto.randomBytes(32).toString("hex");
const limpiar = (s) => s.replace(/\x1b\[[0-9;]*m/g, ""); // quita colores ANSI del log de snarkjs
const info = { fecha: new Date().toISOString(), potenciaTau: POTENCIA_TAU, beacons: {}, circuitos: {} };

fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(CONTRATOS, { recursive: true });

// Fase 1 (Powers of Tau): común a los tres esquemas.
const ptau = path.join(BUILD, `pot${POTENCIA_TAU}_final.ptau`);
if (!fs.existsSync(ptau)) {
  const p0 = path.join(BUILD, "pot_0000.ptau");
  const p1 = path.join(BUILD, "pot_0001.ptau");
  const pb = path.join(BUILD, "pot_beacon.ptau");
  info.beacons.fase1 = aleatorio();
  run(`${SNARKJS} powersoftau new bn128 ${POTENCIA_TAU} "${p0}"`);
  run(`${SNARKJS} powersoftau contribute "${p0}" "${p1}" --name="UCAB academico" -e="${aleatorio()}"`);
  run(`${SNARKJS} powersoftau beacon "${p1}" "${pb}" ${info.beacons.fase1} ${ITERACIONES_BEACON} -n="Beacon final fase 1"`);
  run(`${SNARKJS} powersoftau prepare phase2 "${pb}" "${ptau}"`);
  run(`${SNARKJS} powersoftau verify "${ptau}"`);
  for (const f of [p0, p1, pb]) fs.rmSync(f);
}

for (const c of CIRCUITOS) {
  const dir = path.join(BUILD, c);
  fs.mkdirSync(dir, { recursive: true });
  run(`circom "${path.join(CIRCUITOS_DIR, `${c}.circom`)}" --r1cs --wasm -o "${dir}" -l node_modules`);
  const r1cs = path.join(dir, `${c}.r1cs`);
  const datos = (info.circuitos[c] = {});

  // Groth16: setup específico del circuito (igual que la prueba 01).
  {
    const z0 = path.join(dir, `${c}_groth16_0000.zkey`);
    const z1 = path.join(dir, `${c}_groth16_0001.zkey`);
    info.beacons[`${c}_groth16`] = aleatorio();
    run(`${SNARKJS} groth16 setup "${r1cs}" "${ptau}" "${z0}"`);
    run(`${SNARKJS} zkey contribute "${z0}" "${z1}" --name="UCAB academico" -e="${aleatorio()}"`);
    run(`${SNARKJS} zkey beacon "${z1}" "${path.join(dir, `${c}_groth16.zkey`)}" ${info.beacons[`${c}_groth16`]} ${ITERACIONES_BEACON} -n="Beacon final fase 2"`);
    run(`${SNARKJS} zkey verify "${r1cs}" "${ptau}" "${path.join(dir, `${c}_groth16.zkey`)}"`);
    for (const f of [z0, z1]) fs.rmSync(f);
  }

  // PLONK: setup universal, sin contribuciones por circuito.
  {
    const log = limpiar(run(`${SNARKJS} plonk setup "${r1cs}" "${ptau}" "${path.join(dir, `${c}_plonk.zkey`)}"`));
    datos.restriccionesPlonk = Number(log.match(/Plonk constraints:\s*(\d+)/)[1]);
  }

  // FFLONK: setup universal.
  {
    const log = limpiar(run(`${SNARKJS} fflonk setup "${r1cs}" "${ptau}" "${path.join(dir, `${c}_fflonk.zkey`)}"`));
    datos.restriccionesFflonk = Number(log.match(/Constraints:\s*(\d+)/)[1]);
    datos.dominioFflonk = Number(log.match(/Domain size:\s*(\d+)/)[1]);
  }

  for (const e of ESQUEMAS) {
    const zkey = path.join(dir, `${c}_${e}.zkey`);
    run(`${SNARKJS} zkey export verificationkey "${zkey}" "${path.join(dir, `${c}_${e}_vkey.json`)}"`);

    // Cada contrato exportado se llama igual por esquema (Groth16Verifier, ...);
    // se renombra con el sufijo del circuito para que Hardhat los distinga.
    const sol = path.join(CONTRATOS, `${c}_${e}.sol`);
    run(`${SNARKJS} zkey export solidityverifier "${zkey}" "${sol}"`);
    const codigo = fs.readFileSync(sol, "utf8");
    const nombre = codigo.match(/contract\s+(\w+)/)[1];
    fs.writeFileSync(sol, codigo.replace(new RegExp(`contract\\s+${nombre}\\b`), `contract ${nombre}_${c}`));
    datos[`contrato_${e}`] = `${nombre}_${c}`;
  }
}

fs.writeFileSync(path.join(BUILD, "info-setup.json"), JSON.stringify(info, null, 2));
console.log("\nSetup completo. Artefactos en build/, verificadores en contracts/");
