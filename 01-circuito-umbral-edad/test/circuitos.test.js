// Pruebas unitarias de los circuitos (OE2.c): aceptan entradas válidas y
// rechazan las inválidas. Se ejecutan sobre el witness, sin generar pruebas.
const path = require("path");
const { assert } = require("chai");
const wasmTester = require("circom_tester").wasm;

const OPCIONES = { include: [path.join(__dirname, "..", "node_modules")] };
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // primo del campo BN254
const HOY = 20261013;

async function acepta(circuito, entrada) {
  const w = await circuito.calculateWitness(entrada, true);
  await circuito.checkConstraints(w);
}

async function rechaza(circuito, entrada) {
  let fallo = false;
  try {
    await circuito.calculateWitness(entrada, true);
  } catch (e) {
    fallo = true;
  }
  assert.isTrue(fallo, `se esperaba rechazo para ${JSON.stringify(entrada, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
}

describe("MayoriaEdad (fechaNacimiento + edadMinima*10000 <= fechaActual)", function () {
  this.timeout(60000);
  let c;
  before(async () => {
    c = await wasmTester(path.join(__dirname, "..", "circuits", "mayoria_edad.circom"), OPCIONES);
  });

  const e = (fechaNacimiento, edadMinima = 18, fechaActual = HOY) => ({ fechaNacimiento, fechaActual, edadMinima });

  describe("acepta", () => {
    it("adulto claro (1990-01-01)", () => acepta(c, e(19900101)));
    it("cumple 18 exactamente hoy (2008-10-13)", () => acepta(c, e(20081013)));
    it("edad mínima distinta: 21 años con nacimiento 2005-01-01", () => acepta(c, e(20050101, 21)));
    it("nacido el 29-feb: es mayor el 01-mar del año en que cumple", () => acepta(c, e(20080229, 18, 20260301)));
    it("edad mínima 0 siempre se cumple para fechas pasadas", () => acepta(c, e(20261013, 0)));
  });

  describe("rechaza", () => {
    it("cumple 18 mañana (2008-10-14)", () => rechaza(c, e(20081014)));
    it("menor de edad claro (2010-01-01)", () => rechaza(c, e(20100101)));
    it("20 años no alcanza edad mínima 21", () => rechaza(c, e(20060101, 21)));
    it("nacido el 29-feb: aún no es mayor el 28-feb", () => rechaza(c, e(20080229, 18, 20260228)));
    // p-1 equivale a -1 en el campo: (p-1) + 180000 ≡ 179999 <= fechaActual.
    it("ataque de desbordamiento: fecha 'negativa' p-1", () => rechaza(c, e(P - 1n)));
    it("fechaNacimiento fuera de 27 bits", () => rechaza(c, e(2 ** 27)));
    it("fechaActual fuera de 27 bits", () => rechaza(c, e(19900101, 18, 2 ** 27)));
    it("edadMinima fuera de 8 bits (256)", () => rechaza(c, e(17000101, 256, 99991231)));
  });
});

// Control negativo: la misma comparación sin las cotas Num2Bits. Demuestra que
// las cotas no son decorativas: sin ellas el ataque p-1 produce un witness válido.
describe("Control: MayoriaEdad SIN cotas de rango (vulnerable a propósito)", function () {
  this.timeout(60000);
  let c;
  before(async () => {
    c = await wasmTester(path.join(__dirname, "fixtures", "mayoria_edad_sin_cotas.circom"), OPCIONES);
  });

  it("el ataque p-1 PASA cuando no hay cotas", () =>
    acepta(c, { fechaNacimiento: P - 1n, fechaActual: HOY, edadMinima: 18 }));
});

describe("Vigencia (fechaExpiracion >= fechaActual)", function () {
  this.timeout(60000);
  let c;
  before(async () => {
    c = await wasmTester(path.join(__dirname, "..", "circuits", "vigencia.circom"), OPCIONES);
  });

  const e = (fechaExpiracion, fechaActual = HOY) => ({ fechaExpiracion, fechaActual });

  describe("acepta", () => {
    it("expira en el futuro (2027-01-01)", () => acepta(c, e(20270101)));
    it("expira hoy (vigente hasta el final del día)", () => acepta(c, e(HOY)));
  });

  describe("rechaza", () => {
    it("expiró ayer (2026-10-12)", () => rechaza(c, e(20261012)));
    it("ataque de desbordamiento: fecha p-1", () => rechaza(c, e(P - 1n)));
    it("fechaExpiracion fuera de 27 bits", () => rechaza(c, e(2 ** 27)));
  });
});
