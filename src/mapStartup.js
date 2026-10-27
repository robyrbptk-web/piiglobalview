const clean = (value) => String(value || '').trim();
const DEFAULT_TILESET_TIMEOUT_MS = 15_000;

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Google 3D Tiles request timed out after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string, requestTimeoutMs?: number}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({ googleApiKey = '', cesiumToken = '' } = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  {
    googleApiKey = '',
    cesiumToken = '',
    requestTimeoutMs = DEFAULT_TILESET_TIMEOUT_MS,
  } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    Cesium.GoogleMaps.defaultApiKey = attempt.googleKey;
    try {
      const tileset = await withTimeout(
        Cesium.createGooglePhotorealistic3DTileset({
          onlyUsingWithGoogleGeocoder: true,
        }),
        requestTimeoutMs,
      );
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  Cesium.GoogleMaps.defaultApiKey = undefined;
  return { tileset: null, route: 'osm', errors };
}
