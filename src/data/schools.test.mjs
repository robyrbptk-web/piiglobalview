// src/data/schools.test.mjs
// Pure-helper tests for the Indonesian schools layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SCHOOLS_LAYER_ID,
  createSchoolSelectedOverlayEntry,
  isPlausibleIndonesianCoordinate,
  mapSchoolAnalystRecord,
  normalizeSchool,
  schoolGroup,
} from './schools.js';

const RAW = {
  npsn: '10102621',
  nama: 'SD NEGERI UJUNG MANGKI',
  bentukPendidikan: 'SD',
  jenjangPendidikan: 'PENDIDIKAN DASAR',
  statusSatuanPendidikan: 'NEGERI',
  akreditasi: 'A',
  alamat: {
    jalan: 'JL. PENDIDIKAN',
    nama_desa: 'UJUNG MANGKI',
    nama_kecamatan: 'BAKONGAN',
    nama_kabupaten: 'KAB. ACEH SELATAN',
    nama_provinsi: 'ACEH',
  },
  kontak: { nomor_telepon: '08123456789', email: 'sd@example.sch.id', website: '' },
  lokasi: { koordinat: [3.1, 97.2], lintang: 3.1, bujur: 97.2 },
};

test('school group buckets every jenjang the upstream publishes', () => {
  assert.equal(schoolGroup('SD'), 'dasar');
  assert.equal(schoolGroup('MI'), 'dasar');
  assert.equal(schoolGroup('SMP'), 'menengah-pertama');
  assert.equal(schoolGroup('MTs'), 'menengah-pertama');
  assert.equal(schoolGroup('SMA'), 'menengah-atas');
  assert.equal(schoolGroup('MA'), 'menengah-atas');
  assert.equal(schoolGroup('SMK'), 'kejuruan');
  assert.equal(schoolGroup('TK'), 'paud');
  assert.equal(schoolGroup('SLB'), 'luar-biasa');
  assert.equal(schoolGroup('PKBM'), 'lainnya');
  assert.equal(schoolGroup(undefined), 'lainnya');
});

test('coordinate gate rejects 0,0 and out-of-Indonesia points', () => {
  assert.equal(isPlausibleIndonesianCoordinate(3.1, 97.2), true);
  assert.equal(isPlausibleIndonesianCoordinate(-8.65, 115.21), true);
  assert.equal(isPlausibleIndonesianCoordinate(0, 0), false);
  assert.equal(isPlausibleIndonesianCoordinate(51.5, -0.12), false);
  assert.equal(isPlausibleIndonesianCoordinate(NaN, 97.2), false);
  assert.equal(isPlausibleIndonesianCoordinate(3.1, 200), false);
});

test('normalizeSchool maps a full record into render/analyst fields', () => {
  const record = normalizeSchool(RAW, 0);
  assert.equal(record.id, '10102621');
  assert.equal(record.name, 'SD NEGERI UJUNG MANGKI');
  assert.equal(record.bentuk, 'SD');
  assert.equal(record.group, 'dasar');
  assert.equal(record.status, 'NEGERI');
  assert.equal(record.akreditasi, 'A');
  assert.equal(record.province, 'ACEH');
  assert.equal(record.lat, 3.1);
  assert.equal(record.lon, 97.2);
  assert.equal(record.address, 'JL. PENDIDIKAN, UJUNG MANGKI, BAKONGAN, KAB. ACEH SELATAN, ACEH');
  assert.equal(record.phone, '08123456789');
  assert.equal(record.email, 'sd@example.sch.id');
  assert.equal(record.website, null);
});

test('normalizeSchool drops records without a usable coordinate or name', () => {
  assert.equal(normalizeSchool({ ...RAW, lokasi: { lintang: 0, bujur: 0 } }), null);
  assert.equal(normalizeSchool({ ...RAW, lokasi: null }), null);
  assert.equal(normalizeSchool({ ...RAW, nama: '  ' }), null);
  assert.equal(normalizeSchool(null), null);
});

test('normalizeSchool falls back to an index id and the koordinat pair', () => {
  const record = normalizeSchool({
    ...RAW,
    npsn: '',
    lokasi: { koordinat: [-6.2, 106.8] },
  }, 7);
  assert.equal(record.id, 'school-0007');
  assert.equal(record.lat, -6.2);
  assert.equal(record.lon, 106.8);
});

test('school analyst record is JSON-safe and never NaN/undefined', () => {
  const record = normalizeSchool(RAW, 0);
  const analyst = mapSchoolAnalystRecord(record, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(analyst)), analyst);
  for (const [key, value] of Object.entries(analyst)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
  const empty = mapSchoolAnalystRecord(null, 2);
  assert.equal(empty.id, 'SCHOOL-0002');
  assert.equal(empty.name, 'Sekolah tanpa nama');
  assert.equal(empty.lat, null);
  assert.equal(empty.lon, null);
});

test('selected overlay entry carries the school card copy and accent', () => {
  const record = normalizeSchool(RAW, 0);
  record.position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
  const entry = createSchoolSelectedOverlayEntry(record);
  assert.equal(entry.title, 'SD NEGERI UJUNG MANGKI');
  assert.equal(entry.accent, '#34d399');
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.protected, true);
  assert.ok(entry.details.some((line) => line.includes('Akreditasi A')));
  assert.ok(entry.details.some((line) => line.includes('NPSN 10102621')));
  assert.equal(createSchoolSelectedOverlayEntry({ ...record, position: null }), null);
  assert.equal(SCHOOLS_LAYER_ID, 'indonesian-schools');
});
