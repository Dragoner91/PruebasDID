// Despliega los verificadores Solidity exportados por snarkjs en la red local de
// Hardhat y mide el Gas de despliegue y de verificación de cada esquema.
// Requiere haber ejecutado scripts/setup.js y scripts/bench.js (build/muestras.json).
//
// Uso: npx hardhat run scripts/gas.js
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const ROOT = path.join(__dirname, "..");
const BASE_TX = 21000n; // costo intrínseco de cualquier transacción en Ethereum

// Costo del calldata según EIP-2028: 16 gas por byte no nulo y 4 por byte nulo.
function gasCalldata(dataHex) {
  const bytes = Buffer.from(dataHex.slice(2), "hex");
  return bytes.reduce((g, b) => g + (b === 0 ? 4n : 16n), 0n);
}

// Altera la primera señal pública (sumando 1) para comprobar que el verificador rechaza.
function alterar(args) {
  const copia = JSON.parse(JSON.stringify(args));
  const pub = copia[copia.length - 1];
  pub[0] = "0x" + (BigInt(pub[0]) + 1n).toString(16).padStart(64, "0");
  return copia;
}

async function main() {
  const muestras = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "muestras.json"), "utf8"));
  const resultados = [];

  for (const [circuito, porEsquema] of Object.entries(muestras)) {
    for (const [esquema, { args, contrato }] of Object.entries(porEsquema)) {
      const verificador = await hre.ethers.deployContract(contrato);
      const recibo = await verificador.deploymentTransaction().wait();

      const valida = await verificador.verifyProof(...args);
      const alterada = await verificador.verifyProof(...alterar(args));
      if (valida !== true || alterada !== false) {
        throw new Error(`${contrato}: válida=${valida}, alterada=${alterada}`);
      }

      // verifyProof es `view`: se estima el Gas que costaría invocarlo en una transacción.
      const data = verificador.interface.encodeFunctionData("verifyProof", args);
      const total = await hre.ethers.provider.estimateGas({ to: await verificador.getAddress(), data });
      const calldata = gasCalldata(data);

      resultados.push({
        circuito,
        esquema,
        contrato,
        aceptaValida: valida,
        rechazaAlterada: !alterada,
        gas: {
          despliegue: Number(recibo.gasUsed),
          verificacionTotalTx: Number(total),
          calldata: Number(calldata),
          ejecucion: Number(total - BASE_TX - calldata),
        },
        bytesCalldata: (data.length - 2) / 2,
      });
    }
  }

  const entorno = {
    fecha: new Date().toISOString(),
    hardhat: hre.version ?? require("hardhat/package.json").version,
    hardfork: hre.config.networks.hardhat.hardfork,
    solc: hre.config.solidity.compilers[0].version,
    optimizador: hre.config.solidity.compilers[0].settings.optimizer,
  };
  const dirRes = path.join(ROOT, "resultados");
  fs.mkdirSync(dirRes, { recursive: true });
  const archivo = path.join(dirRes, `gas-hardhat-${entorno.fecha.slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ entorno, resultados }, null, 2));

  console.log("Entorno:", entorno);
  console.table(
    resultados.map((r) => ({
      circuito: r.circuito,
      esquema: r.esquema,
      "valida/alterada": `${r.aceptaValida ? "acepta" : "FALLA"} / ${r.rechazaAlterada ? "rechaza" : "FALLA"}`,
      "gas verificación (tx)": r.gas.verificacionTotalTx,
      "gas ejecución": r.gas.ejecucion,
      "gas calldata": r.gas.calldata,
      "bytes calldata": r.bytesCalldata,
      "gas despliegue": r.gas.despliegue,
    }))
  );
  console.log(`Resultados guardados en ${path.relative(ROOT, archivo)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
