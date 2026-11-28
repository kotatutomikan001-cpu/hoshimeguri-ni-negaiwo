// 『星めぐりに願いを』オフライン対応サービスワーカー
// 一度オンラインで開くと、ゲーム本体と素材を端末に保存してオフラインでもCPU戦が遊べる。
// ※このファイルは固定版：ゲームのバージョンが上がっても書き換えないこと。
//   （2026-11-20に1回だけ例外修正：キャラボイスが無音プレースホルダーのまま保存され、
//     差し替えても再生されない問題への対処。CACHE_NAMEは据え置き）
//   （2026-11-28に2回目の例外修正：MP3も同名差し替えが反映されない問題への対処。
//     有効化時に保存済みMP3を一度だけ消去し、MP3も1日以上古ければ裏側で取り直す
//     ようにした。金タイトルの曲が旧曲のまま流れ続けたのが発覚のきっかけ。
//     CACHE_NAMEは据え置き）
//   ページ本体はオンライン時に必ず最新を取りに行き（取得できたら保存も更新）、
//   画像などの素材は保存を優先しつつ、1日以上古ければ裏側で最新に差し替える。
//   そのため index.html だけ差し替えれば、プレイヤー側は自動で最新版になる。
const CACHE_NAME = 'hoshimeguri-v1';
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000; // 1日

const CHAR_IDS = ['mikado', 'hikari', 'sakura', 'nemea', 'rui', 'tefu', 'heru', 'shakuna', 'mirine', 'yuni', 'eru', 'utsuro', 'shano', 'ritsu', 'kataru', 'tomoko'];
const SPEAKER_IDS = ['gakuencho', 'megami', 'goshu', 'utsuro_haha'];

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './title_logo.png',
  './oshimai.png',
  './title_tree_dry.png',
  './title_tree_green.png',
  './title_light_utsuro.png',
  './title_light_kataru.png',
  './title_light_tomoko.png',
  './select_bgm.mp3',
  './game_bgm.mp3',
  './ending_bgm.mp3',
  './ending_utsuro_bgm.mp3',
  './ending_kataru_bgm.mp3',
  './ending_tomoko_bgm.mp3',
  './ending_talk_bgm.mp3',
  './title_gold_bgm.mp3',
  './se_memory.mp3',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
  './char_assets/worldmap.png',
  ...CHAR_IDS.concat(SPEAKER_IDS).map(id => './char_assets/icons/' + id + '.png'),
  ...CHAR_IDS.map(id => './char_assets/stand/' + id + '.png'),
  ...CHAR_IDS.flatMap(id => ['./char_assets/voice/' + id + '_plus.mp3', './char_assets/voice/' + id + '_minus.mp3'])
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 1つでも無いファイルがあると全体が失敗しないよう、1件ずつベストエフォートで保存する
    await Promise.all(ASSETS.map(async (url) => {
      try {
        if (url.startsWith('http')) await cache.add(new Request(url, { mode: 'no-cors' }));
        else await cache.add(url);
      } catch (err) { /* 無い素材は飛ばす */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    // キャラボイスは保存対象外（下のfetch参照）。旧版で保存されてしまった分はここで消す。
    // MP3（BGM・SE）も、2026-11-28の例外修正の有効化時に一度だけ消す：同名で差し替えた
    // 新しい曲が、古い保存のせいでいつまでも再生されない問題への対処（金タイトルの曲で発覚）。
    const ownCache = await caches.open(CACHE_NAME);
    const ownReqs = await ownCache.keys();
    await Promise.all(ownReqs.filter((r) => r.url.includes('/char_assets/voice/') || new URL(r.url).pathname.endsWith('.mp3')).map((r) => ownCache.delete(r)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ページ本体はオンライン時に最新を取りに行き、取得できたら保存も新しいものに差し替える。
  // 失敗したら保存済みを使う（＝オフラインでも最後に見たバージョンで遊べる）。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // キャラボイスは常にネットワークから取得する（保存しない・保存済みも使わない）。
  // 差し替えが即座に反映されるようにするためで、オフライン時は無音になる仕様。
  if (url.origin === self.location.origin && url.pathname.includes('/char_assets/voice/')) return;

  // 自分の素材とCDN（Tailwind / PeerJS）は保存済みを優先（オフラインで動かすため）
  // ※URLは末尾スラッシュ付きで正規化されるため、完全一致ではなく前方一致で判定する
  const isCdn = url.href.startsWith('https://cdn.tailwindcss.com') || url.href.startsWith('https://unpkg.com/peerjs');
  if (url.origin === self.location.origin || isCdn) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        // 画像・音楽など差し替わることのある素材は、保存が1日以上古ければ裏側で最新を取り直す
        // （CDNは対象外。MP3は2026-11-28の例外修正で対象に含めた：同名差し替えを反映させるため）
        const isRevalidatable = url.origin === self.location.origin;
        if (isRevalidatable) {
          const dateHdr = hit.headers.get('Date');
          const age = dateHdr ? (Date.now() - Date.parse(dateHdr)) : Infinity;
          if (age > REVALIDATE_AFTER_MS) {
            event.waitUntil((async () => {
              try {
                const fresh = await fetch(req);
                if (fresh && (fresh.ok || fresh.type === 'opaque')) await cache.put(req, fresh);
              } catch (err) { /* 裏側の更新失敗は無視（今の保存で表示は続く） */ }
            })());
          }
        }
        return hit;
      }
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(req, fresh.clone());
      return fresh;
    })());
  }
  // それ以外（Google Sheets・GA等）はネットワークのみ。失敗時はゲーム側のフォールバックに任せる
});
