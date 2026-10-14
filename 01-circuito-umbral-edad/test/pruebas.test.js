// Pruebas de extremo a extremo con Groth16 real (requiere `npm run setup`):
// generación, verificación, manipulación de señales públicas y el criterio de
// aceptación de privacidad de la propuesta (OE4.d): la entrada privada no debe
// figurar en las señales públicas ni en los datos que se enviarían a la red.
const fs = require("fs");
const path = require("path");
const { assert } = require("chai");
const snarkjs = require("snarkjs");

const BUILD = path.join(__dirname, "..", "build");

function artefactos(c) {
  const dir = path.join(BUILD, c);
  const a = {
    wasm: path.join(dir, `${c}_js`, `${c}.wasm`),
    zkey: path.join(dir, `${c}_final.zkey`),
    vkey: path.join(dir, `${c}_vkey.json`),
  };
  for (const f of Object.values(a)) {
    if (!fs.existsSync(f)) throw new Error(`Falta ${f}. Ejecuta primero: npm run setup`);
  }
  a.vkey = JSON.parse(fs.readFileSync(a.vkey, "utf8"));
  return a;
}

// Representaciones en las que un atributo privado podría filtrarse.
function formasDe(valor) {
  const v = BigInt(valor);
  return [v.toString(), v.toString(16), v.toString(16).padStart(64, "0")];
}

function assertSinFiltracion(valorPrivado, ...textos) {
  for (const t of textos) {
    for (const forma of formasDe(valorPrivado)) {
      assert.notInclude(t.toLowerCase(), forma, `el valor privado ${valorPrivado} aparece como "${forma}"`);
    }
  }
}

describe("Groth16 de extremo a extremo", function () {
  this.timeout(120000);

  after(async () => {
    if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
  });

  describe("MayoriaEdad", () => {
    let a;
    const entrada = { fechaNacimiento: 19950617, fechaActual: 20261013, edadMinima: 18 };
    let proof, publicSignals;

    before(async () => {
      a = artefactos("mayoria_edad");
      ({ proof, publicSignals } = await snarkjs.groth16.fullProve(entrada, a.wasm, a.zkey));
    });

    it("la prueba válida verifica", async () => {
      assert.isTrue(await snarkjs.groth16.verify(a.vkey, publicSignals, proof));
    });

    it("las señales públicas son exactamente [fechaActual, edadMinima]", () => {
      assert.deepEqual(publicSignals, ["20261013", "18"]);
    });

    it("privacidad: fechaNacimiento no aparece en señales públicas, prueba ni calldata", async () => {
      const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
      assertSinFiltracion(entrada.fechaNacimiento, JSON.stringify(publicSignals), JSON.stringify(proof), calldata);
    });

    it("rechaza si se altera edadMinima (18 -> 21)", async () => {
      assert.isFalse(await snarkjs.groth16.verify(a.vkey, ["20261013", "21"], proof));
    });

    it("rechaza si se altera fechaActual", async () => {
      assert.isFalse(await snarkjs.groth16.verify(a.vkey, ["20261014", "18"], proof));
    });

    it("un menor de edad no puede generar la prueba", async () => {
      let fallo = false;
      try {
        await snarkjs.groth16.fullProve({ ...entrada, fechaNacimiento: 20100101 }, a.wasm, a.zkey);
      } catch (e) {
        fallo = true;
      }
      assert.isTrue(fallo);
    });
  });

  describe("Vigencia", () => {
    let a;
    const entrada = { fechaExpiracion: 20300101, fechaActual: 20261013 };
    let proof, publicSignals;

    before(async () => {
      a = artefactos("vigencia");
      ({ proof, publicSignals } = await snarkjs.groth16.fullProve(entrada, a.wasm, a.zkey));
    });

    it("la prueba válida verifica", async () => {
      assert.isTrue(await snarkjs.groth16.verify(a.vkey, publicSignals, proof));
    });

    it("privacidad: fechaExpiracion no aparece en señales públicas, prueba ni calldata", async () => {
      assert.deepEqual(publicSignals, ["20261013"]);
      const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
      assertSinFiltracion(entrada.fechaExpiracion, JSON.stringify(publicSignals), JSON.stringify(proof), calldata);
    });

    it("rechaza si se altera fechaActual", async () => {
      assert.isFalse(await snarkjs.groth16.verify(a.vkey, ["20251013"], proof));
    });
  });
});
