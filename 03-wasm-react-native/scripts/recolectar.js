// Recolecta los resultados que la app registra en logcat (líneas "RESULTADO_JSON"),
// RE-VERIFICA en Node cada prueba generada en el dispositivo con la vkey de la
// prueba 01 (verificación independiente del motor que la generó) y guarda un resumen.
//
// Uso: node scripts/recolectar.js <archivo-logcat.txt> <etiqueta>
//   p. ej.: adb logcat -d -s ReactNativeJS > logcat.txt
//           node scripts/recolectar.js logcat.txt emulador-x86_64
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const [archivo, etiqueta = "dispositivo"] = process.argv.slice(2);
if (!archivo) {
  console.error("Uso: node scripts/recolectar.js <archivo-logcat.txt> <etiqueta>");
  process.exit(1);
}

const VKEY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "..", "01-circuito-umbral-edad", "build", "mayoria_edad", "mayoria_edad_vkey.json"), "utf8")
);

(async () => {
  // logcat puede venir en UTF-16 si se redirige desde PowerShell.
  const crudo = fs.readFileSync(archivo);
  const texto = crudo[0] === 0xff && crudo[1] === 0xfe ? crudo.toString("utf16le") : crudo.toString("utf8");

  // Si la app se ejecutó varias veces, se toma la última corrida completa.
  const lineas = texto.split(/\r?\n/).filter((l) => l.includes("RESULTADO_JSON "));
  const inicio = lineas.map((l) => l.includes('"nombre":"inicio"')).lastIndexOf(true);
  const corrida = lineas.slice(inicio).map((l) => JSON.parse(l.slice(l.indexOf("RESULTADO_JSON ") + 15)));
  if (!corrida.length) throw new Error("No se encontraron líneas RESULTADO_JSON en el archivo");

  for (const r of corrida) {
    if (r.datos?.proof && r.datos?.publicSignals) {
      r.datos.reverificadaEnNode = await snarkjs.groth16.verify(VKEY, r.datos.publicSignals, r.datos.proof);
    }
  }
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();

  const dirRes = path.join(ROOT, "resultados");
  fs.mkdirSync(dirRes, { recursive: true });
  const salida = path.join(dirRes, `${etiqueta}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(salida, JSON.stringify(corrida, null, 2));

  for (const r of corrida) {
    const d = r.datos ?? {};
    const linea = [r.nombre.padEnd(42)];
    if ("ok" in d) linea.push(d.ok ? "OK   " : "FALLA");
    if (d.pruebaMs) linea.push(`1ª: ${d.primeraEjecucionMs} ms | prueba mediana ${d.pruebaMs.mediana} ms (media ${d.pruebaMs.media} ± ${d.pruebaMs.desv}, p95 ${d.pruebaMs.p95}) | verif ${d.verificacionMs.mediana} ms`);
    if ("reverificadaEnNode" in d) linea.push(`| re-verificada en Node: ${d.reverificadaEnNode}`);
    if (d.error) linea.push(`| ${String(d.error).split("\n")[0]}`);
    console.log(linea.join(" "));
  }
  console.log(`\nGuardado en ${path.relative(ROOT, salida)}`);
})();
