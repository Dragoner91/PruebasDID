pragma circom 2.1.6;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Conjunto 1 de predicados (propuesta, OE2.a): comparación contra un umbral.
//
// Las fechas se codifican como enteros AAAAMMDD (p. ej. 13/10/2026 -> 20261013).
// Con esta codificación, sumar k*10000 avanza k años conservando mes y día, y el
// orden numérico coincide con el orden cronológico. Por eso:
//   edad(fechaNacimiento, fechaActual) >= edadMinima
//     <=>  fechaNacimiento + edadMinima*10000 <= fechaActual
//
// BITS_FECHA = 27 porque 99991231 < 2^27. Los comparadores de circomlib solo son
// correctos si sus operandos caben en n bits; sin estas cotas, un valor "negativo"
// (cercano al primo del campo) podría hacer pasar una comparación falsa.
//
// Las cotas usan el idioma documentado `_ <== Num2Bits(n)(x);`: la descomposición
// en bits solo interesa por las restricciones que impone, no por su salida.

// Prueba que el titular tiene al menos `edadMinima` años en `fechaActual`
// sin revelar `fechaNacimiento`.
template MayoriaEdad() {
    var BITS_FECHA = 27;

    signal input fechaNacimiento;   // privada (witness)
    signal input fechaActual;       // pública: la fija el verificador, no el titular
    signal input edadMinima;        // pública

    _ <== Num2Bits(BITS_FECHA)(fechaNacimiento);
    _ <== Num2Bits(BITS_FECHA)(fechaActual);
    _ <== Num2Bits(8)(edadMinima);

    // fechaNacimiento + 255*10000 < 2^28, así que 28 bits bastan.
    signal cumple <== LessEqThan(BITS_FECHA + 1)([fechaNacimiento + edadMinima * 10000, fechaActual]);
    cumple === 1;
}

// Prueba que la credencial sigue vigente en `fechaActual` (vigente el mismo día
// de su expiración) sin revelar `fechaExpiracion`.
template Vigencia() {
    var BITS_FECHA = 27;

    signal input fechaExpiracion;   // privada (witness)
    signal input fechaActual;       // pública

    _ <== Num2Bits(BITS_FECHA)(fechaExpiracion);
    _ <== Num2Bits(BITS_FECHA)(fechaActual);

    signal vigente <== GreaterEqThan(BITS_FECHA)([fechaExpiracion, fechaActual]);
    vigente === 1;
}
