// Display-only Indonesian names. Layer ids and module metadata stay in English
// because share links, voice actions and persisted state address layers by id.
export const LAYER_DISPLAY_NAMES = Object.freeze({
  traffic: 'Lalu Lintas Jalan',
  flights: 'Penerbangan Langsung',
  military: 'Penerbangan Militer',
  satellites: 'Satelit',
  'rocket-launches': 'Misi Luar Angkasa (30 hr)',
  cctv: 'CCTV',
  radio: 'Radio',
  bikeshare: 'Sepeda Publik',
  'ais-live-vessels': 'Kapal AIS Langsung',
  'military-awareness': 'Konteks Global',
  'local-datacenters': 'Pusat Data',
  'local-dams': 'Bendungan',
  'local-firms': 'Kebakaran Aktif FIRMS',
  'telegeography-submarine-cables': 'Kabel Bawah Laut',
  'indonesian-volcanoes': 'Gunung Berapi Indonesia',
  'indonesian-schools': 'Sekolah Indonesia',
  'indonesian-hospitals': 'Rumah Sakit Indonesia',
  'transjakarta-halte': 'Halte Transjakarta',
  earthquakes: 'Gempa Bumi (24 jam)',
  'military-installations': 'Instalasi Terpetakan',
});

export function displayLayerName(layer) {
  return LAYER_DISPLAY_NAMES[layer?.id] || layer?.name || layer?.id || '';
}
