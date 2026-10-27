import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * Indonesian school directory, sampled nationally from api-sekolah
 * (https://github.com/ikhsan-rfl/api-sekolah) through the local
 * `/api/sekolah` proxy.
 *
 * Why a sample: the upstream API ignores `page` and hard-caps any
 * `kode_wilayah` query at 10 rows, while a global query reaches only 3–6
 * provinces. The proxy runs one 10-row query per province (38 provinces),
 * so this layer shows ~300 plotted schools spread across the archipelago —
 * honest national coverage, not the full ~500k-row registry.
 *
 * Coordinates are only plotted when the record carries a plausible
 * Indonesian lat/lon; roughly one in five records reports 0,0 and is dropped
 * rather than stacked on Null Island.
 */

const API_URL = '/api/sekolah';
const REFRESH_MS = 24 * 3600_000;
const MAX_LABEL_LENGTH = 44;

export const SCHOOLS_LAYER_ID = 'indonesian-schools';
export const SCHOOLS_SELECTED_OVERLAY_SOURCE_ID = 'indonesian-schools-selected';
export const SCHOOLS_SELECTED_OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 0,
  moving: false,
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Jenjang groupings + legend copy + hex accents. */
export const SCHOOL_GROUP_META = Object.freeze({
  dasar: { label: 'SD/MI', color: '#34d399' },
  'menengah-pertama': { label: 'SMP/MTs', color: '#38bdf8' },
  'menengah-atas': { label: 'SMA/MA', color: '#fbbf24' },
  kejuruan: { label: 'SMK', color: '#c084fc' },
  paud: { label: 'TK', color: '#f472b6' },
  'luar-biasa': { label: 'SLB', color: '#22d3ee' },
  lainnya: { label: 'Lainnya', color: '#94a3b8' },
});

const GROUP_ORDER = Object.freeze(Object.keys(SCHOOL_GROUP_META));

/**
 * Classify a `bentukPendidikan` value into a stable display group.
 * @param {string} bentuk Raw upstream jenjang label (SD, MI, SMK, …).
 * @returns {keyof SCHOOL_GROUP_META}
 */
export function schoolGroup(bentuk) {
  const value = String(bentuk || '').trim().toUpperCase();
  if (value === 'SD' || value === 'MI') return 'dasar';
  if (value === 'SMP' || value === 'MTS') return 'menengah-pertama';
  if (value === 'SMA' || value === 'MA') return 'menengah-atas';
  if (value === 'SMK') return 'kejuruan';
  if (value === 'TK') return 'paud';
  if (value === 'SLB') return 'luar-biasa';
  return 'lainnya';
}

/**
 * Plausibility gate for school coordinates. The upstream returns 0,0 for
 * records without a geocode, and a handful of overseas/typo coordinates.
 * @param {number} lat Latitude in degrees.
 * @param {number} lon Longitude in degrees.
 * @returns {boolean}
 */
export function isPlausibleIndonesianCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return lat >= -11.5 && lat <= 6.5 && lon >= 94.5 && lon <= 141.5;
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * Map one raw api-sekolah record to the plain render/analyst record used by
 * this layer. Pure — no Cesium types. Returns null when the record has no
 * usable coordinate.
 * @param {object} raw Raw `data[]` entry from the proxy response.
 * @param {number} [index=0] Fallback id suffix.
 * @returns {object|null}
 */
export function normalizeSchool(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const lokasi = raw.lokasi || {};
  const alamat = raw.alamat || {};
  const kontak = raw.kontak || {};
  const coord = Array.isArray(lokasi.koordinat) ? lokasi.koordinat : [];
  const lat = numberOrNull(lokasi.lintang ?? coord[0]);
  const lon = numberOrNull(lokasi.bujur ?? coord[1]);
  if (!isPlausibleIndonesianCoordinate(lat, lon)) return null;

  const npsn = textOrNull(raw.npsn);
  const name = textOrNull(raw.nama);
  if (!name) return null;

  const bentuk = textOrNull(raw.bentukPendidikan);
  const group = schoolGroup(bentuk);
  const address = [
    textOrNull(alamat.jalan),
    textOrNull(alamat.nama_desa),
    textOrNull(alamat.nama_kecamatan),
    textOrNull(alamat.nama_kabupaten),
    textOrNull(alamat.nama_provinsi),
  ].filter(Boolean).join(', ');

  return {
    id: npsn || `school-${String(index).padStart(4, '0')}`,
    npsn,
    name,
    bentuk,
    group,
    jenjang: textOrNull(raw.jenjangPendidikan),
    status: textOrNull(raw.statusSatuanPendidikan),
    akreditasi: textOrNull(raw.akreditasi),
    province: textOrNull(alamat.nama_provinsi),
    regency: textOrNull(alamat.nama_kabupaten),
    address: address || null,
    phone: textOrNull(kontak.nomor_telepon),
    email: textOrNull(kontak.email),
    website: textOrNull(kontak.website),
    lat,
    lon,
  };
}

/**
 * JSON-safe analyst record (analyst query engine seam). Never NaN/undefined.
 * @param {object|null} record Render record from normalizeSchool.
 * @param {number} [index=0]
 * @returns {object}
 */
export function mapSchoolAnalystRecord(record, index = 0) {
  const safe = record || {};
  return {
    id: textOrNull(safe.id) || `SCHOOL-${String(index).padStart(4, '0')}`,
    name: textOrNull(safe.name) || 'Sekolah tanpa nama',
    npsn: textOrNull(safe.npsn),
    bentuk: textOrNull(safe.bentuk),
    group: textOrNull(safe.group) || 'lainnya',
    status: textOrNull(safe.status),
    akreditasi: textOrNull(safe.akreditasi),
    province: textOrNull(safe.province),
    regency: textOrNull(safe.regency),
    lat: numberOrNull(safe.lat),
    lon: numberOrNull(safe.lon),
  };
}

/**
 * Build the protected selected-school card entry.
 * @param {object} record Render record with a Cesium `position`.
 * @returns {object|null}
 */
export function createSchoolSelectedOverlayEntry(record) {
  if (!record?.position) return null;
  const meta = SCHOOL_GROUP_META[record.group] || SCHOOL_GROUP_META.lainnya;
  const details = [
    `${record.bentuk || 'Sekolah'} · ${record.status || 'Status tidak tercatat'} · Akreditasi ${record.akreditasi || '—'}`,
  ];
  if (record.address) details.push(record.address);
  if (record.phone) details.push(`☎ ${record.phone}`);
  if (record.email) details.push(`✉ ${record.email}`);
  if (record.website) details.push(`🌐 ${record.website}`);
  if (record.npsn) details.push(`NPSN ${record.npsn}`);
  return {
    id: String(record.id),
    position: record.position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: record.name,
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

function truncateLabel(text) {
  const value = String(text || '').trim();
  return value.length > MAX_LABEL_LENGTH ? `${value.slice(0, MAX_LABEL_LENGTH - 1)}…` : value;
}

export function createSchoolsLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _viewer = null;
  let _enabled = false;
  let _records = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _skipped = 0;
  let _sampleLabel = '';
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
    overlayHost.clearSource(SCHOOLS_SELECTED_OVERLAY_SOURCE_ID);
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
    const entry = createSchoolSelectedOverlayEntry(record);
    if (entry) {
      overlayHost.setEntries(
        SCHOOLS_SELECTED_OVERLAY_SOURCE_ID,
        [entry],
        SCHOOLS_SELECTED_OVERLAY_SOURCE_OPTIONS,
      );
    }
    governorRequestRender('indonesian-schools-select');
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

  function _applySample(payload) {
    if (!_dataSource) return;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    _clearSelection();
    _dataSource.entities.removeAll();
    _records = new Map();
    _skipped = 0;
    let plotted = 0;

    for (const raw of rows) {
      const record = normalizeSchool(raw, plotted);
      if (!record) {
        _skipped += 1;
        continue;
      }
      const meta = SCHOOL_GROUP_META[record.group] || SCHOOL_GROUP_META.lainnya;
      const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
      const entityId = `school:${record.id}`;
      const entity = _dataSource.entities.add({
        id: entityId,
        position,
        point: {
          pixelSize: record.akreditasi === 'A' ? 9 : 7,
          color: Cesium.Color.fromCssColorString(meta.color),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(5e4, 1.25, 2.5e6, 0.7),
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
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 220000),
          translucencyByDistance: new Cesium.NearFarScalar(1.2e5, 1, 2.2e5, 0),
        },
      });
      record.position = position;
      record.entity = entity;
      _records.set(entityId, record);
      plotted += 1;
    }

    const meta = payload?.meta;
    const failed = Array.isArray(meta?.provincesFailed) ? meta.provincesFailed.length : 0;
    const provinces = Number.isFinite(meta?.provincesQueried) ? meta.provincesQueried - failed : 0;
    _sampleLabel = provinces > 0 ? `sampel ${provinces} provinsi` : '';
    _count = plotted;
    _lastUpdate = Date.now();
    _lastError = null;
    console.log(
      `[Data:Schools] ${plotted} schools plotted from ${rows.length} rows`
      + ` (${_skipped} without a usable coordinate)`,
    );
    governorRequestRender('indonesian-schools-load');
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
    _loadingLabel = 'memuat sampel sekolah nasional…';
    const timeout = setTimeout(() => controller.abort(), 180000);

    _loadPromise = (async () => {
      try {
        const response = await fetch(API_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (epoch !== _loadEpoch || !_enabled) return false;
        if (payload?.success === false) throw new Error(payload.error || 'upstream error');
        if (!Array.isArray(payload?.data)) throw new Error('malformed response');
        _applySample(payload);
        _scheduleRefresh();
        return true;
      } catch (error) {
        if (epoch !== _loadEpoch || controller.signal.aborted) return false;
        _lastError = `Sekolah API: ${error?.message || 'unreachable'}`;
        console.warn('[Data:Schools] load failed:', error);
        return false;
      } finally {
        clearTimeout(timeout);
        if (epoch === _loadEpoch) {
          _loading = false;
          _loadingLabel = _sampleLabel;
          _loadPromise = null;
          _loadAbort = null;
        }
      }
    })();
    return _loadPromise;
  }

  const layer = {
    id: SCHOOLS_LAYER_ID,
    name: 'Indonesian Schools',
    icon: '🏫',
    source: 'sekolah.devapi.id',
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(SCHOOLS_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost.setVisible(SCHOOLS_SELECTED_OVERLAY_SOURCE_ID, false);
      _records = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _skipped = 0;
      _sampleLabel = '';
      _loading = false;
      _loadingLabel = '';
      _enabled = false;
      console.log('[Data:Schools] Initialized');
    },

    enable(viewer) {
      _viewer = viewer;
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SCHOOLS_SELECTED_OVERLAY_SOURCE_ID, true);
      _installClickHandler(viewer);
      // Data loads in the background: DataLayerManager awaits update() before
      // it settles the toggle, so a 38-province fan-out must never block it.
      if (_lastUpdate && Date.now() - _lastUpdate < REFRESH_MS && _count > 0) {
        _scheduleRefresh();
      } else {
        void _startLoad();
      }
    },

    disable() {
      _enabled = false;
      _clearSelection();
      overlayHost.setVisible(SCHOOLS_SELECTED_OVERLAY_SOURCE_ID, false);
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
      _loadingLabel = _sampleLabel;
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
      overlayHost.clearSource(SCHOOLS_SELECTED_OVERLAY_SOURCE_ID);
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
      _sampleLabel = '';
    },

    getRowControls() {
      if (!_enabled || _records.size === 0) return { chips: [], legend: [] };
      const tally = new Map();
      for (const record of _records.values()) {
        tally.set(record.group, (tally.get(record.group) || 0) + 1);
      }
      const legend = GROUP_ORDER
        .filter((group) => tally.has(group))
        .map((group) => ({
          label: SCHOOL_GROUP_META[group].label,
          color: SCHOOL_GROUP_META[group].color,
          count: tally.get(group),
        }));
      return { chips: [], legend };
    },

    /**
     * Snapshot plotted schools as JSON-safe analyst records. On-demand only.
     * @param {number} [maxCount=2000]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const result = [];
      for (const record of _records.values()) {
        if (result.length >= limit) break;
        result.push(mapSchoolAnalystRecord(record, result.length));
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

const schoolsLayer = createSchoolsLayer();

export default schoolsLayer;
