import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * The PB PII secretariat the globe opens on.
 *
 * Coordinates are the ones the owner supplied from the Google Maps place link;
 * the address is the published secretariat address. This is a fixed landmark,
 * not a data layer: it is always present, it is never toggled off, and it is
 * not part of the layer-state registry (share links and saved preferences have
 * no business being able to hide the organisation's own office).
 */
export const PB_PII_OFFICE = Object.freeze({
  id: 'pb-pii-office',
  name: 'Sekretariat PB PII',
  lat: -6.1844917,
  lon: 106.8344897,
  altitudeM: 30,
  address: 'Jl. Menteng Raya No. 58',
  area: 'Kebon Sirih, Menteng, Jakarta Pusat',
  city: 'DKI Jakarta',
  // Google's documented keyless Maps URL form; the place page itself needs a
  // browser session, a coordinate query opens the pin directly.
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=-6.1844917,106.8344897',
  accent: '#f5c542',
});

export const OFFICE_DATA_SOURCE_ID = 'pb-pii-office';
export const OFFICE_OVERLAY_SOURCE_ID = 'pb-pii-office-card';

/** Cinematic arrival: a high establishing frame, then a slow oblique close-up. */
export const OFFICE_CAMERA = Object.freeze({
  overviewHeightM: 24000,
  // Range is measured FROM the office, not altitude above it — the landmark has
  // to sit in the middle of the frame, which a plain flyTo (camera placed AT
  // the coordinates, looking at the horizon) does not deliver.
  settleRangeM: 850,
  headingDeg: 20,
  pitchDeg: -35,
  settleDelayMs: 500,
  flyDurationS: 4.0,
  labelMaxDistanceM: 60000,
});

const OVERLAY_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  moving: false,
});

/** Address lines shown in the card and the accessibility label. */
export function officeDetails(office = PB_PII_OFFICE) {
  return [office.address, office.area, office.city];
}

/** Open the Maps pin in a new tab. Exported so callers can substitute it. */
export function openOfficeInMaps(office = PB_PII_OFFICE, windowRef = globalThis.window) {
  if (!office?.mapsUrl || typeof windowRef?.open !== 'function') return false;
  windowRef.open(office.mapsUrl, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Build the always-present office card. Interactive: mouse activation runs
 * through `openMaps`, the overlay host's accessibility list through
 * `activate`.
 */
export function createOfficeOverlayEntry({
  office = PB_PII_OFFICE,
  position = null,
  openMaps = openOfficeInMaps,
} = {}) {
  const anchor = position || Cesium.Cartesian3.fromDegrees(office.lon, office.lat, office.altitudeM);
  const details = `${office.name}, ${officeDetails(office).join(', ')}. Buka di Google Maps.`;
  return {
    id: `${office.id}:card`,
    position: anchor,
    variant: 'card',
    title: office.name,
    details: [...officeDetails(office), 'Klik kartu untuk membuka Google Maps'],
    accent: office.accent,
    pinned: true,
    protected: true,
    priority: Number.MAX_SAFE_INTEGER,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    interactive: true,
    accessibilityLabel: details,
    activate: () => openMaps(office),
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}

/**
 * Add the secretariat marker, its card, and the click handler that opens Maps.
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @returns {{office: object, dataSource: Cesium.CustomDataSource, entity: Cesium.Entity, focus: Function, destroy: Function}}
 */
export function installOfficeMarker(viewer, { office = PB_PII_OFFICE, openMaps = openOfficeInMaps } = {}) {
  if (!viewer?.dataSources) throw new TypeError('installOfficeMarker requires a Cesium viewer');
  const position = Cesium.Cartesian3.fromDegrees(office.lon, office.lat, office.altitudeM);
  const entityId = `${office.id}:marker`;
  const dataSource = new Cesium.CustomDataSource(OFFICE_DATA_SOURCE_ID);
  dataSource.show = true;
  const entity = dataSource.entities.add({
    id: entityId,
    position,
    point: {
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString(office.accent),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: new Cesium.NearFarScalar(2000, 1.4, 2.5e6, 0.7),
    },
    label: {
      text: office.name,
      font: '600 13px "Inter", "Segoe UI", sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, OFFICE_CAMERA.labelMaxDistanceM),
      translucencyByDistance: new Cesium.NearFarScalar(
        OFFICE_CAMERA.labelMaxDistanceM * 0.5,
        1,
        OFFICE_CAMERA.labelMaxDistanceM,
        0.25,
      ),
    },
  });
  viewer.dataSources.add(dataSource);

  setOverlaySourceVisible(OFFICE_OVERLAY_SOURCE_ID, true);
  setOverlayEntries(
    OFFICE_OVERLAY_SOURCE_ID,
    [createOfficeOverlayEntry({ office, position, openMaps })],
    OVERLAY_SOURCE_OPTIONS,
  );

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const cardHit = hitTestWorldOverlay(click.position.x, click.position.y, {
      sourceId: OFFICE_OVERLAY_SOURCE_ID,
    });
    if (cardHit?.entry?.activate) {
      cardHit.entry.activate();
      return;
    }
    const picked = viewer.scene.pick(click.position);
    const pickedId = typeof picked?.id === 'string' ? picked.id : picked?.id?.id;
    if (pickedId === entityId) openMaps(office);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  governorRequestRender('pb-pii-office');

  return {
    office,
    dataSource,
    entity,
    focus: () => flyToOffice(viewer, { office }),
    destroy() {
      handler.destroy();
      clearOverlaySource(OFFICE_OVERLAY_SOURCE_ID);
      viewer.dataSources.remove(dataSource, true);
    },
  };
}

/**
 * Fly the camera to the secretariat with the same establishing-then-descending
 * rhythm the globe used for its previous default view.
 */
export function flyToOffice(viewer, { office = PB_PII_OFFICE } = {}) {
  const target = Cesium.Cartesian3.fromDegrees(office.lon, office.lat, office.altitudeM);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(office.lon, office.lat, OFFICE_CAMERA.overviewHeightM),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });
  setTimeout(() => {
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(OFFICE_CAMERA.headingDeg),
        Cesium.Math.toRadians(OFFICE_CAMERA.pitchDeg),
        OFFICE_CAMERA.settleRangeM,
      ),
      duration: OFFICE_CAMERA.flyDurationS,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, OFFICE_CAMERA.settleDelayMs);
}
