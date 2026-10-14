// Empaqueta para la app los artefactos del circuito `mayoria_edad` (prueba 01)
// y el bundle de navegador de snarkjs, de modo que la app no dependa de red ni
// del sistema de archivos:
//   app/src/generado/artefactos.js  -> .wasm y .zkey en base64, vkey en JSON
//   app/src/generado/snarkjs.js     -> snarkjs.min.js como módulo CommonJS (para Hermes)
//   app/src/generado/webviewHtml.js -> página HTML con snarkjs embebido (para la WebView)
//
// Uso: node scripts/generar-artefactos.js   (requiere `npm run setup` en la prueba 01)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const P01 = path.join(ROOT, "..", "01-circuito-umbral-edad");
const BUILD01 = path.join(P01, "build", "mayoria_edad");
const SALIDA = path.join(ROOT, "app", "src", "generado");
const SNARKJS_MIN = path.join(P01, "node_modules", "snarkjs", "build", "snarkjs.min.js");

const leer = (f) => {
  if (!fs.existsSync(f)) throw new Error(`Falta ${f}. Ejecuta primero 'npm run setup' en 01-circuito-umbral-edad`);
  return fs.readFileSync(f);
};

const wasm = leer(path.join(BUILD01, "mayoria_edad_js", "mayoria_edad.wasm"));
const zkey = leer(path.join(BUILD01, "mayoria_edad_final.zkey"));
const vkey = JSON.parse(leer(path.join(BUILD01, "mayoria_edad_vkey.json")));
const snarkjs = leer(SNARKJS_MIN).toString("utf8");
const version = JSON.parse(fs.readFileSync(path.join(P01, "node_modules", "snarkjs", "package.json"), "utf8")).version;

fs.mkdirSync(SALIDA, { recursive: true });
const cabecera = "// ARCHIVO GENERADO por scripts/generar-artefactos.js. No editar a mano.\n";

fs.writeFileSync(
  path.join(SALIDA, "artefactos.js"),
  cabecera +
    `export const WASM_B64 = ${JSON.stringify(wasm.toString("base64"))};\n` +
    `export const ZKEY_B64 = ${JSON.stringify(zkey.toString("base64"))};\n` +
    `export const VKEY = ${JSON.stringify(vkey)};\n` +
    `export const SNARKJS_VERSION = ${JSON.stringify(version)};\n`
);

// snarkjs.min.js es un IIFE que define `var snarkjs`; se exporta como módulo.
fs.writeFileSync(path.join(SALIDA, "snarkjs.js"), cabecera + snarkjs + "\nmodule.exports = snarkjs;\n");

// Página de la WebView: snarkjs embebido (sin red). Recibe órdenes por postMessage
// y responde con window.ReactNativeWebView.postMessage.
const script = snarkjs.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${script}</script>
<script>
function b64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u;}
function responder(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
async function ejecutar(m){
  const wasm=b64(m.wasm), zkey=b64(m.zkey), tiempos=[], verifs=[];
  let proof, publicSignals, ok=true;
  for(let i=0;i<=m.n;i++){
    const t0=performance.now();
    ({proof, publicSignals}=await snarkjs.groth16.fullProve(m.entrada, wasm, zkey, undefined, undefined, {singleThread:m.singleThread}));
    const t1=performance.now();
    ok = ok && await snarkjs.groth16.verify(m.vkey, publicSignals, proof);
    const t2=performance.now();
    tiempos.push(t1-t0); verifs.push(t2-t1);
  }
  return {ok, tiempos, verifs, proof, publicSignals};
}
function diagnostico(){
  return {userAgent:navigator.userAgent, webAssembly:typeof WebAssembly, worker:typeof Worker,
    sharedArrayBuffer:typeof SharedArrayBuffer, crossOriginIsolated:self.crossOriginIsolated===true,
    hardwareConcurrency:navigator.hardwareConcurrency};
}
async function alRecibir(e){
  let m; try{m=JSON.parse(e.data);}catch(_){return;}
  try{
    if(m.cmd==="diag") responder({id:m.id, ok:true, datos:diagnostico()});
    else if(m.cmd==="probar") responder({id:m.id, ok:true, datos:await ejecutar(m)});
  }catch(err){responder({id:m.id, ok:false, error:String(err&&err.stack||err)});}
}
document.addEventListener("message", alRecibir); // Android
window.addEventListener("message", alRecibir);
responder({id:"listo", ok:true});
</script></body></html>`;
fs.writeFileSync(path.join(SALIDA, "webviewHtml.js"), cabecera + `export const WEBVIEW_HTML = ${JSON.stringify(html)};\n`);

console.log(`Generado en ${path.relative(ROOT, SALIDA)}: wasm ${wasm.length} B, zkey ${zkey.length} B, snarkjs ${version} (${snarkjs.length} B)`);
