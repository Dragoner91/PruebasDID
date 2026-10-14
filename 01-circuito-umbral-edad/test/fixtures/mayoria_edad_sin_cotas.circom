pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";

// SOLO PARA PRUEBAS: versión deliberadamente vulnerable de MayoriaEdad, sin las
// cotas Num2Bits sobre las entradas. No usar fuera de test/circuitos.test.js.
template MayoriaEdadSinCotas() {
    signal input fechaNacimiento;
    signal input fechaActual;
    signal input edadMinima;

    component cmp = LessEqThan(28);
    cmp.in[0] <== fechaNacimiento + edadMinima * 10000;
    cmp.in[1] <== fechaActual;
    cmp.out === 1;
}

component main {public [fechaActual, edadMinima]} = MayoriaEdadSinCotas();
