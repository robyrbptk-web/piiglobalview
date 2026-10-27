// src/data/indonesianApiLayers.test.mjs
// Pure-helper tests for the API Indonesia point layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOSPITALS_LAYER_ID,
  TRANSJAKARTA_LAYER_ID,
  halteDetails,
  halteGroup,
  hospitalDetails,
  hospitalGroup,
  indonesianApiLayers,
  isPlausibleIndonesianCoordinate,
  normalizeHalte,
  normalizeHospital,
} from './indonesianApiLayers.js';

const HOSPITAL_RAW = {
  id: 'rs-0001',
  code: 'RSU12345',
  name: 'RS UMUM PUSAT MEDIKA',
  jenis: 'RSU',
  hospital_type: 'Rumah Sakit Umum',
  kelas: 'B',
  ownership: 'PEMERTINTAH PROVINSI',
  province_id: 31,
  regency_id: 3101,
  lat: -6.2088,
  lng: 106.8456,
  beds_total: 340,
  province_name: 'DKI JAKARTA',
  regency_name: 'JAKARTA PUSAT',
};

const HALTE_RAW = {
  id: 'halte-058',
  code: 'H058',
  name: 'Halteran Sarinae',
  lat: -6.1749,
  lng: 106.8413,
  stop_type: 1,
};

test('the coordinate gate keeps only plausible Indonesian positions', () => {
  assert.equal(isPlausibleIndonesianCoordinate(-6.2, 106.8), true);
  assert.equal(isPlausibleIndonesianCoordinate(5.5, 95.0), true);
  assert.equal(isPlausibleIndonesianCoordinate(-11.6, 106.8), false, 'south of Timor');
  assert.equal(isPlausibleIndonesianCoordinate(7.0, 106.8), false, 'north of Sabang latitude band');
  assert.equal(isPlausibleIndonesianCoordinate(-6.2, 94.0), false, 'west of Sumatra');
  assert.equal(isPlausibleIndonesianCoordinate(-6.2, 142.0), false, 'east of Papua');
  assert.equal(isPlausibleIndonesianCoordinate(0, 0), false, 'null-island rows never plot');
  assert.equal(isPlausibleIndonesianCoordinate(NaN, 106.8), false);
  assert.equal(isPlausibleIndonesianCoordinate(undefined, undefined), false);
});

test('hospital jenis codes map onto the legend groups', () => {
  assert.equal(hospitalGroup('RSU'), 'umum');
  assert.equal(hospitalGroup('rsud'), 'umum');
  assert.equal(hospitalGroup('RS JIWA'), 'khusus');
  assert.equal(hospitalGroup(''), 'lainnya');
  assert.equal(hospitalGroup(null), 'lainnya');
});

test('normalizeHospital trims a registry row into a render record', () => {
  const record = normalizeHospital(HOSPITAL_RAW, 0);
  assert.equal(record.id, 'rs-0001');
  assert.equal(record.name, 'RS UMUM PUSAT MEDIKA');
  assert.equal(record.group, 'umum');
  assert.equal(record.kelas, 'B');
  assert.equal(record.beds, 340);
  assert.equal(record.province, 'DKI JAKARTA');
  assert.equal(record.lon, 106.8456);
  assert.equal(
    normalizeHospital({ ...HOSPITAL_RAW, lat: null, lng: null }),
    null,
    'a row without a position is skipped, not plotted at zero',
  );
  assert.equal(normalizeHospital({ ...HOSPITAL_RAW, name: '  ' }), null);
  assert.equal(normalizeHospital(null), null);
});

test('halte stop_type separates platforms from integration stations', () => {
  assert.equal(halteGroup(1), 'stasiun');
  assert.equal(halteGroup(0), 'halte');
  assert.equal(halteGroup('1'), 'stasiun');
  assert.equal(halteGroup(undefined), 'halte');
  const record = normalizeHalte(HALTE_RAW, 4);
  assert.equal(record.group, 'stasiun');
  assert.equal(record.code, 'H058');
  assert.equal(record.lat, -6.1749);
  assert.equal(normalizeHalte({ ...HALTE_RAW, lat: 40.7, lng: -74.0 }), null);
});

test('selected cards read in Indonesian and drop unknown fields', () => {
  const hospital = normalizeHospital(HOSPITAL_RAW, 0);
  const lines = hospitalDetails(hospital);
  assert.ok(lines.some((line) => line.includes('RSU · Rumah Sakit Umum')));
  assert.ok(lines.some((line) => line === 'Kelas B'));
  assert.ok(lines.some((line) => line === '340 tempat tidur'));
  assert.ok(lines.some((line) => line === 'JAKARTA PUSAT, DKI JAKARTA'));
  assert.ok(lines.some((line) => line === 'Kode RSU12345'));

  const sparse = hospitalDetails({ id: 'x', name: 'RS Tanpa Data', beds: null });
  assert.deepEqual(sparse, []);

  assert.deepEqual(halteDetails({ code: 'H058', group: 'stasiun' }), [
    'Transjakarta',
    'Kode H058',
    'Stasiun integrasi',
  ]);
});

test('both layers read through the same-origin proxy, never the upstream host', () => {
  assert.equal(HOSPITALS_LAYER_ID, 'indonesian-hospitals');
  assert.equal(TRANSJAKARTA_LAYER_ID, 'transjakarta-halte');
  assert.equal(indonesianApiLayers.length, 2);
  for (const layer of indonesianApiLayers) {
    assert.match(layer.id, /^[a-z0-9-]+$/);
    assert.equal(typeof layer.init, 'function');
    assert.equal(typeof layer.enable, 'function');
    assert.equal(typeof layer.getStats, 'function');
    assert.equal(layer.updateInterval, 0, 'bulk registries refresh on their own timer');
    assert.match(
      layer.apiPath,
      /^\/api\/indonesia\/[a-z-]+$/,
      'keyed data must be reached through the local proxy, never the upstream host',
    );
  }
});
