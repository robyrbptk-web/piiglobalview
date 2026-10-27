import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTasikCctvCatalog, rewriteHlsPlaylist } from '../../vite.config.js';

const PLAYLIST_URL = 'https://atcs.example.go.id/camera/jati.m3u8';

test('rewriteHlsPlaylist routes relative segments through the camera proxy', () => {
  const playlist = '#EXTM3U\n#EXTINF:8.0,\ns1338.ts\n#EXTINF:8.0,\ns1339.ts\n';
  const out = rewriteHlsPlaylist(playlist, PLAYLIST_URL, 'id-tsk-1');
  const expected = encodeURIComponent('https://atcs.example.go.id/camera/s1338.ts');
  assert.ok(out.includes(`/api/cctv/media/id-tsk-1?seg=${expected}`));
  assert.ok(out.includes('#EXTM3U'));
  assert.ok(out.includes('#EXTINF:8.0,'));
});

test('rewriteHlsPlaylist proxies same-origin absolute URIs and leaves cross-origin ones alone', () => {
  const playlist = [
    '#EXTM3U',
    'https://atcs.example.go.id/camera/s1.ts',
    'https://cdn.other.example/s2.ts',
  ].join('\n');
  const out = rewriteHlsPlaylist(playlist, PLAYLIST_URL, 'cam');
  assert.ok(out.includes(`seg=${encodeURIComponent('https://atcs.example.go.id/camera/s1.ts')}`));
  assert.ok(out.includes('https://cdn.other.example/s2.ts'));
  assert.ok(!out.includes(`seg=${encodeURIComponent('https://cdn.other.example/s2.ts')}`));
});

test('rewriteHlsPlaylist rewrites URI attributes for variants, keys, and init maps', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    'low/index.m3u8',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
  ].join('\n');
  const out = rewriteHlsPlaylist(playlist, PLAYLIST_URL, 'cam');
  assert.ok(out.includes(`URI="/api/cctv/media/cam?seg=${encodeURIComponent('https://atcs.example.go.id/camera/key.bin')}"`));
  assert.ok(out.includes(`URI="/api/cctv/media/cam?seg=${encodeURIComponent('https://atcs.example.go.id/camera/init.mp4')}"`));
  assert.ok(out.includes(`seg=${encodeURIComponent('https://atcs.example.go.id/camera/low/index.m3u8')}`));
});

test('rewriteHlsPlaylist preserves comments and blank lines', () => {
  const playlist = '#EXTM3U\n\n# a comment\nseg.ts\n';
  const out = rewriteHlsPlaylist(playlist, PLAYLIST_URL, 'cam');
  assert.ok(out.startsWith('#EXTM3U\n\n# a comment\n'));
});

test('parseTasikCctvCatalog reads the embedded var cctv object', () => {
  const html = `<script>var cctv={"15":{"id":"15","nama":"Simpang Jati","link":"https:\\/\\/atcs.example.go.id\\/camera\\/jati.m3u8","lokasi_lat":"-7.30","lokasi_lng":"108.20"}};
var lokasi=[{"lat":"-7.30","lng":"108.20","nama":"Simpang Jati","id":"15"}];</script>`;
  const rows = parseTasikCctvCatalog(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nama, 'Simpang Jati');
  assert.equal(rows[0].link, 'https://atcs.example.go.id/camera/jati.m3u8');
});

test('parseTasikCctvCatalog returns no rows when the page markup changes', () => {
  assert.deepEqual(parseTasikCctvCatalog('<html><body>no catalog here</body></html>'), []);
  assert.deepEqual(parseTasikCctvCatalog('var cctv={broken json};var lokasi=[];'), []);
  assert.deepEqual(parseTasikCctvCatalog(''), []);
});
