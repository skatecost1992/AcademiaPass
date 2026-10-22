/**
 * Config plugin: fuerza una version de CMake mas reciente en todos los modulos Android con codigo nativo.
 *
 * El CMake 3.22.1 que usa Android por defecto trae un ninja antiguo que no soporta rutas de mas de
 * ~248 caracteres en Windows, y la ruta de este proyecto las supera al compilar las librerias nativas
 * (react-native-screens, safe-area-context...). Con un CMake nuevo (ninja 1.12) y las rutas largas de
 * Windows activadas (LongPathsEnabled=1) se compila directamente en la carpeta del proyecto.
 * Gradle descarga esa version de CMake automaticamente la primera vez.
 *
 * - Librerias: se fija desde el build.gradle raiz al aplicarse el plugin de Android en cada modulo.
 * - :app: Expo lo evalua antes que el final del build.gradle raiz, asi que se fija en su propio build.gradle.
 */
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// academiapass: cmake version';

module.exports = function withCmakeVersion(config, { version = '3.31.6' } = {}) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) return cfg;
    cfg.modResults.contents += `
${MARKER}
subprojects {
    plugins.withId('com.android.library') {
        try {
            android.externalNativeBuild.cmake.version = '${version}'
        } catch (Exception e) {
            logger.warn("academiapass: no se pudo fijar CMake ${version} en \${project.path}: \${e.message}")
        }
    }
}
`;
    return cfg;
  });

  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^android \{/m,
      `android {\n    ${MARKER}\n    externalNativeBuild { cmake { version = '${version}' } }`,
    );
    return cfg;
  });
};
