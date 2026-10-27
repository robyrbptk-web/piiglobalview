import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * Indonesian volcano catalog (150 entries) from the MIT-licensed
 * indonesia-public-static-api, proxied through `/api/volcanoes`.
 *
 * The upstream stores coordinates as display strings ("5.82°N 95.28°E") and
 * heights as "617 meter" / "−3800 meter" (U+2212 for submarine peaks), so
 * parsing lives in pure exported helpers. One record ("Merbuk") has no
 * coordinate at all and is skipped.
 */

const API_URL = '/api/volcanoes';
const REFRESH_MS = 7 * 24 * 3600_000;

export const VOLCANOES_LAYER_ID = 'indonesian-volcanoes';
export const VOLCANOES_SELECTED_OVERLAY_SOURCE_ID = 'indonesian-volcanoes-selected';
export const VOLCANOES_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export const VOLCANO_BAND_META = Object.freeze({
  submarine: { label: 'Bawah laut', color: '#38bdf8' },
  low: { label: '0–1.000 m', color: '#34d399' },
  mid: { label: '1.000–2.000 m', color: '#fbbf24' },
  high: { label: '2.000–3.000 m', color: '#fb923c' },
  'very-high': { label: '≥3.000 m', color: '#ef4444' },
  unknown: { label: 'Tidak diketahui', color: '#94a3b8' },
});

const BAND_ORDER = Object.freeze(['submarine', 'low', 'mid', 'high', 'very-high', 'unknown']);

/**
 * Parse the upstream `geolokasi` display string.
 * @param {string} value e.g. "5.82°N 95.28°E".
 * @returns {{lat:number, lon:number}|null}
 */
export function parseGeolokasi(value) {
  const match = /^([0-9]+(?:\.[0-9]+)?)°\s*([NS])\s+([0-9]+(?:\.[0-9]+)?)°\s*([EW])$/i
    .exec(String(value ?? '').trim());
  if (!match) return null;
  const lat = Number(match[1]) * (match[2].toUpperCase() === 'S' ? -1 : 1);
  const lon = Number(match[3]) * (match[4].toUpperCase() === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/**
 * Parse the upstream `tinggi_meter` display string. Handles the Unicode minus
 * used for submarine peaks and plain numbers.
 * @param {string|number} value e.g. "617 meter", "−3800 meter", 1810.
 * @returns {number|null}
 */
export function parseHeightMeters(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').replace(/\u2212/g, '-');
  const match = /(-?)\s*([0-9]+(?:\.[0-9]+)?)/.exec(normalized);
  if (!match) return null;
  const height = Number(match[2]) * (match[1] === '-' ? -1 : 1);
  return Number.isFinite(height) ? height : null;
}

/**
 * Height classification used for point color + legend.
 * @param {number|null} heightMeters
 * @returns {keyof VOLCANO_BAND_META}
 */
export function volcanoHeightBand(heightMeters) {
  if (!Number.isFinite(heightMeters)) return 'unknown';
  if (heightMeters < 0) return 'submarine';
  if (heightMeters < 1000) return 'low';
  if (heightMeters < 2000) return 'mid';
  if (heightMeters < 3000) return 'high';
  return 'very-high';
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text && text.toUpperCase() !== 'N/A' ? text : null;
}

function slugId(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Map one raw volcano record to a plain render/analyst record. Pure.
 * @param {object} raw Upstream array entry.
 * @param {number} [index=0]
 * @returns {object|null} Null when the record has no coordinate.
 */
export function normalizeVolcano(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const coords = parseGeolokasi(raw.geolokasi);
  if (!coords) return null;
  const name = textOrNull(raw.nama);
  if (!name) return null;
  const heightMeters = parseHeightMeters(raw.tinggi_meter);
  const lastEruption = textOrNull(raw.estimasi_letusan_terakhir);
  return {
    id: slugId(name) || `volcano-${String(index).padStart(3, '0')}`,
    name,
    shape: textOrNull(raw.bentuk),
    heightMeters,
    band: volcanoHeightBand(heightMeters),
    lastEruption,
    lat: coords.lat,
    lon: coords.lon,
  };
}

/**
 * JSON-safe analyst record. Never NaN/undefined.
 * @param {object|null} record
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapVolcanoAnalystRecord(record, index = 0) {
  const safe = record || {};
  const height = Number(safe.heightMeters);
  return {
    id: textOrNull(safe.id) || `VOLCANO-${String(index).padStart(3, '0')}`,
    name: textOrNull(safe.name) || 'Volcano',
    shape: textOrNull(safe.shape),
    heightMeters: Number.isFinite(height) ? height : null,
    lastEruption: textOrNull(safe.lastEruption),
    lat: Number.isFinite(Number(safe.lat)) ? Number(safe.lat) : null,
    lon: Number.isFinite(Number(safe.lon)) ? Number(safe.lon) : null,
  };
}

/**
 * Build the protected selected-volcano card entry.
 * @param {object} record Render record with a Cesium `position`.
 * @returns {object|null}
 */
export function createVolcanoSelectedOverlayEntry(record) {
  if (!record?.position) return null;
  const meta = VOLCANO_BAND_META[record.band] || VOLCANO_BAND_META.unknown;
  const details = [];
  const shape = record.shape ? record.shape.charAt(0).toUpperCase() + record.shape.slice(1) : 'Gunung api';
  if (Number.isFinite(record.heightMeters)) {
    details.push(`${shape} · ${record.heightMeters.toLocaleString('id-ID')} m`);
  } else {
    details.push(shape);
  }
  if (record.lastEruption) details.push(`Letusan terakhir: ${record.lastEruption}`);
  details.push(`${Math.abs(record.lat).toFixed(3)}°${record.lat < 0 ? 'S' : 'N'} `
    + `${Math.abs(record.lon).toFixed(3)}°${record.lon < 0 ? 'W' : 'E'}`);
  return {
    id: String(record.id),
    position: record.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: `Gunung ${record.name}`,
    details,
    accent: meta.color,
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

export function createVolcanoesLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _viewer = null;
  let _enabled = false;
  let _records = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _loadingLabel = '';
  let _loadPromise = null;
  let _loadAbort = null;
  let _loadEpoch = 0;
  let _refreshTimer = null;
  let _selectedId = null;
  let _selectedEntity = null;
  let _clickHandler = null;

  function _clearSelection() {
    const record = _selectedId ? _records.get(_selectedId) : null;
    if (record?.entity) record.entity.show = true;
    if (_selectedEntity && _viewer) _viewer.entities.remove(_selectedEntity);
    _selectedId = null;
    _selectedEntity = null;
    overlayHost.clearSource(VOLCANOES_SELECTED_OVERLAY_SOURCE_ID);
  }

  function _select(id) {
    _clearSelection();
    const record = _records.get(id);
    if (!record?.position || !_viewer) return;
    _selectedId = id;
    if (record.entity) record.entity.show = false;
    _selectedEntity = _viewer.entities.add({
      position: record.position,
      point: {
        pixelSize: 15,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    const entry = createVolcanoSelectedOverlayEntry(record);
    if (entry) {
      overlayHost.setEntries(
        VOLCANOES_SELECTED_OVERLAY_SOURCE_ID,
        [entry],
        VOLCANOES_SELECTED_OVERLAY_SOURCE_OPTIONS,
      );
    }
    governorRequestRender('indonesian-volcanoes-select');
  }

  function _installClickHandler(viewer) {
    if (_clickHandler) return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const entity = picked?.id;
      const entityId = typeof entity === 'string'
        ? entity
        : (entity?.id ?? picked?.primitive?.id);
      if (typeof entityId === 'string' && _records.has(entityId)) {
        if (entityId !== _selectedId) _select(entityId);
        return;
      }
      if (_selectedId) _clearSelection();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function _applyCatalog(rows) {
    if (!_dataSource) return;
    _clearSelection();
    _dataSource.entities.removeAll();
    _records = new Map();
    const usedIds = new Set();
    let plotted = 0;
    for (const raw of rows) {
      const record = normalizeVolcano(raw, plotted);
      if (!record) continue;
      // The catalog contains two distinct peaks named "Sumbing" (Java and
      // Sumatra); a slug alone is not a unique entity id.
      if (usedIds.has(record.id)) {
        let suffix = 2;
        while (usedIds.has(`${record.id}-${suffix}`)) suffix += 1;
        record.id = `${record.id}-${suffix}`;
      }
      usedIds.add(record.id);
      const meta = VOLCANO_BAND_META[record.band] || VOLCANO_BAND_META.unknown;
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      const entityId = `volcano:${record.id}`;
      const entity = _dataSource.entities.add({
        id: entityId,
        position,
        point: {
          pixelSize: record.band === 'very-high' ? 11 : 8,
          color: Cesium.Color.fromCssColorString(meta.color),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(5e4, 1.3, 4e6, 0.75),
        },
        label: {
          text: record.name,
          font: '600 12px "Inter", "Segoe UI", sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 450000),
          translucencyByDistance: new Cesium.NearFarScalar(2.5e5, 1, 4.5e5, 0),
        },
      });
      record.position = position;
      record.entity = entity;
      _records.set(entityId, record);
      plotted += 1;
    }
    _count = plotted;
    _lastUpdate = Date.now();
    _lastError = null;
    _loadingLabel = `${plotted} gunung api`;
    console.log(`[Data:Volcanoes] ${plotted} volcanoes plotted from ${rows.length} rows`);
    governorRequestRender('indonesian-volcanoes-load');
  }

  function _scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null;
      if (_enabled) void _startLoad();
    }, REFRESH_MS);
  }

  function _startLoad() {
    if (_loadPromise) return _loadPromise;
    if (!_enabled) return Promise.resolve(false);
    const epoch = ++_loadEpoch;
    const controller = new AbortController();
    _loadAbort = controller;
    _loading = true;
    _loadingLabel = 'memuat katalog gunung api…';
    const timeout = setTimeout(() => controller.abort(), 30000);

    _loadPromise = (async () => {
      try {
        const response = await fetch(API_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (epoch !== _loadEpoch || !_enabled) return false;
        const rows = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(rows)) throw new Error('malformed response');
        _applyCatalog(rows);
        _scheduleRefresh();
        return true;
      } catch (error) {
        if (epoch !== _loadEpoch || controller.signal.aborted) return false;
        _lastError = `Volcano API: ${error?.message || 'unreachable'}`;
        console.warn('[Data:Volcanoes] load failed:', error);
        return false;
      } finally {
        clearTimeout(timeout);
        if (epoch === _loadEpoch) {
          _loading = false;
          _loadPromise = null;
          _loadAbort = null;
        }
      }
    })();
    return _loadPromise;
  }

  const layer = {
    id: VOLCANOES_LAYER_ID,
    name: 'Indonesian Volcanoes',
    icon: '⛰',
    source: 'indonesia-public-static-api',
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(VOLCANOES_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(VOLCANOES_SELECTED_OVERLAY_SOURCE_ID, false);
      _records = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _loading = false;
      _loadingLabel = '';
      _enabled = false;
      console.log('[Data:Volcanoes] Initialized');
    },

    enable(viewer) {
      _viewer = viewer;
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(VOLCANOES_SELECTED_OVERLAY_SOURCE_ID, true);
      _installClickHandler(viewer);
      if (_lastUpdate && Date.now() - _lastUpdate < REFRESH_MS && _count > 0) {
        _scheduleRefresh();
      } else {
        void _startLoad();
      }
    },

    disable() {
      _enabled = false;
      _clearSelection();
      if (_dataSource) _dataSource.show = false;
      overlayHost.setVisible(VOLCANOES_SELECTED_OVERLAY_SOURCE_ID, false);
      if (_refreshTimer) {
        clearTimeout(_refreshTimer);
        _refreshTimer = null;
      }
      _loadEpoch += 1;
      _loadAbort?.abort();
      _loadAbort = null;
      _loadPromise = null;
      _loading = false;
      _loadingLabel = _count > 0 ? `${_count} gunung api` : '';
    },

    async update() {
      if (!_loadPromise && (!_lastUpdate || Date.now() - _lastUpdate >= REFRESH_MS)) {
        void _startLoad();
      }
      return true;
    },

    destroy(viewer) {
      _enabled = false;
      _clearSelection();
      if (_refreshTimer) {
        clearTimeout(_refreshTimer);
        _refreshTimer = null;
      }
      _loadEpoch += 1;
      _loadAbort?.abort();
      _loadAbort = null;
      _loadPromise = null;
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      overlayHost.clearSource(VOLCANOES_SELECTED_OVERLAY_SOURCE_ID);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _records = new Map();
      _viewer = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _loading = false;
      _loadingLabel = '';
    },

    getRowControls() {
      if (!_enabled || _records.size === 0) return { chips: [], legend: [] };
      const tally = new Map();
      for (const record of _records.values()) {
        tally.set(record.band, (tally.get(record.band) || 0) + 1);
      }
      return {
        chips: [],
        legend: BAND_ORDER
          .filter((band) => tally.has(band))
          .map((band) => ({
            label: VOLCANO_BAND_META[band].label,
            color: VOLCANO_BAND_META[band].color,
            count: tally.get(band),
          })),
      };
    },

    /**
     * Snapshot plotted volcanoes as JSON-safe analyst records. On-demand only.
     * @param {number} [maxCount=1000]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 1000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 1000;
      const result = [];
      for (const record of _records.values()) {
        if (result.length >= limit) break;
        result.push(mapVolcanoAnalystRecord(record, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        loading: _loading,
        loadingLabel: _loadingLabel,
        source: layer.source,
      };
    },
  };

  return layer;
}

const volcanoesLayer = createVolcanoesLayer();

export default volcanoesLayer;
