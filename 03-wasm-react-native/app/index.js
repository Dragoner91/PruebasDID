/**
 * @format
 */

// Polyfill de crypto.getRandomValues (lo usa snarkjs para la aleatoriedad de la prueba).
// Debe importarse antes que cualquier otro módulo.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
