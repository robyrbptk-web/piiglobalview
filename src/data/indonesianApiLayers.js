import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * Point layers backed by API Indonesia (https://apiindonesia.id) through the
 * local `/api/indonesia/*` proxy. The key stays server-side; these layers only
 * know the same-origin route.
 */

const REFRESH_MS = 12 * 3600_000;
const MAX_LABEL_LENGTH = 44;

export const HOSPITALS_LAYER_ID = 'indonesian-hospitals';
export const TRANSJAKARTA_LAYER_ID = 'transjakarta-halte';

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export const HOSPITAL_GROUP_META = Object.freeze({
  umum: { label: 'Rumah Sakit Umum', color: '#f87171' },
  khusus: { label: 'Rumah Sakit Khusus', color: '#fbbf24' },
  lainnya: { label: 'Lainnya', color: '#94a3b8' },
});

export const HALTE_GROUP_META = Object.freeze({
  halte: { label: 'Halte', color: '#34d399' },
  stasiun: { label: 'Stasiun', color: '#38bdf8' },
});

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * Plausibility gate shared by the API Indonesia point layers.
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isPlausibleIndonesianCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return lat >= -11.5 && lat <= 6.5 && lon >= 94.5 && lon <= 141.5;
}

/** Classify a SIRS `jenis` code into the legend groups above. */
export function hospitalGroup(jenis) {
  const value = String(jenis || '').trim().toUpperCase();
  if (value.startsWith('RSU')) return 'umum';
  if (value.startsWith('RS')) return 'khusus';
  return 'lainnya';
}

/** Classify a Transjakarta GTFS `stop_type` (0 stop/platform, 1 station). */
export function halteGroup(stopType) {
  return Number(stopType) === 1 ? 'stasiun' : 'halte';
}

/**
 * Map one `/api/v1/rumah-sakit` row to a render record.
 * @param {object} raw
 * @param {number} [index=0]
 * @returns {object|null}
 */
export function normalizeHospital(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = numberOrNull(raw.lat);
  const lon = numberOrNull(raw.lng);
  if (!isPlausibleIndonesianCoordinate(lat, lon)) return null;
  const name = textOrNull(raw.name);
  if (!name) return null;
  return {
    id: textOrNull(raw.id) || textOrNull(raw.code) || `hospital-${index}`,
    code: textOrNull(raw.code),
    name,
    group: hospitalGroup(raw.jenis),
    jenis: textOrNull(raw.jenis),
    type: textOrNull(raw.hospital_type),
    kelas: textOrNull(raw.kelas),
    ownership: textOrNull(raw.ownership),
    province: textOrNull(raw.province_name),
    regency: textOrNull(raw.regency_name),
    beds: numberOrNull(raw.beds_total),
    lat,
    lon,
  };
}

/**
 * Map one `/api/v1/transjakarta/halte` row to a render record.
 * @param {object} raw
 * @param {number} [index=0]
 * @returns {object|null}
 */
export function normalizeHalte(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = numberOrNull(raw.lat);
  const lon = numberOrNull(raw.lng);
  if (!isPlausibleIndonesianCoordinate(lat, lon)) return null;
  const name = textOrNull(raw.name);
  if (!name) return null;
  return {
    id: textOrNull(raw.id) || `halte-${index}`,
    code: textOrNull(raw.code),
    name,
    group: halteGroup(raw.stop_type),
    stopType: numberOrNull(raw.stop_type),
    lat,
    lon,
  };
}

export function hospitalDetails(record) {
  const details = [];
  const kind = [record.jenis, record.type].filter(Boolean).join(' · ');
  if (kind) details.push(kind);
  if (record.kelas) details.push(`Kelas ${record.kelas}`);
  if (record.beds !== null) details.push(`${record.beds} tempat tidur`);
  const area = [record.regency, record.province].filter(Boolean).join(', ');
  if (area) details.push(area);
  if (record.ownership) details.push(record.ownership);
  if (record.code) details.push(`Kode ${record.code}`);
  return details;
}

export function halteDetails(record) {
  const details = ['Transjakarta'];
  if (record.code) details.push(`Kode ${record.code}`);
  if (record.group === 'stasiun') details.push('Stasiun integrasi');
  return details;
}

function truncateLabel(text) {
  const value = String(text || '').trim();
  return value.length > MAX_LABEL_LENGTH ? `${value.slice(0, MAX_LABEL_LENGTH - 1)}…` : value;
}

function createPointLayer({
  id,
  name,
  icon,
  source,
  apiPath,
  groups,
  normalize,
  selectedDetails,
  loadingLabel,
  labelRangeM,
  labelFadeM,
  pointSize = 8,
}) {
  const selectedSourceId = `${id}-selected`;
  const selectedSourceOptions = Object.freeze({
    cohortLimit: 1,
    collisionCapacity: 0,
    moving: false,
  });

  let _dataSource = null;
  let _viewer = null;
  let _enabled = false;
  let _records = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _skipped = 0;
  let _loading = false;
  let _loadingLabel = '';
  let _loadPromise = null;
  let _loadAbort = null;
  let _loadEpoch = 0;
  let _refreshTimer = null;
  let _selectedId = null;
  let _selectedEntity = null;
  let _clickHandler = null;
  const overlayHost = DEFAULT_OVERLAY_HOST;

  function _clearSelection() {
    const record = _selectedId ? _records.get(_selectedId) : null;
    if (record?.entity) record.entity.show = true;
    if (_selectedEntity && _viewer) _viewer.entities.remove(_selectedEntity);
    _selectedId = null;
    _selectedEntity = null;
    overlayHost.clearSource(selectedSourceId);
  }

  function _select(recordId) {
    _clearSelection();
    const record = _records.get(recordId);
    if (!record?.position || !_viewer) return;
    _selectedId = recordId;
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
    const meta = groups[record.group] || groups.lainnya || Object.values(groups)[0];
    overlayHost.setEntries(selectedSourceId, [{
      id: String(record.id),
      position: record.position,
      variant: 'selected',
      selected: true,
      protected: true,
      paintLane: 'selected',
      collisionGroup: 'ambient-card',
      priority: Number.MAX_SAFE_INTEGER,
      title: record.name,
      details: selectedDetails(record),
      accent: meta.color,
      interactive: false,
      anchorRadiusPx: 9,
      minAnchorGapPx: 11,
      verticalOnly: true,
      placement: 'above',
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
    }], selectedSourceOptions);
    governorRequestRender(`${id}-select`);
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

  function _applyPayload(payload) {
    if (!_dataSource) return;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    _clearSelection();
    _dataSource.entities.removeAll();
    _records = new Map();
    _skipped = 0;
    let plotted = 0;

    for (const raw of rows) {
      const record = normalize(raw, plotted);
      if (!record) {
        _skipped += 1;
        continue;
      }
      const meta = groups[record.group] || groups.lainnya || Object.values(groups)[0];
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      const entityId = `${id}:${record.id}`;
      const entity = _dataSource.entities.add({
        id: entityId,
        position,
        point: {
          pixelSize: pointSize,
          color: Cesium.Color.fromCssColorString(meta.color),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 2.5e6, 0.7),
        },
        label: {
          text: truncateLabel(record.name),
          font: '600 12px "Inter", "Segoe UI", sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelRangeM),
          translucencyByDistance: new Cesium.NearFarScalar(labelFadeM, 1, labelRangeM, 0),
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
    console.log(`[Data:${id}] ${plotted} plotted from ${rows.length} rows (${_skipped} skipped)`);
    governorRequestRender(`${id}-load`);
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
    const epoch = ++_loadEpoch;
    const controller = new AbortController();
    _loadAbort = controller;
    _loading = true;
    _loadingLabel = loadingLabel;
    const timeout = setTimeout(() => controller.abort(), 60000);

    _loadPromise = (async () => {
      try {
        const response = await fetch(apiPath, { signal: controller.signal });
        if (!response.ok) {
          // The proxy says WHY in its JSON body (missing key, upstream refusal);
          // a bare HTTP 503 tells the operator nothing.
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (epoch !== _loadEpoch || !_enabled) return false;
        if (payload?.success === false) throw new Error(payload.error || 'upstream error');
        if (!Array.isArray(payload?.data)) throw new Error('malformed response');
        _applyPayload(payload);
        _scheduleRefresh();
        return true;
      } catch (error) {
        if (epoch !== _loadEpoch || controller.signal.aborted) return false;
        _lastError = `API Indonesia: ${error?.message || 'tidak dapat dijangkau'}`;
        console.warn(`[Data:${id}] load failed:`, error);
        return false;
      } finally {
        clearTimeout(timeout);
        if (epoch === _loadEpoch) {
          _loading = false;
          _loadingLabel = '';
          _loadPromise = null;
          _loadAbort = null;
        }
      }
    })();
    return _loadPromise;
  }

  return {
    id,
    name,
    icon,
    source,
    apiPath,
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(selectedSourceId, false);
      _records = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _skipped = 0;
      _loading = false;
      _loadingLabel = '';
      _enabled = false;
      console.log(`[Data:${id}] Initialized`);
    },

    enable(viewer) {
      _viewer = viewer;
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(selectedSourceId, true);
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
      overlayHost.setVisible(selectedSourceId, false);
      if (_dataSource) _dataSource.show = false;
      if (_refreshTimer) {
        clearTimeout(_refreshTimer);
        _refreshTimer = null;
      }
      _loadEpoch += 1;
      _loadAbort?.abort();
      _loadAbort = null;
      _loadPromise = null;
      _loading = false;
      _loadingLabel = '';
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
      overlayHost.clearSource(selectedSourceId);
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
        tally.set(record.group, (tally.get(record.group) || 0) + 1);
      }
      const legend = Object.entries(groups)
        .filter(([group]) => tally.has(group))
        .map(([group, meta]) => ({
          label: meta.label,
          color: meta.color,
          count: tally.get(group),
        }));
      return { chips: [], legend };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const result = [];
      for (const record of _records.values()) {
        if (result.length >= limit) break;
        result.push({
          id: record.id,
          name: record.name,
          group: record.group,
          province: record.province || null,
          regency: record.regency || null,
          lat: numberOrNull(record.lat),
          lon: numberOrNull(record.lon),
        });
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
        source,
      };
    },
  };
}

export const hospitalsLayer = createPointLayer({
  id: HOSPITALS_LAYER_ID,
  name: 'Indonesian Hospitals',
  icon: '🏥',
  source: 'use.apiindonesia.id',
  apiPath: '/api/indonesia/hospitals',
  groups: HOSPITAL_GROUP_META,
  normalize: normalizeHospital,
  selectedDetails: hospitalDetails,
  loadingLabel: 'memuat rumah sakit nasional…',
  labelRangeM: 220000,
  labelFadeM: 120000,
  pointSize: 8,
});

export const transjakartaLayer = createPointLayer({
  id: TRANSJAKARTA_LAYER_ID,
  name: 'Transjakarta Halte',
  icon: '🚌',
  source: 'use.apiindonesia.id',
  apiPath: '/api/indonesia/transjakarta',
  groups: HALTE_GROUP_META,
  normalize: normalizeHalte,
  selectedDetails: halteDetails,
  loadingLabel: 'memuat halte Transjakarta…',
  labelRangeM: 120000,
  labelFadeM: 60000,
  pointSize: 7,
});

export const indonesianApiLayers = Object.freeze([hospitalsLayer, transjakartaLayer]);

export default indonesianApiLayers;
