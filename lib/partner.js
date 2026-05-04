'use strict';

const db = require.main.require('./src/database');
const user = require.main.require('./src/user');
const groups = require.main.require('./src/groups');
const Messaging = require.main.require('./src/messaging');
const fs = require('fs');
const path = require('path');
const options = require('../data/options.json');

const CONFIG = {
  profilePoolTtlMs: 30 * 60 * 1000,
  onlineTtlMs: 8 * 60 * 1000,
  onlineFallbackMs: 12 * 60 * 1000,
  activeWindowMs: 24 * 60 * 60 * 1000,
  seenTtlMs: 24 * 60 * 60 * 1000,
  locationSyncMs: 24 * 60 * 60 * 1000,
  locationTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxPoolScan: 10000,
  maxLimit: 50,
  defaultLimit: 20,
  batchSize: 250,
  chattedRetentionMs: 180 * 24 * 60 * 60 * 1000,
  dailyGreetLimit: 8,
  vipDailyGreetLimit: 30,
  vipGroups: ['vip', 'VIP', 'Vip', 'premium', 'Premium', 'VIP会员', '会员']
};

const USER_FIELDS = [
  'uid', 'username', 'userslug', 'picture', 'status', 'lastonline', 'banned', 'deleted',
  'aboutme', 'signature', 'countryCode', 'country_code', 'country', 'country_name',
  'nationality', 'region', 'location', 'language_flag', 'language_fluent',
  'native_language', 'language_learning', 'target_language', 'gender', 'sex', 'age',
  'lat', 'lng', 'languagePartnerGeoUpdatedAt', 'languagePartnerGeoExpiresAt'
];

const PROFILE_FIELDS = ['language_flag', 'language_fluent', 'language_learning', 'gender', 'age'];

const LANG_DIR = path.join(__dirname, '..', 'languages');
const langCache = new Map();

function normalizeLocale(input) {
  const raw = String(input || '').toLowerCase();
  if (raw.startsWith('zh')) return 'zh-CN';
  if (raw.startsWith('my') || raw.startsWith('mm') || raw.includes('burmese')) return 'my-MM';
  if (raw.startsWith('vi')) return 'vi';
  return 'en-GB';
}

function loadLanguage(locale) {
  const normalized = normalizeLocale(locale);
  if (langCache.has(normalized)) return langCache.get(normalized);
  const file = path.join(LANG_DIR, normalized, 'peipe-partners.json');
  let dict = {};
  try {
    dict = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (normalized !== 'en-GB') return loadLanguage('en-GB');
  }
  langCache.set(normalized, dict);
  return dict;
}

async function detectLocale(req) {
  const direct = req && (req.query && req.query.lang || req.user && (req.user.language || req.user.locale || req.user.userLang));
  if (direct) return normalizeLocale(direct);
  if (req && req.uid) {
    try {
      const fields = await user.getUserFields(req.uid, ['language', 'locale', 'userLang']);
      const saved = fields && (fields.language || fields.locale || fields.userLang);
      if (saved) return normalizeLocale(saved);
    } catch (e) {}
  }
  const accept = req && req.headers && req.headers['accept-language'];
  return normalizeLocale(accept);
}

function optionFlagEmoji(item, listKey) {
  const rawCode = String(item && item.code || '').toLowerCase();
  const languageFallback = {
    cn: 'cn', zh: 'cn',
    mm: 'mm', my: 'mm',
    vi: 'vn', vn: 'vn',
    en: 'gb',
    th: 'th',
    jp: 'jp', ja: 'jp',
    kr: 'kr', ko: 'kr'
  };
  const countryCode = listKey === 'languages' ? (languageFallback[rawCode] || rawCode) : rawCode;
  return flagEmoji(countryCode);
}

function withEmojiLabel(label, emoji) {
  const text = String(label || '');
  if (!emoji) return text;
  return text.indexOf(emoji) === 0 ? text : `${emoji} ${text}`;
}

function localizeOptions(baseOptions, dict) {
  const cloneList = (list, listKey) => (list || []).map(item => {
    const emoji = optionFlagEmoji(item, listKey);
    const textLabel = dict[item.key] || item.label || item.value || item.key || '';
    return Object.assign({}, item, {
      flagEmoji: emoji,
      textLabel,
      label: withEmojiLabel(textLabel, emoji)
    });
  });
  return {
    countries: cloneList(baseOptions.countries, 'countries'),
    languages: cloneList(baseOptions.languages, 'languages'),
    genders: cloneList(baseOptions.genders, 'genders')
  };
}


const COUNTRY_KEYWORDS = {
  cn: ['cn', 'china', '中国', '中华人民共和国', 'zh-cn'],
  tw: ['tw', 'taiwan', '台湾', 'zh-tw'],
  hk: ['hk', 'hong kong', '香港'],
  us: ['us', 'usa', 'united states', '美国'],
  gb: ['gb', 'uk', 'united kingdom', 'great britain', 'england', '英国'],
  mm: ['mm', 'myanmar', 'burma', '缅甸'],
  vn: ['vn', 'vi', 'vietnam', '越南'],
  th: ['th', 'thailand', '泰国'],
  jp: ['jp', 'ja', 'japan', '日本'],
  kr: ['kr', 'ko', 'korea', 'south korea', '韩国', '南韩'],
  sg: ['sg', 'singapore', '新加坡'],
  la: ['la', 'laos', '老挝'],
  my: ['my', 'malaysia', '马来西亚'],
  ph: ['ph', 'philippines', '菲律宾'],
  id: ['id', 'indonesia', '印尼', '印度尼西亚'],
  kh: ['kh', 'cambodia', '柬埔寨'],
  in: ['in', 'india', '印度'],
  fr: ['fr', 'france', '法国'],
  de: ['de', 'germany', '德国'],
  br: ['br', 'brazil', '巴西'],
  ca: ['ca', 'canada', '加拿大'],
  au: ['au', 'australia', '澳大利亚'],
  ru: ['ru', 'russia', '俄罗斯']
};

const LANG_MAP = {
  cn: 'CN', zh: 'CN', 'zh-cn': 'CN', china: 'CN', chinese: 'CN', '中文': 'CN', '汉语': 'CN',
  en: 'EN', us: 'EN', uk: 'EN', gb: 'EN', english: 'EN', '英语': 'EN',
  vi: 'VI', vn: 'VI', vietnam: 'VI', vietnamese: 'VI', '越南': 'VI', '越南语': 'VI',
  mm: 'MM', my: 'MM', myanmar: 'MM', burmese: 'MM', '缅甸': 'MM', '缅甸语': 'MM',
  th: 'TH', thai: 'TH', thailand: 'TH', '泰语': 'TH',
  jp: 'JP', ja: 'JP', japan: 'JP', japanese: 'JP', '日语': 'JP',
  kr: 'KR', ko: 'KR', korea: 'KR', korean: 'KR', '韩语': 'KR'
};

const cache = {
  pool: [],
  poolBuiltAt: 0,
  onlineSet: new Set(),
  onlineBuiltAt: 0,
  buildingPool: null,
  buildingOnline: null
};

function now() {
  return Date.now();
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/["\\[\]{}]/g, '').trim();
}

function stripHtml(value) {
  return String(value == null ? '' : value).replace(/<[^>]+>/g, '').trim();
}

function parseMulti(value) {
  if (Array.isArray(value)) return value.map(v => cleanText(v)).filter(Boolean);
  if (value == null || value === '') return [];
  const raw = String(value).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(v => cleanText(v)).filter(Boolean);
    if (parsed && typeof parsed === 'object') return Object.values(parsed).map(v => cleanText(v)).filter(Boolean);
    return [cleanText(parsed)].filter(Boolean);
  } catch (e) {
    return raw.split(/[，,|/]+/).map(v => cleanText(v)).filter(Boolean);
  }
}

function toLangCode(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return '';
  if (LANG_MAP[text]) return LANG_MAP[text];
  const keys = Object.keys(LANG_MAP);
  for (const key of keys) {
    if (text.includes(key)) return LANG_MAP[key];
  }
  if (/^[a-z]{2}$/.test(text)) return text.toUpperCase();
  return text.length >= 2 ? text.substring(0, 2).toUpperCase() : '';
}

function toLangCodes(value) {
  const codes = parseMulti(value).map(toLangCode).filter(Boolean);
  return Array.from(new Set(codes));
}

function normalizeGender(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return '';
  if (text === 'm' || text === 'male' || text === '男' || text.includes('男')) return 'M';
  if (text === 'f' || text === 'female' || text === '女' || text.includes('女')) return 'F';
  return '';
}

function matchCountryCode(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return '';
  if (/^[a-z]{2}$/.test(text) && COUNTRY_KEYWORDS[text]) return text;
  const codes = Object.keys(COUNTRY_KEYWORDS);
  for (const code of codes) {
    const keywords = COUNTRY_KEYWORDS[code];
    for (const keyword of keywords) {
      if (text === keyword || text.includes(keyword)) return code;
    }
  }
  return '';
}

function resolveCountryCode(data, nativeCode) {
  const fields = [
    data.countryCode, data.country_code, data.country, data.country_name,
    data.nationality, data.region, data.language_flag, data.location
  ];
  for (const field of fields) {
    const code = matchCountryCode(field);
    if (code) return code;
  }
  const fallback = {
    CN: 'cn', MM: 'mm', VI: 'vn', EN: 'gb', TH: 'th', JP: 'jp', KR: 'kr'
  };
  return fallback[nativeCode] || '';
}

function flagEmoji(code) {
  const country = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return '';
  return country.replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function ageText(age) {
  const n = Number(age || 0);
  return n > 0 ? `${n}岁` : '';
}

function decorateUser(data) {
  const uid = Number(data.uid || 0);
  if (!uid || data.banned || data.deleted) return null;

  const nativeCodes = toLangCodes(data.language_fluent || data.native_language);
  const learnCodes = toLangCodes(data.language_learning || data.target_language);
  const nativeCode = nativeCodes[0] || '';
  const learnCode = learnCodes[0] || '';
  const countryCode = resolveCountryCode(data, nativeCode);
  const bioRaw = stripHtml(data.aboutme || data.signature || '');
  const bio = bioRaw.length > 80 ? `${bioRaw.substring(0, 80)}…` : bioRaw;
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  const geoUpdatedAt = Number(data.languagePartnerGeoUpdatedAt || 0);
  const geoExpiresAt = Number(data.languagePartnerGeoExpiresAt || 0);

  return {
    uid,
    username: String(data.username || ''),
    userslug: String(data.userslug || ''),
    picture: data.picture || '',
    genderCode: normalizeGender(data.gender || data.sex),
    age: Number(data.age || 0) || 0,
    ageText: ageText(data.age),
    bio,
    nativeCode,
    nativeCodes,
    learnCode,
    learnCodes,
    countryCode,
    flagEmoji: flagEmoji(countryCode),
    flagSrc: countryCode ? `https://flagcdn.com/w40/${countryCode}.png` : '',
    lastonline: Number(data.lastonline || 0) || 0,
    status: data.status || '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    geoUpdatedAt,
    geoExpiresAt,
    profileLink: data.userslug ? `/user/${encodeURIComponent(data.userslug)}/topics` : '#'
  };
}

async function getRecentUidsFromSortedSet(key, cutoff) {
  let values = [];
  try {
    values = await db.getSortedSetRevRangeByScore(key, 0, CONFIG.maxPoolScan - 1, '+inf', cutoff);
  } catch (e) {
    values = [];
  }
  return values.map(uid => Number(uid)).filter(uid => uid > 0);
}

async function getCandidateUids() {
  const cutoff = now() - CONFIG.activeWindowMs;
  const seen = new Set();
  const recentKeys = ['users:lastonline', 'users:online'];

  for (const key of recentKeys) {
    const uids = await getRecentUidsFromSortedSet(key, cutoff);
    for (const uid of uids) {
      seen.add(uid);
      if (seen.size >= CONFIG.maxPoolScan) return Array.from(seen);
    }
  }

  // Fallback for NodeBB setups without a lastonline sorted set. The final 24h
  // filter still happens in buildPool(), so inactive users are not returned.
  let fallback = [];
  try {
    fallback = await db.getSortedSetRevRange('users:joindate', 0, CONFIG.maxPoolScan - 1);
  } catch (e) {
    fallback = [];
  }
  for (const uid of fallback.map(value => Number(value)).filter(value => value > 0)) {
    seen.add(uid);
    if (seen.size >= CONFIG.maxPoolScan) break;
  }

  return Array.from(seen);
}

function isActiveWithinWindow(item, onlineSet) {
  if (!item || !item.uid) return false;
  if (onlineSet && onlineSet.has(Number(item.uid))) return true;
  if (String(item.status || '') === 'online') return true;
  const last = Number(item.lastonline || 0);
  return !!last && now() - last <= CONFIG.activeWindowMs;
}

async function buildPool() {
  if (cache.buildingPool) return cache.buildingPool;
  cache.buildingPool = (async () => {
    const [uids, onlineSet] = await Promise.all([
      getCandidateUids(),
      getOnlineSet().catch(() => new Set())
    ]);
    const pool = [];
    for (let i = 0; i < uids.length; i += CONFIG.batchSize) {
      const batchUids = uids.slice(i, i + CONFIG.batchSize);
      let users = [];
      try {
        users = await user.getUsersFields(batchUids, USER_FIELDS);
      } catch (e) {
        users = [];
      }
      for (const item of users) {
        const decorated = decorateUser(item || {});
        if (decorated && isActiveWithinWindow(decorated, onlineSet)) pool.push(decorated);
      }
    }
    cache.pool = pool;
    cache.poolBuiltAt = now();
    cache.buildingPool = null;
    return pool;
  })();
  return cache.buildingPool;
}

async function getPool() {
  if (!cache.poolBuiltAt || now() - cache.poolBuiltAt > CONFIG.profilePoolTtlMs) {
    return await buildPool();
  }
  return cache.pool;
}

async function getOnlineSet() {
  if (cache.onlineBuiltAt && now() - cache.onlineBuiltAt <= CONFIG.onlineTtlMs) return cache.onlineSet;
  if (cache.buildingOnline) return cache.buildingOnline;
  cache.buildingOnline = (async () => {
    let values = [];
    try {
      values = await db.getSortedSetRevRange('users:online', 0, -1);
    } catch (e) {
      values = [];
    }
    cache.onlineSet = new Set(values.map(v => Number(v)).filter(v => v > 0));
    cache.onlineBuiltAt = now();
    cache.buildingOnline = null;
    return cache.onlineSet;
  })();
  return cache.buildingOnline;
}

function applyOnline(userData, onlineSet) {
  const isOnline = onlineSet.has(Number(userData.uid)) || String(userData.status || '') === 'online' || (
    userData.lastonline && now() - Number(userData.lastonline) < CONFIG.onlineFallbackMs
  );
  return Object.assign({}, userData, {
    isOnline: !!isOnline,
    statusText: isOnline ? '当前在线' : '',
    canChat: false
  });
}

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function stableRandomSort(items, seed) {
  return items.map(item => ({
    item,
    score: hashString(`${seed}:${item.uid}`)
  })).sort((a, b) => a.score - b.score).map(entry => entry.item);
}

function intersect(a, b) {
  const set = new Set(a || []);
  return (b || []).some(value => set.has(value));
}

function languageScore(me, other) {
  if (!me) return 0;
  let score = 0;
  if (intersect(me.learnCodes, other.nativeCodes)) score += 30;
  if (intersect(me.nativeCodes, other.learnCodes)) score += 30;
  if (intersect(me.learnCodes, other.learnCodes)) score += 5;
  return score;
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const earth = 6371000;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function distanceBucket(meters) {
  if (!Number.isFinite(meters)) return 'unknown';
  if (meters <= 300) return 'm300';
  if (meters <= 500) return 'm500';
  if (meters <= 1000) return 'km1';
  if (meters <= 3000) return 'km3';
  if (meters <= 5000) return 'km5';
  if (meters <= 10000) return 'km10';
  if (meters <= 30000) return 'km30';
  return 'nearby';
}

function distanceText(bucket) {
  const map = {
    m300: '300米内', m500: '500米内', km1: '1km内', km3: '3km内',
    km5: '5km内', km10: '10km内', km30: '30km内', nearby: '同城附近', unknown: '附近'
  };
  return map[bucket] || map.unknown;
}

function hasValidGeo(item) {
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return false;
  if (!item.geoExpiresAt) return true;
  return Number(item.geoExpiresAt) > now();
}

async function getViewer(uid, pool) {
  if (!uid) return null;
  return pool.find(item => Number(item.uid) === Number(uid)) || null;
}

async function getSeenSet(uid, mode) {
  if (!uid) return new Set();
  const key = `peipePartners:seen:${mode}:${uid}`;
  const cutoff = now() - CONFIG.seenTtlMs;
  try {
    if (db.sortedSetRemoveRangeByScore) await db.sortedSetRemoveRangeByScore(key, 0, cutoff);
  } catch (e) {}
  let values = [];
  try {
    values = await db.getSortedSetRevRangeByScore(key, 0, -1, '+inf', cutoff);
  } catch (e) {
    try { values = await db.getSortedSetRevRange(key, 0, -1); } catch (err) { values = []; }
  }
  return new Set(values.map(v => Number(v)));
}

async function addSeen(uid, mode, targets) {
  if (!uid || !targets.length) return;
  const key = `peipePartners:seen:${mode}:${uid}`;
  const timestamp = now();
  try {
    await db.sortedSetAdd(key, targets.map(() => timestamp), targets.map(item => Number(item.uid)));
  } catch (e) {
    for (const item of targets) {
      try { await db.sortedSetAdd(key, timestamp, Number(item.uid)); } catch (err) {}
    }
  }
}

async function getChattedSet(uid) {
  if (!uid) return new Set();
  const key = `peipePartners:chatted:${uid}`;
  const cutoff = now() - CONFIG.chattedRetentionMs;
  try {
    if (db.sortedSetRemoveRangeByScore) await db.sortedSetRemoveRangeByScore(key, 0, cutoff);
  } catch (e) {}
  let values = [];
  try { values = await db.getSortedSetRevRange(key, 0, -1); } catch (e) { values = []; }
  return new Set(values.map(v => Number(v)));
}

function canChat(viewerUid, targetUid) {
  return !!viewerUid && Number(viewerUid) !== Number(targetUid);
}

function dayKey(timestamp = now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function isVip(uid) {
  if (!uid) return false;
  for (const groupName of CONFIG.vipGroups) {
    try {
      if (await groups.isMember(uid, groupName)) return true;
    } catch (e) {}
  }
  return false;
}

async function getGreetLimit(uid) {
  const vip = await isVip(uid);
  return vip ? CONFIG.vipDailyGreetLimit : CONFIG.dailyGreetLimit;
}

async function getDailyGreetTargets(uid) {
  if (!uid) return [];
  const key = `peipePartners:greet:${dayKey()}:${uid}`;
  try {
    return (await db.getSortedSetRange(key, 0, -1)).map(v => Number(v)).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function getGreetQuota(uid) {
  const [limit, targets] = await Promise.all([getGreetLimit(uid), getDailyGreetTargets(uid)]);
  const used = new Set(targets).size;
  return { limit, used, remaining: Math.max(limit - used, 0) };
}

async function recordGreet(uid, targetUid) {
  const key = `peipePartners:greet:${dayKey()}:${uid}`;
  await db.sortedSetAdd(key, now(), Number(targetUid));
}

async function hasChatted(uid, targetUid) {
  const set = await getChattedSet(uid);
  return set.has(Number(targetUid));
}

async function markChattedPair(uid, targetUid) {
  const timestamp = now();
  await Promise.all([
    db.sortedSetAdd(`peipePartners:chatted:${uid}`, timestamp, Number(targetUid)),
    db.sortedSetAdd(`peipePartners:chatted:${targetUid}`, timestamp, Number(uid))
  ]);
}

async function findPrivateRoom(uid, targetUid) {
  uid = Number(uid || 0);
  targetUid = Number(targetUid || 0);
  if (!uid || !targetUid) return 0;
  let roomIds = [];
  try {
    roomIds = await db.getSortedSetRevRange(`uid:${uid}:chat:rooms`, 0, 200);
  } catch (e) {
    roomIds = [];
  }
  for (const roomId of roomIds) {
    let uids = [];
    try {
      uids = await db.getSortedSetRange(`chat:room:${roomId}:uids`, 0, -1);
    } catch (e) {
      uids = [];
    }
    const numbers = uids.map(v => Number(v)).filter(Boolean);
    if (numbers.length === 2 && numbers.includes(uid) && numbers.includes(targetUid)) {
      return Number(roomId);
    }
  }
  return 0;
}

async function createPrivateRoom(uid, targetUid) {
  const roomId = await Messaging.newRoom(Number(uid), { uids: [Number(targetUid)] });
  return Number(roomId || 0);
}

function publicUser(item, onlineSet, viewerUid) {
  const withOnline = applyOnline(item, onlineSet);
  delete withOnline.lat;
  delete withOnline.lng;
  delete withOnline.geoUpdatedAt;
  delete withOnline.geoExpiresAt;
  delete withOnline.distanceMeters;
  delete withOnline.distanceKm;
  withOnline.canChat = canChat(viewerUid, withOnline.uid);
  return withOnline;
}

async function list(req) {
  const mode = req.query.mode === 'nearby' ? 'nearby' : 'recommend';
  const viewerUid = Number(req.uid || 0);
  const limit = Math.min(Math.max(Number(req.query.limit || CONFIG.defaultLimit), 1), CONFIG.maxLimit);
  const cursor = Math.max(Number(req.query.cursor || 0), 0);
  const pool = await getPool();
  const onlineSet = await getOnlineSet();
  const viewer = await getViewer(viewerUid, pool);
  const seenSet = await getSeenSet(viewerUid, mode);
  const chattedSet = await getChattedSet(viewerUid);
  const seed = `${viewerUid || 'guest'}:${mode}:${Math.floor(now() / CONFIG.profilePoolTtlMs)}`;

  let candidates = pool.filter(item => Number(item.uid) !== viewerUid && !chattedSet.has(Number(item.uid)));
  let needLocation = false;

  if (mode === 'nearby') {
    if (!viewer || !hasValidGeo(viewer)) {
      needLocation = true;
      candidates = [];
    } else {
      candidates = candidates.filter(hasValidGeo).map(item => {
        const meters = distanceMeters(viewer.lat, viewer.lng, item.lat, item.lng);
        const bucket = distanceBucket(meters);
        return Object.assign({}, item, {
          distanceMeters: meters,
          distanceKm: Math.round(meters / 100) / 10,
          distanceBucket: bucket,
          distanceText: distanceText(bucket)
        });
      }).sort((a, b) => {
        const ao = onlineSet.has(Number(a.uid));
        const bo = onlineSet.has(Number(b.uid));
        if (ao !== bo) return ao ? -1 : 1;
        if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
        return hashString(`${seed}:${a.uid}`) - hashString(`${seed}:${b.uid}`);
      });
    }
  } else {
    candidates = candidates.map(item => ({
      item,
      isOnline: onlineSet.has(Number(item.uid)) || String(item.status || '') === 'online' || (item.lastonline && now() - Number(item.lastonline) < CONFIG.onlineFallbackMs),
      hasLanguageMatch: languageScore(viewer, item) > 0,
      randomScore: hashString(`${seed}:${item.uid}`)
    })).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      if (a.hasLanguageMatch !== b.hasLanguageMatch) return a.hasLanguageMatch ? -1 : 1;
      return a.randomScore - b.randomScore;
    }).map(entry => entry.item);
  }

  let chosen;
  if (viewerUid) {
    const unseen = candidates.filter(item => !seenSet.has(Number(item.uid)));
    const seen = candidates.filter(item => seenSet.has(Number(item.uid)));
    chosen = unseen.slice(0, limit);
    if (chosen.length < limit) {
      chosen = chosen.concat(seen.slice(0, limit - chosen.length));
    }
  } else {
    const sorted = stableRandomSort(candidates, seed);
    chosen = sorted.slice(cursor, cursor + limit);
  }

  await addSeen(viewerUid, mode, chosen);

  const users = chosen.map(item => publicUser(item, onlineSet, viewerUid));
  return {
    ok: true,
    mode,
    users,
    needLocation,
    nextCursor: viewerUid ? (users.length ? String(now()) : null) : (cursor + users.length < candidates.length ? String(cursor + users.length) : null),
    hasMore: viewerUid ? users.length === limit : cursor + users.length < candidates.length,
    poolTtl: Math.round(CONFIG.profilePoolTtlMs / 1000),
    poolAgeSec: cache.poolBuiltAt ? Math.round((now() - cache.poolBuiltAt) / 1000) : 0,
    onlineTtl: Math.round(CONFIG.onlineTtlMs / 1000),
    onlineAgeSec: cache.onlineBuiltAt ? Math.round((now() - cache.onlineBuiltAt) / 1000) : 0,
    poolCount: pool.length,
    candidateCount: candidates.length,
    hiddenChattedCount: chattedSet.size
  };
}

async function profileStatus(uid) {
  const data = await user.getUserFields(uid, PROFILE_FIELDS);
  const missing = [];
  if (!cleanText(data.language_flag)) missing.push('language_flag');
  if (!parseMulti(data.language_fluent).length) missing.push('language_fluent');
  if (!parseMulti(data.language_learning).length) missing.push('language_learning');
  if (!normalizeGender(data.gender)) missing.push('gender');
  const age = Number(data.age || 0);
  if (!age || age < 13 || age > 99) missing.push('age');
  return { ok: true, complete: missing.length === 0, missing, profile: data };
}

function optionValues(key) {
  return new Set((options[key] || []).map(item => item.value));
}

async function saveProfile(uid, body) {
  const country = cleanText(body.language_flag || body.country || body.nationality);
  const nativeList = parseMulti(body.language_fluent || body.native || body.native_language);
  const learningList = parseMulti(body.language_learning || body.learning || body.target_language);
  const gender = cleanText(body.gender);
  const age = Number(body.age || 0);

  const countryValues = optionValues('countries');
  const languageValues = optionValues('languages');
  const genderValues = optionValues('genders');

  const validNative = nativeList.length > 0 && nativeList.every(value => languageValues.has(value));
  const validLearning = learningList.length > 0 && learningList.every(value => languageValues.has(value));

  if (!countryValues.has(country) || !validNative || !validLearning || !genderValues.has(gender) || !age || age < 13 || age > 99) {
    return { ok: false, error: 'invalid-profile' };
  }

  await user.setUserFields(uid, {
    language_flag: country,
    language_fluent: JSON.stringify(Array.from(new Set(nativeList))),
    language_learning: JSON.stringify(Array.from(new Set(learningList))),
    gender,
    age
  });
  cache.poolBuiltAt = 0;
  return { ok: true, complete: true };
}

async function saveLocation(uid, body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: 'invalid-location' };
  }

  const fields = await user.getUserFields(uid, ['languagePartnerGeoUpdatedAt']);
  const previous = Number(fields.languagePartnerGeoUpdatedAt || 0);
  if (previous && now() - previous < CONFIG.locationSyncMs && !body.force) {
    return {
      ok: true,
      skipped: true,
      reason: 'recently-updated',
      updatedAt: previous,
      expiresAt: previous + CONFIG.locationTtlMs
    };
  }

  const updatedAt = now();
  const expiresAt = updatedAt + CONFIG.locationTtlMs;
  await user.setUserFields(uid, {
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
    languagePartnerGeoUpdatedAt: updatedAt,
    languagePartnerGeoExpiresAt: expiresAt
  });
  cache.poolBuiltAt = 0;
  return { ok: true, updatedAt, expiresAt };
}

async function markChatted(uid, body) {
  const targetUid = Number(body.uid || body.targetUid || 0);
  if (!targetUid || targetUid === Number(uid)) return { ok: false, error: 'invalid-target' };
  await markChattedPair(uid, targetUid);
  return { ok: true };
}

async function greet(uid, body) {
  uid = Number(uid || 0);
  const targetUid = Number(body.uid || body.targetUid || 0);
  if (!uid) return { ok: false, error: 'login-required' };
  if (!targetUid || targetUid === uid) return { ok: false, error: 'invalid-target' };

  const target = await user.getUserFields(targetUid, ['uid', 'deleted', 'banned']);
  if (!target || !Number(target.uid) || target.deleted || target.banned) {
    return { ok: false, error: 'invalid-target' };
  }

  const existingRoomId = await findPrivateRoom(uid, targetUid);
  if (existingRoomId) {
    await markChattedPair(uid, targetUid);
    return { ok: true, roomId: existingRoomId, existing: true, quota: await getGreetQuota(uid) };
  }

  const alreadyChatted = await hasChatted(uid, targetUid);
  if (!alreadyChatted) {
    const quota = await getGreetQuota(uid);
    if (quota.remaining <= 0) {
      return { ok: false, error: 'greet-limit-exceeded', quota };
    }
    await recordGreet(uid, targetUid);
  }

  const roomId = await createPrivateRoom(uid, targetUid);
  if (!roomId) return { ok: false, error: 'chat-open-failed' };
  await markChattedPair(uid, targetUid);
  return { ok: true, roomId, existing: false, quota: await getGreetQuota(uid) };
}

async function getOptions(req) {
  const locale = await detectLocale(req);
  const dict = loadLanguage(locale);
  return {
    ok: true,
    locale,
    i18n: dict,
    options: localizeOptions(options, dict)
  };
}

module.exports = {
  list,
  options: getOptions,
  profileStatus,
  saveProfile,
  saveLocation,
  markChatted,
  greet,
  _private: { CONFIG, cache, parseMulti, toLangCodes, normalizeGender, matchCountryCode, distanceBucket, isActiveWithinWindow }
};
