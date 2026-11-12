
// ======================= V2 五語（zh-TW／en／ja／ko／zh-CN）=======================
// 用法：網址參數 ?lang=en，或執行期 setLang('ja')。語言代碼跟聲嶼的 i18n.js 一致。
// 原則：
//   1. 只翻「觀眾要看懂」的字：標題、名字與份數的句型、少數標籤。柏青哥風的日文效果字（チャンス、激アツ、ゾロ目…）和英文標籤（LOCK ON、RAID…）五個語言都保留原樣，那是風格的一部分。
//   2. 每個語言各有自己的標題字型，同一行不可以出現兩種字體（見 titleFont 與下面的字型設定）。
//   3. 語序不同，所以「名字／份數」兩行是各語言各自的句型，不是把中文拆開翻。
const LANGS = ['zh-TW', 'en', 'ja', 'ko', 'zh-CN'];
const subsEn = (n) => (Number(n) === 1 ? '1 sub' : `${n} subs`);
const L10N = {
  'zh-TW': {
    title: { sub: '感謝訂閱!', g1: '贈送訂閱!', g5: '贈訂 ×{n}!', g10: '贈訂 ×{n}!!', g25: '大量贈訂!!', g50: '大物降臨!!', g100: '神降臨!!', r1: '揪團來了!', r2: '揪團來襲!', r3: '揪團來襲!!', r4: '大揪團來襲!!' },
    sub1Gift: (name) => `${name} 送出了`, sub2Gift: (n) => `${n} 份訂閱`, sub1Sub: (name) => `${name}`, sub2Sub: '訂閱了!', sub1Raid: (name) => `${name} 帶著`, sub2Raid: (n) => `${n} 位夥伴來了`,
    nameGift: (name, n) => `${name} 送出了 ${n} 份訂閱`, nameSub: (name) => `${name} 訂閱了`, raidLine: (name, n) => `${name} 帶著 ${n} 位夥伴`,
    speechSub: (name) => `謝謝 ${name} 的訂閱！`, speechGift: (name, n) => `謝謝 ${name} 送的 ${n} 份訂閱！`,
    lblGift: '份訂閱!', lblRaid: '位夥伴來了!', lblGift0: '份訂閱', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: '贈訂', victory: '大勝利!!', extra: '號外!!', ex1: '號', ex2: '外', fleet: '艦隊，全員到齊！', pass: ' ・ 登船證', notice1: '送出了 1 份訂閱', tickerR: 'RAID ★ 大艦隊來襲 ★', viewer: '觀眾' },
  'zh-CN': {
    title: { sub: '感谢订阅!', g1: '赠送订阅!', g5: '赠订 ×{n}!', g10: '赠订 ×{n}!!', g25: '大量赠订!!', g50: '大佬降临!!', g100: '神降临!!', r1: '突袭来了!', r2: '突袭驾到!', r3: '突袭驾到!!', r4: '超大突袭!!' },
    sub1Gift: (name) => `${name} 送出了`, sub2Gift: (n) => `${n} 份订阅`, sub1Sub: (name) => `${name}`, sub2Sub: '订阅了!', sub1Raid: (name) => `${name} 带着`, sub2Raid: (n) => `${n} 位伙伴来了`,
    nameGift: (name, n) => `${name} 送出了 ${n} 份订阅`, nameSub: (name) => `${name} 订阅了`, raidLine: (name, n) => `${name} 带着 ${n} 位伙伴`,
    speechSub: (name) => `谢谢 ${name} 的订阅！`, speechGift: (name, n) => `谢谢 ${name} 送的 ${n} 份订阅！`,
    lblGift: '份订阅!', lblRaid: '位伙伴来了!', lblGift0: '份订阅', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: '赠订', victory: '大胜利!!', extra: '号外!!', ex1: '号', ex2: '外', fleet: '舰队，全员到齐！', pass: ' ・ 登船证', notice1: '送出了 1 份订阅', tickerR: 'RAID ★ 大舰队来袭 ★', viewer: '观众' },
  ja: {
    title: { sub: 'サブスク感謝!', g1: 'サブギフ!', g5: 'ギフト ×{n}!', g10: 'ギフト ×{n}!!', g25: '大量ギフト!!', g50: '大物降臨!!', g100: '神降臨!!', r1: 'レイド来た!', r2: 'レイド襲来!', r3: 'レイド襲来!!', r4: '大レイド襲来!!' },
    sub1Gift: (name) => `${name} さんから`, sub2Gift: (n) => `${n} 個のサブギフト`, sub1Sub: (name) => `${name} さん`, sub2Sub: 'サブスク登録!', sub1Raid: (name) => `${name} さんが`, sub2Raid: (n) => `${n} 人でレイド!`,
    nameGift: (name, n) => `${name} さんから ${n} 個のサブギフト`, nameSub: (name) => `${name} さんがサブスク登録`, raidLine: (name, n) => `${name} さんが ${n} 人とレイド`,
    speechSub: (name) => `${name} さん、サブスクありがとう！`, speechGift: (name, n) => `${name} さん、${n} 個のギフトありがとう！`,
    lblGift: 'サブギフト!', lblRaid: '人でレイド!', lblGift0: '個ギフト', unit: '人', ppl: (n) => `${n} 人`, medal: (n) => `${n}人`,
    gift: 'ギフト', victory: '大勝利!!', extra: '号外!!', ex1: '号', ex2: '外', fleet: '艦隊、全員集合！', pass: ' ・ 乗船券', notice1: '1 個のサブギフト', tickerR: 'RAID ★ 大艦隊襲来 ★', viewer: '視聴者' },
  ko: {
    title: { sub: '구독 감사!', g1: '구독 선물!', g5: '선물 ×{n}!', g10: '선물 ×{n}!!', g25: '대량 선물!!', g50: '큰손 강림!!', g100: '신 강림!!', r1: '레이드 도착!', r2: '레이드 습격!', r3: '레이드 습격!!', r4: '초대형 레이드!!' },
    sub1Gift: (name) => `${name} 님이`, sub2Gift: (n) => `구독 ${n}개 선물`, sub1Sub: (name) => `${name} 님`, sub2Sub: '구독했어요!', sub1Raid: (name) => `${name} 님이`, sub2Raid: (n) => `${n}명과 레이드!`,
    nameGift: (name, n) => `${name} 님이 구독 ${n}개 선물`, nameSub: (name) => `${name} 님이 구독`, raidLine: (name, n) => `${name} 님이 ${n}명과 함께`,
    speechSub: (name) => `${name} 님, 구독 감사합니다!`, speechGift: (name, n) => `${name} 님, 구독 ${n}개 감사합니다!`,
    lblGift: '구독 선물!', lblRaid: '명과 레이드!', lblGift0: '개 선물', unit: '명', ppl: (n) => `${n}명`, medal: (n) => `${n}명`,
    gift: '선물', victory: '대승리!!', extra: '호외!!', ex1: '호', ex2: '외', fleet: '함대, 전원 집합!', pass: ' ・ 승선권', notice1: '구독 1개 선물', tickerR: 'RAID ★ 대함대 습격 ★', viewer: '시청자' },
  en: {
    title: { sub: 'NEW SUB!', g1: 'GIFT SUB!', g5: 'GIFT ×{n}!', g10: 'GIFT ×{n}!!', g25: 'MEGA GIFT!!', g50: 'LEGENDARY!!', g100: 'GODLIKE!!', r1: 'RAID!', r2: 'RAID INCOMING!', r3: 'RAID ALERT!!', r4: 'MEGA RAID!!' },
    sub1Gift: (name) => `${name} gifted`, sub2Gift: (n) => subsEn(n), sub1Sub: (name) => `${name}`, sub2Sub: 'subscribed!', sub1Raid: (name) => `${name} is raiding`, sub2Raid: (n) => `with ${n} viewers`,
    nameGift: (name, n) => `${name} gifted ${subsEn(n)}`, nameSub: (name) => `${name} subscribed`, raidLine: (name, n) => `${name} raids with ${n}`,
    speechSub: (name) => `Thanks for the sub, ${name}!`, speechGift: (name, n) => `Thanks for ${subsEn(n)}, ${name}!`,
    lblGift: 'GIFT SUBS!', lblRaid: 'RAIDERS!', lblGift0: 'SUBS', unit: '', ppl: (n) => `×${n}`, medal: (n) => `×${n}`,
    gift: 'GIFT', victory: 'VICTORY!!', extra: 'EXTRA!!', ex1: 'EX', ex2: 'TRA', fleet: 'THE FLEET HAS ARRIVED!', pass: '', notice1: 'gifted 1 sub', tickerR: 'RAID ★ MEGA RAID ★', viewer: 'Viewer' },
};
const curLang = () => (L10N[P.lang] ? P.lang : 'zh-TW');
function LX(key, ...a) { const v = L10N[curLang()][key] ?? L10N['zh-TW'][key]; return typeof v === 'function' ? v(...a) : v; }
const ppl = (n) => LX('ppl', n);
const isLatinTitle = () => !/[぀-ヿ㐀-鿿가-힯]/.test(CFG.title);   // 英文標題：直書構圖改成整行轉 90 度

// ---------- 句型（覆寫原本寫死中文的版本） ----------
function nameLine() { return CFG.n ? LX('nameGift', P.name, CFG.n) : LX('nameSub', P.name); }
const raidLineL = () => LX('raidLine', P.name, CFG.n);
const _setTierL = window.setTier;
window.setTier = function (id, v) {
  if (!P.name || P.name === '觀眾') P.name = LX('viewer');
  const d = _setTierL(id, v), raid = !!(window.RAID && RAID[id]), tt = L10N[curLang()].title[id] ?? L10N['zh-TW'].title[id];
  if (tt) CFG.title = tt.replace('{n}', CFG.n);
  if (raid) { CFG.sub1 = LX('sub1Raid', P.name); CFG.sub2 = LX('sub2Raid', CFG.n); CFG.medalText = LX('medal', CFG.n); CFG.ticker = LX('tickerR'); }
  else if (CFG.n) { CFG.sub1 = LX('sub1Gift', P.name); CFG.sub2 = LX('sub2Gift', CFG.n); CFG.medalText = null; }
  else { CFG.sub1 = LX('sub1Sub', P.name); CFG.sub2 = LX('sub2Sub'); }
  if (id === 'g100') CFG.ticker = `PREMIUM ★ ${CFG.title.replace(/!+$/, '')} ★`;
  return d;
};
window.setLang = function (l) { P.lang = LANGS.includes(l) ? l : 'zh-TW'; for (const k of Object.keys(_tw)) delete _tw[k]; setTier(CFG.id, CFG.v); fontsForName(); };
window.LANGS = LANGS;

// ---------- 字型 ----------
// 標題字型：日文、英文用 Dela Gothic One；繁中遇到 Dela 沒有的字整行換 Noto Sans TC；韓文用 Black Han Sans；簡中用 Noto Sans SC。
function titleFont(txt) {
  const l = curLang();
  if (l === 'ko') return "200px 'Black Han Sans', 'Noto Sans KR'";
  if (l === 'zh-CN') return "900 200px 'Noto Sans SC'";
  if (l === 'zh-TW' && DELA_MISSING.test(txt)) return "900 200px 'Noto Sans TC'";
  return "200px 'Dela Gothic One', 'Noto Sans TC'";
}
function titleW(txt) { const k = curLang() + '|' + txt; if (_tw[k]) return _tw[k]; g.save(); g.font = titleFont(txt); const w = g.measureText(txt).width; g.restore(); return (_tw[k] = w); }
// 內文字型：程式裡到處寫死 'Noto Sans TC'／'Dela Gothic One'，這裡在「設定字型」的時候統一改寫，不用每個地方都改：
//   ・韓文、簡中：把 Dela Gothic One 換成該語言的標題字型（Dela 是日文字型，沒有韓文、簡體字也不全）
//   ・所有語言：Noto Sans TC 後面補上日、韓、簡的 Noto 當備用，觀眾名字是哪一國文字都有粗體可用
(function patchCanvasFont() {
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font'); if (!d || d.__v2) return;
  const cache = new Map();
  const rewrite = (v) => {
    const l = curLang(), key = l + '|' + v; let out = cache.get(key); if (out) return out;
    out = v;
    if (l === 'ko') out = out.replace(/'Dela Gothic One'/, "'Black Han Sans', 'Noto Sans KR'").replace(/'LXGW WenKai TC'/, "'Gaegu', 'LXGW WenKai TC'");
    else if (l === 'zh-CN') out = out.replace(/^(?:(?:\d{3}|bold)\s+)?(\d+(?:\.\d+)?px)\s+'Dela Gothic One'/, "900 $1 'Noto Sans SC'");
    const first = { ja: "'Noto Sans JP', 'Noto Sans TC'", ko: "'Noto Sans KR', 'Noto Sans TC'", 'zh-CN': "'Noto Sans SC', 'Noto Sans TC'" }[l] || "'Noto Sans TC'";
    if (/'Noto Sans TC'/.test(out)) out = out.replace(/'Noto Sans TC'/, first) + ", 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC'";
    else out += ", 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC'";
    if (cache.size > 600) cache.clear(); cache.set(key, out); return out;
  };
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, typeof v === 'string' ? rewrite(v) : v); } });
})();
const FONT_FAMS = ["150px 'Dela Gothic One'", "900 150px 'Noto Sans TC'", "900 150px 'Noto Sans JP'", "900 150px 'Noto Sans KR'", "900 150px 'Noto Sans SC'", "150px 'Black Han Sans'", "700 40px 'LXGW WenKai TC'", "700 40px 'Gaegu'"];
function fontsForName() { for (const f of FONT_FAMS) { try { document.fonts.load(f, P.name); } catch (e) {} } }   // 名字可能是任何語言：先叫瀏覽器把需要的字型分片抓回來
const _lvaL = window.loadVarAssets;
window.loadVarAssets = async function () {
  if (_lvaL) await _lvaL();
  const s = (window.__V2_TEXT || '') + P.name + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789×!?★…';
  for (const f of FONT_FAMS) { try { await document.fonts.load(f, s); } catch (e) {} }
};
const _setNameL = window.setName;
window.setName = (n) => { _setNameL(n); fontsForName(); };
