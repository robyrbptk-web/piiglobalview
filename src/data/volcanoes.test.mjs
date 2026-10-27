// src/data/volcanoes.test.mjs
// Pure-helper tests for the Indonesian volcano catalog layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  VOLCANOES_LAYER_ID,
  createVolcanoSelectedOverlayEntry,
  mapVolcanoAnalystRecord,
  normalizeVolcano,
  parseGeolokasi,
  parseHeightMeters,
  volcanoHeightBand,
} from './volcanoes.js';

test('geolokasi parser handles all four hemispheres', () => {
  assert.deepEqual(parseGeolokasi('5.82°N 95.28°E'), { lat: 5.82, lon: 95.28 });
  assert.deepEqual(parseGeolokasi('7.53°S 123.95°E'), { lat: -7.53, lon: 123.95 });
  assert.deepEqual(parseGeolokasi('1.2°N 100.4°W'), { lat: 1.2, lon: -100.4 });
  assert.deepEqual(parseGeolokasi('0°S 0°E'), { lat: -0, lon: 0 });
  assert.equal(parseGeolokasi('-'), null);
  assert.equal(parseGeolokasi(''), null);
  assert.equal(parseGeolokasi(undefined), null);
});

test('height parser handles meters, Unicode minus, and N/A', () => {
  assert.equal(parseHeightMeters('617 meter'), 617);
  assert.equal(parseHeightMeters('1810 meter'), 1810);
  assert.equal(parseHeightMeters('−3800 meter'), -3800);
  assert.equal(parseHeightMeters('N/A'), null);
  assert.equal(parseHeightMeters(2460), 2460);
  assert.equal(parseHeightMeters(null), null);
});

test('height bands split submarine, low, mid, high, and very-high peaks', () => {
  assert.equal(volcanoHeightBand(-5), 'submarine');
  assert.equal(volcanoHeightBand(0), 'low');
  assert.equal(volcanoHeightBand(999), 'low');
  assert.equal(volcanoHeightBand(1000), 'mid');
  assert.equal(volcanoHeightBand(1999), 'mid');
  assert.equal(volcanoHeightBand(2000), 'high');
  assert.equal(volcanoHeightBand(2999), 'high');
  assert.equal(volcanoHeightBand(3000), 'very-high');
  assert.equal(volcanoHeightBand(null), 'unknown');
});

test('normalizeVolcano maps a land peak and a submarine peak', () => {
  const sinabung = normalizeVolcano({
    nama: 'Sinabung',
    bentuk: 'stratovulkan',
    tinggi_meter: '2460 meter',
    estimasi_letusan_terakhir: '2 Maret 2021',
    geolokasi: '3.17°N 98.392°E',
  });
  assert.equal(sinabung.id, 'sinabung');
  assert.equal(sinabung.name, 'Sinabung');
  assert.equal(sinabung.heightMeters, 2460);
  assert.equal(sinabung.band, 'high');
  assert.equal(sinabung.lastEruption, '2 Maret 2021');

  const yersey = normalizeVolcano({
    nama: 'Yersey',
    bentuk: 'bawah laut',
    tinggi_meter: '−3800 meter',
    estimasi_letusan_terakhir: 'N/A',
    geolokasi: '7.53°S 123.95°E',
  });
  assert.equal(yersey.band, 'submarine');
  assert.equal(yersey.lastEruption, null);
});

test('normalizeVolcano skips the one record without coordinates', () => {
  assert.equal(normalizeVolcano({
    nama: 'Merbuk',
    bentuk: 'N/A',
    tinggi_meter: '1386 meter',
    estimasi_letusan_terakhir: 'N/A',
    geolokasi: '-',
  }), null);
  assert.equal(normalizeVolcano(null), null);
});

test('volcano analyst record is JSON-safe and never NaN/undefined', () => {
  const record = normalizeVolcano({
    nama: 'Gunung Toba',
    bentuk: 'supervulkan',
    tinggi_meter: '2157 meter',
    estimasi_letusan_terakhir: '72000 SM',
    geolokasi: '2.58°N 98.83°E',
  }, 0);
  const analyst = mapVolcanoAnalystRecord(record, 0);
  assert.equal(analyst.name, 'Gunung Toba');
  assert.equal(analyst.heightMeters, 2157);
  assert.equal(analyst.lastEruption, '72000 SM');
  assert.deepEqual(JSON.parse(JSON.stringify(analyst)), analyst);
  for (const [key, value] of Object.entries(analyst)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
  const empty = mapVolcanoAnalystRecord(null, 4);
  assert.equal(empty.id, 'VOLCANO-004');
  assert.equal(empty.name, 'Volcano');
  assert.equal(empty.heightMeters, null);
});

test('selected overlay entry renders height and last eruption', () => {
  const record = normalizeVolcano({
    nama: 'Sinabung',
    bentuk: 'stratovulkan',
    tinggi_meter: '2460 meter',
    estimasi_letusan_terakhir: '2021',
    geolokasi: '3.17°N 98.392°E',
  });
  record.position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
  const entry = createVolcanoSelectedOverlayEntry(record);
  assert.equal(entry.title, 'Gunung Sinabung');
  assert.equal(entry.accent, '#fb923c');
  assert.equal(entry.protected, true);
  assert.ok(entry.details.some((line) => line.includes('2.460 m')));
  assert.ok(entry.details.some((line) => line.includes('2021')));
  assert.equal(createVolcanoSelectedOverlayEntry({ ...record, position: null }), null);
  assert.equal(VOLCANOES_LAYER_ID, 'indonesian-volcanoes');
});
