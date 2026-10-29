// src/data/pbPiiOffice.test.mjs
// The secretariat landmark: coordinates, overlay card contract, and camera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  OFFICE_CAMERA,
  OFFICE_OVERLAY_SOURCE_ID,
  PB_PII_OFFICE,
  createOfficeOverlayEntry,
  flyToOffice,
  officeDetails,
  openOfficeInMaps,
} from './pbPiiOffice.js';

function cartographicOf(destination) {
  const carto = Cesium.Cartographic.fromCartesian(destination);
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    height: carto.height,
  };
}

test('the office sits at the supplied Jakarta coordinates', () => {
  assert.equal(PB_PII_OFFICE.lat, -6.1844917);
  assert.equal(PB_PII_OFFICE.lon, 106.8344897);
  assert.match(PB_PII_OFFICE.mapsUrl, /query=-6\.1844917,106\.8344897/);
  assert.deepEqual(officeDetails(), [
    'Jl. Menteng Raya No. 58',
    'Kebon Sirih, Menteng, Jakarta Pusat',
    'DKI Jakarta',
  ]);
});

test('the office card is a pinned, interactive map link', () => {
  const opened = [];
  const entry = createOfficeOverlayEntry({
    openMaps: (office) => {
      opened.push(office);
      return true;
    },
  });
  assert.equal(entry.variant, 'card');
  assert.equal(entry.interactive, true);
  assert.equal(entry.pinned, true);
  assert.equal(entry.title, PB_PII_OFFICE.name);
  assert.ok(entry.details.includes('Jl. Menteng Raya No. 58'));
  assert.match(entry.accessibilityLabel, /Sekretariat PB PII/);
  assert.equal(entry.activate(), true);
  assert.deepEqual(opened, [PB_PII_OFFICE]);
  assert.ok(entry.position instanceof Cesium.Cartesian3);
  const anchor = cartographicOf(entry.position);
  assert.ok(Math.abs(anchor.lat - PB_PII_OFFICE.lat) < 1e-6);
  assert.ok(Math.abs(anchor.lon - PB_PII_OFFICE.lon) < 1e-6);
});

test('opening the maps pin targets a blank tab without an opener', () => {
  const calls = [];
  const windowRef = { open: (...args) => calls.push(args) };
  assert.equal(openOfficeInMaps(PB_PII_OFFICE, windowRef), true);
  assert.deepEqual(calls, [[PB_PII_OFFICE.mapsUrl, '_blank', 'noopener,noreferrer']]);
  assert.equal(openOfficeInMaps(PB_PII_OFFICE, {}), false);
});

test('the default camera establishes high, then settles on the office', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const viewer = {
    camera: {
      setView: (options) => calls.push({ kind: 'setView', options }),
      flyToBoundingSphere: (sphere, options) => calls.push({ kind: 'flyToBoundingSphere', sphere, options }),
    },
  };
  flyToOffice(viewer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'setView');
  const overview = cartographicOf(calls[0].options.destination);
  assert.ok(Math.abs(overview.height - OFFICE_CAMERA.overviewHeightM) < 1);
  assert.equal(calls[0].options.orientation.pitch, Cesium.Math.toRadians(-90));
  assert.ok(Math.abs(overview.lat - PB_PII_OFFICE.lat) < 1e-6);

  t.mock.timers.tick(OFFICE_CAMERA.settleDelayMs);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].kind, 'flyToBoundingSphere');
  assert.equal(calls[1].options.duration, OFFICE_CAMERA.flyDurationS);
  const center = cartographicOf(calls[1].sphere.center);
  assert.ok(Math.abs(center.lat - PB_PII_OFFICE.lat) < 1e-6);
  assert.ok(Math.abs(center.lon - PB_PII_OFFICE.lon) < 1e-6);
  assert.equal(calls[1].options.offset.range, OFFICE_CAMERA.settleRangeM);
  assert.equal(calls[1].options.offset.pitch, Cesium.Math.toRadians(OFFICE_CAMERA.pitchDeg));
  assert.equal(calls[1].options.offset.heading, Cesium.Math.toRadians(OFFICE_CAMERA.headingDeg));
});

test('the office overlay source id is scoped to the landmark', () => {
  assert.equal(OFFICE_OVERLAY_SOURCE_ID, 'pb-pii-office-card');
});
