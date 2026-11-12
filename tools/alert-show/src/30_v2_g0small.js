
// ======================= V2 訂閱／少量：小卡整體放大（原本字太小，直播畫面上讀不清楚） =======================
function scaledVar(fn, ax, ay, s0) { return (ctx, t) => { const s = typeof s0 === 'function' ? s0() : s0; ctx.save(); ctx.translate(ax, ay); ctx.scale(s, s); ctx.translate(-ax, -ay); fn(ctx, t); ctx.restore(); }; }
const nameUnits = () => Array.from(P.name).reduce((a, ch) => a + (ch.codePointAt(0) > 0x2E80 ? 1 : 0.55), 0);
for (const i of [1, 2, 3]) VARS.sub[i].fn = scaledVar(VARS.sub[i].fn, 0, H, 1.32);
VARS.sub[4].fn = scaledVar(VARS.sub[4].fn, W, H, () => (nameUnits() > 9 ? 1.0 : 1.18));   // 對話框往左長，名字太長就不放大，免得超出畫面
for (const i of [1, 2, 3, 4]) VARS.g1[i].fn = scaledVar(VARS.g1[i].fn, 0, H, 1.32);
