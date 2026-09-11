/** Elitesand Pro — 風息成字. Adapted from the user-supplied VIII demo.
 * Native template lifecycle; no independent clock, audio, controls or background.
 * All animation is a deterministic function of the shared adjusted media time.
 */
(function () {
  'use strict';
  if (typeof LyricTemplates === 'undefined' || typeof LyricTemplateSettings === 'undefined') return;
  function createRenderer(canvas) {
    const ctx=canvas.getContext('2d');
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)), ease=v=>1-Math.pow(1-clamp(v),3), smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}):null;
const chars=s=>segmenter?Array.from(segmenter.segment(s),x=>x.segment):Array.from(s);
const sans='"Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei","PingFang TC",system-ui,sans-serif';
const font='"Noto Serif TC","Noto Serif CJK TC","Source Han Serif TC","Songti TC","Noto Serif CJK SC","PMingLiU","Yu Mincho","Batang",serif';
let W=1600,H=900,dpr=1,lines=[],layouts=[],t=0,intensity=1,reduced=false;
let entrance='auto';
// Typography + composition knobs, pulled from the shared lyric settings in settings().
// stroke/shadow come from the shared classic 描邊·陰影 controls (--lyric-stroke-*/--lyric-shadow).
const FONT_DEFAULT=font,SANS_DEFAULT=sans;
let typo={family:'',weight:0,sizeScale:1,letterSpacing:0,hpos:'center',vjustify:'center',orient:'horizontal',padX:60,padY:48,safeMargin:2,offX:0,offY:0,
  shadow:{on:true,color:'rgba(8,5,13,0.94)',blur:7,dy:1.3}};
let palette={ink:'#f6f0e5',a:'#e97855',inkOpacity:1,aOpacity:1};
const roleFont=isLead=>typo.family||(isLead?SANS_DEFAULT:FONT_DEFAULT);
const bodyWeight=()=>typo.weight||400,heroWeight=()=>Math.min(900,(typo.weight||400)+100);
// Composition and morphing engine. Typography is the geometry; no decorative particle emitter.
const maskCache=new Map(),modelCache=new Map();let particleCount=0;
const mix=(a,b,v)=>a+(b-a)*v;
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
// 2026-09-12：從直書句流的「漂字」進場（lyric-template-columnflow.js #cf-quad-drift）
// 視覺重現到這裡，當「逐字進場」設定裡可選的第二種風格（settings 的 particleEntrance，
// 見 register() 與下面 settings() 讀 data.particleEntrance）——選了才會整首都用，
// 不是混進 stream/rain/vortex/twin 的自動輪替：整字從四角（左上/右上/左下/右下）帶弧度
// ＋輕微旋轉/模糊漂入定點、入場後完全靜止，不是逐字碎成塵粒，跟自動輪替那四種質感刻意
// 不同。出場一律沿用既有的塵粒散開（drawMotes 的 outgoing 分支，entryKind 對不認得的
// kind 字串本來就會落到預設散開樣式），不特別為這個進場另做退場效果。
const QUAD_DIRS=[[-1.2,-1.0],[1.15,-1.0],[-1.1,1.1],[1.2,.95]]; // em：左上/右上/左下/右下，跟 columnflow 的 DRIFT_DIRS 相同
const QUAD_PARAMS={calm:{dist:.6,blur:.5,rot:.35,dur:.36},normal:{dist:1,blur:1,rot:1,dur:.44},chaotic:{dist:1.55,blur:1.6,rot:1.9,dur:.50}};
const quadEase=t=>{t=clamp(t);return 1-Math.pow(1-t,3)};
function quadParams(){return QUAD_PARAMS[typo.intensityKey]||QUAD_PARAMS.normal}
/** 對照 cf-quad-drift 的 0%/70%/100% 關鍵畫格：先漂入＋輕微回彈(70%)，再完全靜止(100%)。 */
function quadDriftPose(g,time){
 const p=quadParams(),dir=QUAD_DIRS[g.index%4];
 const u=clamp((time-g.start)/Math.max(.05,p.dur));
 const qx=dir[0]*g.size*p.dist,qy=dir[1]*g.size*p.dist;
 const qr=(dir[0]>0?-7:7)*(1+(g.index%3)*.14)*p.rot;
 let x,y,rot,scale,blur;
 if(u>=1){x=0;y=0;rot=0;scale=1;blur=0}
 else if(u<=.7){const t=quadEase(u/.7);x=mix(qx,qx*-.06,t);y=mix(qy,qy*-.06,t);rot=mix(qr,0,t);scale=mix(.9,1.008,t);blur=mix(2.4*p.blur,0,t)}
 else{const t=quadEase((u-.7)/.3);x=mix(qx*-.06,0,t);y=mix(qy*-.06,0,t);rot=0;scale=mix(1.008,1,t);blur=0}
 return{x,y,rot,scale,blur,alpha:u<=0?0:Math.min(1,u/.5)};
}
function drawQuadDriftGlyph(g,time,color,opacity){
 const v=quadDriftPose(g,time),alpha=clamp(v.alpha*opacity);
 if(alpha<.003||!g.g.trim())return;
 ctx.save();
 ctx.translate(g.x+g.w*.5+v.x,g.y-g.size*.39+v.y);
 ctx.rotate(v.rot*Math.PI/180);ctx.scale(v.scale,v.scale);
 if(v.blur>.03)ctx.filter=`blur(${v.blur}px)`;
 setFont(g.size,g.family,g.weight);ctx.globalAlpha=alpha;ctx.fillStyle=color;
 ctx.fillText(g.g,-g.w*.5,g.size*.39);
 if(v.blur>.03)ctx.filter='none';
 ctx.restore();
}
function setFont(size,family=font,weight=400,target=ctx){target.font=`${weight} ${size}px ${family}`;target.textBaseline='alphabetic'}
function widthOf(gs,size,family=font,weight=400){setFont(size,family,weight);return Math.max(0,gs.reduce((sum,g)=>sum+ctx.measureText(g).width+size*.028,0)-size*.028)}
function split(gs,size,maxWidth,family=font){const result=[];let row=[],width=0;setFont(size,family);for(const g of gs){const w=ctx.measureText(g).width+size*.028;if(row.length&&width+w>maxWidth){let cut=row.length;for(let j=row.length-1;j>row.length*.40;j--){if(/[\s，、,]/u.test(row[j])){cut=j+1;break}}result.push(row.slice(0,cut));row=row.slice(cut);width=widthOf(row,size,family)}row.push(g);width+=w}if(row.length)result.push(row);return result}
function breakPhrase(gs){const target=Math.round(gs.length*.53);let cut=target,best=Infinity;for(let i=Math.ceil(gs.length*.26);i<gs.length*.76;i++){if(/[\s，、,:：—]/u.test(gs[i])){const score=Math.abs(i-target);if(score<best){best=score;cut=i+1}}}return [gs.slice(0,cut),gs.slice(cut)]}
// 換行：空白＝硬斷行（整段拆開，空白 token 丟掉），段內再依寬度軟斷（回退到、，處）。
// toks 是 {g,i}（i＝原字串位置，讓 heroSet／schedule 對得上），回傳 rows: {g,i}[][]。
function wrapTokens(toks,size,maxW,family){
 setFont(size,family);const sp=size*.028;const rows=[];let seg=[];
 const flush=()=>{
  if(!seg.length)return;
  let row=[],width=0;
  for(const tk of seg){
   const w=ctx.measureText(tk.g).width+sp;
   if(row.length&&width+w>maxW){
    let cut=row.length;
    for(let j=row.length-1;j>row.length*.4;j--){if(/[，、,]/u.test(row[j].g)){cut=j+1;break}}
    rows.push(row.slice(0,cut));row=row.slice(cut);
    width=row.reduce((a,r)=>a+ctx.measureText(r.g).width+sp,0);
   }
   row.push(tk);width+=w;
  }
  if(row.length)rows.push(row);
 };
 for(const tk of toks){if(/^\s+$/u.test(tk.g)){flush();seg=[]}else seg.push(tk)}
 flush();
 return rows.length?rows:[toks.filter(tk=>!/^\s+$/u.test(tk.g))];
}
function makeLayout(line,number){
 // Typeface + weight roles come from the shared lyric settings; unset falls back to the
 // built-in Sans/Serif pairing. These shadow the module-level `sans`/`font` for this function.
 const sans=roleFont(true),font=roleFont(false),bw=bodyWeight(),hw=heroWeight(),ls=typo.letterSpacing;
 const gs=chars(line.text),units=widthOf(gs,100,font)/100;let groups=[];
 const schedule=[];if(line.words)for(const word of line.words){const ws=chars(word.text);ws.forEach((g,i)=>schedule.push({start:word.start+(word.end-word.start)*i/ws.length,end:word.start+(word.end-word.start)*(i+1)/ws.length}));}
 // Hero = the phrase around the longest-held note, not a single glyph. Grow a contiguous
 // span outward from the peak while neighbours share the same held word (no punctuation /
 // whitespace boundary, hold within ~45% of the peak), capped so it never eats a long line.
 const holds=gs.map((g,i)=>{if(!/[\p{L}\p{N}]/u.test(g))return -1;const s=schedule[i];return s?Math.max(.001,s.end-s.start):1;});
 let peak=-1,peakHold=0;for(let i=0;i<holds.length;i++)if(holds[i]>peakHold){peakHold=holds[i];peak=i}
 const heroSet=new Set();
 if(peak>=0){
  const boundary=i=>i<0||i>=gs.length||holds[i]<0||/[\s，、,。.!?？！；;：:—…·「」『』（）()\[\]【】]/u.test(gs[i]);
  const floor=Math.max(peakHold*.45,peakHold-.35),cap=Math.max(2,Math.floor(gs.length*.4));
  heroSet.add(peak);
  for(let i=peak-1;i>=0&&peak-i<6&&!boundary(i)&&holds[i]>=floor;i--)heroSet.add(i);
  for(let i=peak+1;i<gs.length&&i-peak<6&&!boundary(i)&&holds[i]>=floor;i++)heroSet.add(i);
  if(heroSet.size>cap){heroSet.clear();heroSet.add(peak)}
 }
 // 2026-09-12 使用者回饋：放大／變色的 hero 字視覺上很醜，停用。保留上面的
 // peak/hold 偵測邏輯（可能之後用在別處），但一律清空、不選字——下游所有
 // isHero/g.hero 分支因此自然全部走「一般字」路徑，字級／字重／顏色／粒子量/
 // 進場時長全體統一，不必逐一改各自的三元運算。
 heroSet.clear();
 const heroIdx=[...heroSet].sort((a,b)=>a-b);
 const hero=heroIdx.length?{indices:heroIdx,text:heroIdx.map(i=>gs[i]).join('')}:null;
 const factor=units>19?1.85:2.22;
 // ── Vertical (直書) composition: stack glyphs top→bottom in 1–2 right-to-left columns. ──
 // Particle assembly is orientation-agnostic (mask coords are local), so only the glyph
 // targets change; the fly-in choreography is identical to horizontal.
 const mX=clamp(typo.padX,W*.03,W*.34),mY=clamp(typo.padY,H*.03,H*.32);
 if(typo.orient==='vertical'){
  const band0=mY,band1=H-mY,bandH=band1-band0;
  const ranges=[];{const parts=gs.length>14?breakPhrase(gs):[gs];let s=0;for(const p of parts){ranges.push([s,s+p.length]);s+=p.length}}
  const spanH=(b,s,e)=>{let h=0;for(let i=s;i<e;i++)h+=b*(heroSet.has(i)?factor:1)*1.06+ls*b/48;return h};
  // 字級跟著共用「字級」設定走（跟橫排一致）；上限＝最長那一欄還塞得下的最大字。
  const longest=Math.max(...ranges.map(([s,e])=>e-s));
  const colCap=Math.min(bandH/(longest*1.12+1),W*.14);
  let base=clamp(64*typo.sizeScale*1.15,H*.026,colCap);
  for(let k=0;k<24&&Math.max(...ranges.map(([s,e])=>spanH(base,s,e)))>bandH;k++)base*=.94;
  const colGap=base*1.55,totalW=ranges.length*colGap-(colGap-base);
  const vGap=(typo.safeMargin/100)*W;// 跟鏡像／紙帶同語意：margin% 是「離中線的百分比」
  let blockX;
  // 靠左／靠右／左右分散一律往安全區內側靠（跟橫排同一套意圖）：兩個候選 x 是
  // 貼外緣（mX± totalW/2）vs 貼安全區內側（W/2∓vGap∓totalW/2）；預設取離中心較近的
  // 那個，只有欄位寬到會反過來蓋過外緣時才退回貼外緣（避免超出可用畫面）。
  // 純左／純右跟 split 的判斷條件相同，因此共用同一組公式。
  if(typo.hpos==='left'||(typo.hpos==='split'&&number%2===0)){
   blockX=Math.max(mX+totalW*.5,W*.5-vGap-totalW*.5);
  }else if(typo.hpos==='right'||(typo.hpos==='split'&&number%2!==0)){
   blockX=Math.min(W-mX-totalW*.5,W*.5+vGap+totalW*.5);
  }else{
   blockX=W*.5;
  }
  blockX=clamp(blockX,mX+totalW*.5,Math.max(mX+totalW*.5,W-mX-totalW*.5));
  const words=[],vgroups=[];let idx=0;
  ranges.forEach(([s,e],c)=>{
   const cx=blockX+totalW*.5-base*.5-c*colGap;
   const colH=spanH(base,s,e);
   let py=typo.vjustify==='start'?band0:typo.vjustify==='end'?band1-colH:band0+(bandH-colH)*.5;
   const specs=[];
   for(let i=s;i<e;i++){
    const isHero=heroSet.has(i),size=base*(isHero?factor:1),family=isHero||c===ranges.length-1?font:sans;
    setFont(size,family,isHero?hw:bw);const w=ctx.measureText(gs[i]).width,sch=schedule[i];
    py+=size;
    const spec={g:gs[i],index:idx++,hero:isHero,size,family,weight:isHero?hw:bw,w,x:cx-w*.5,y:py,row:c,start:sch?sch.start:line.start,end:sch?sch.end:line.end};
    words.push(spec);specs.push(spec);
    py+=size*.06+ls*size/48;
   }
   vgroups.push({x:cx-base*.5,y:band0,width:base,height:colH,specs});
  });
  const hw2=words.filter(g=>g.hero);
  return{words,groups:vgroups,size:Math.max(...words.map(g=>g.size)),top:Math.min(...words.map(g=>g.y-g.size)),bottom:Math.max(...words.map(g=>g.y)),lineTimed:!line.words,rows:vgroups.length,number,heroText:hero?.text||'',heroIndex:hero?.indices[0]??-1,heroStart:hw2.length?Math.min(...hw2.map(g=>g.start)):line.start,heroEnd:hw2.length?Math.max(...hw2.map(g=>g.end)):line.end};
 }
 // ── Horizontal composition: a subtitle-scale block inside a real safe-zone margin box. ──
 // 靠左／靠右／左右分散：整塊只能佔用自己那半邊（≤ 畫面 42%），絕不跨過中央安全距離。
 const box={l:mX,r:W-mX,t:mY,b:H-mY},boxH=box.b-box.t;
 // margin% 是「離中線的百分比」，跟鏡像／紙帶完全同語意；capW 再夾一個 42% 上限。
 const gapC=(typo.safeMargin/100)*W,capW=W*.42,leftSide=number%2===0;
 let colL=box.l,colR=box.r;
 if(typo.hpos==='left'||(typo.hpos==='split'&&leftSide)){colR=Math.min(box.r,box.l+capW,W*.5-gapC);}
 else if(typo.hpos==='right'||(typo.hpos==='split'&&!leftSide)){colL=Math.max(box.l,box.r-capW,W*.5+gapC);}
 const colW=Math.max(160,colR-colL);
 const heroFactor=Math.min(factor,1.55);
 const toks=gs.map((g,i)=>({g,i}));
 let base=clamp(64*typo.sizeScale*1.2,22,boxH*0.30);
 let rows=wrapTokens(toks,base,colW,font);
 for(let k=0;k<50&&(rows.length>5||rows.length*base*1.34>boxH);k++){base*=.93;rows=wrapTokens(toks,base,colW,font)}
 groups=rows.map((r,i)=>({toks:r,family:(rows.length>1&&i%2)?sans:font,weight:bw}));
 groups.forEach(group=>{
  group.specs=group.toks.map(tk=>{const n=tk.i,isHero=heroSet.has(n),size=base*(isHero?heroFactor:1),family=isHero?font:group.family;setFont(size,family,isHero?hw:bw);return{g:tk.g,index:n,hero:isHero,size,family,weight:isHero?hw:bw,w:ctx.measureText(tk.g).width}});
  const width=group.specs.reduce((a,g)=>a+g.w+g.size*(g.hero?.08:.04)+ls*g.size/48,0);
  const fit=Math.min(1,colW/Math.max(1,width));group.specs.forEach(g=>{g.size*=fit;g.w*=fit});
  group.width=width*fit;group.height=Math.max(0,...group.specs.map(g=>g.size));
 });
 const lineGap=base*0.42;
 const total=groups.reduce((a,g)=>a+g.height,0)+lineGap*(groups.length-1);
 const vfit=Math.min(1,boxH/Math.max(1,total));
 if(vfit<1)groups.forEach(group=>{group.height*=vfit;group.width*=vfit;group.specs.forEach(g=>{g.size*=vfit;g.w*=vfit})});
 const totalH=groups.reduce((a,g)=>a+g.height,0)+lineGap*vfit*(groups.length-1);
 let y=typo.vjustify==='start'?box.t:typo.vjustify==='end'?box.b-totalH:box.t+(boxH-totalH)*.5,words=[];
 // 靠左／靠右／左右分散，一律往安全區（欄位內側）靠，不往螢幕外緣靠：
 // 左欄（純左，或 split 的 leftSide）＝ colL..colR 這段的內側是 colR → 靠右對齊；
 // 右欄（純右，或 split 的另一側）＝ colL..colR 這段的內側是 colL → 靠左對齊。
 // 跟上面判斷「這是左欄還是右欄」用的是同一個條件（isLeftCol/isRightCol），
 // 純左右跟 split 因此走同一套，不再分開處理。
 const isLeftCol=typo.hpos==='left'||(typo.hpos==='split'&&leftSide);
 const isRightCol=typo.hpos==='right'||(typo.hpos==='split'&&!leftSide);
 const alignRight=isLeftCol;
 const alignLeft=isRightCol;
 groups.forEach((group,row)=>{
  y+=group.height;group.y=y;
  group.x=alignLeft?colL:alignRight?colR-group.width:colL+(colW-group.width)*.5;
  group.x=clamp(group.x,colL,Math.max(colL,colR-group.width));
  let pen=group.x;
  for(const spec of group.specs){const sch=schedule[spec.index];words.push({...spec,x:pen,y,row,start:sch?sch.start:line.start,end:sch?sch.end:line.end});pen+=spec.w+spec.size*(spec.hero?.08:.04)+ls*spec.size/48}
  y+=lineGap*vfit;
 });
 const heroWords=words.filter(g=>g.hero),heroStart=heroWords.length?Math.min(...heroWords.map(g=>g.start)):line.start,heroEnd=heroWords.length?Math.max(...heroWords.map(g=>g.end)):line.end;
 return{words,groups,size:Math.max(...words.map(g=>g.size)),top:Math.min(...words.map(g=>g.y-g.size)),bottom:Math.max(...words.map(g=>g.y)),lineTimed:!line.words,rows:groups.length,number,heroText:hero?.text||'',heroIndex:hero?.indices[0]??-1,heroStart,heroEnd};}
function build(){layouts=[];modelCache.clear()}
function layoutAt(i){return layouts[i]||(layouts[i]=makeLayout(lines[i],i))}
function resize(){const r=canvas.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);build();draw(t)}
function glyph(g,x,y,size,color,alpha,_legacy=false,shadow=false,family=font,weight=400){
 if(alpha<.003||!g.trim())return;
 ctx.globalAlpha=clamp(alpha);setFont(size,family,weight);ctx.fillStyle=color;
 if(shadow&&typo.shadow.on){ctx.shadowColor=typo.shadow.color;ctx.shadowBlur=Math.min(typo.shadow.blur*1.6,size*.28);ctx.shadowOffsetY=typo.shadow.dy}
 ctx.fillText(g,x,y);
 if(shadow){ctx.shadowBlur=0;ctx.shadowOffsetY=0}
}
function print(g,color,alpha,dx=0,dy=0,scale=1,stroke=false){glyph(g.g,g.x+dx-(scale-1)*g.w*.5,g.y+dy,g.size*scale,color,alpha,false,!stroke,g.family,g.weight)}
function maskFor(g){
 const key=g.family+'|'+g.weight+'|'+g.g;if(maskCache.has(key))return maskCache.get(key);
 const c=document.createElement('canvas');c.width=290;c.height=238;const m=c.getContext('2d',{willReadFrequently:true});
 setFont(160,g.family,g.weight,m);m.fillStyle='white';m.fillText(g.g,24,188);
 const data=m.getImageData(0,0,290,238).data,points=[];
 for(let y=4;y<236;y+=2)for(let x=2;x<288;x+=2)if(data[(y*290+x)*4+3]>90)points.push({x:(x-24)/160,y:(y-188)/160});
 if(maskCache.size>=256)maskCache.delete(maskCache.keys().next().value);maskCache.set(key,points);return points;
}
// VIII: a coherent spatial field drives both curved travel and local ink absorption.
// Time is still deterministic. No simulation state or frame-dependent random jitter.
function particlePhase(g,L,time){
 const line=lines[L.number],span=Math.max(.04,g.end-g.start),breath=hash(g.index*31+L.number*709);
 const lead=L.lineTimed?0:clamp(span*(g.hero?1.36:1.65),g.hero?.96:.52,g.hero?1.42:.86)*(.91+breath*.16);
 const begin=L.lineTimed?line.start:Math.max(line.start-.10,g.start-lead);
 const finish=L.lineTimed?line.start+Math.min(.92,(line.end-line.start)*.65):g.start+Math.min(.12,span*.23);
 const u=clamp((time-begin)/Math.max(.15,finish-begin));
 const exitAt=Math.max(g.end+.06,line.end-.26+hash(g.index*19+L.number)*.15);
 const out=clamp((time-exitAt)/.92);
 return{u,out,begin,finish,exitAt,entering:time>=begin&&u<1,leaving:time>=exitAt&&out<1,visible:time>=begin&&out<1};
}
function particleModel(g,L){
 const key=L.number+':'+g.index;if(modelCache.has(key))return modelCache.get(key);
 const mask=maskFor(g);
 if(!L.particleWeight)L.particleWeight=L.words.reduce((sum,w)=>sum+(w.g.trim()?Math.max(w.w,w.size*.25)*w.size:0),0)||1;
 const share=(W<500?6000:11000)*Math.max(g.w,g.size*.25)*g.size/L.particleWeight;
 const n=Math.min(mask.length,Math.max(24,Math.min(g.hero?2700:850,Math.round(share))));
 const points=[];for(let k=0;k<n;k++){const j=Math.floor(k*mask.length/n);points.push({...mask[j],id:j,r:.72+hash(k*17)*.28})}
 // Particle density is bounded while flying; completed regions are solid ink.
 const radius=clamp(g.size*.0046*Math.sqrt(mask.length/Math.max(1,n)),.42,g.hero?2.25:1.35);
 const xs=mask.map(q=>q.x),ys=mask.map(q=>q.y);const bounds={left:Math.min(...xs)-.009,right:Math.max(...xs)+.009,top:Math.min(...ys)-.009,bottom:Math.max(...ys)+.009};const model={points,radius,bounds,seed:hash(g.index*83+L.number*391)*6.28};modelCache.set(key,model);return model;
}
function drawDots(target,points,radius,color,alpha=1){
 target.fillStyle=color;
 // Quantized opacity batching keeps the organic fade affordable on mobile.
 for(let band=0;band<8;band++){
  target.globalAlpha=alpha*(band+.5)/8;target.beginPath();
  for(const q of points){if(Math.min(7,Math.floor(q.alpha*8))!==band||q.alpha<.012)continue;const r=radius*q.r;target.moveTo(q.x+r,q.y);target.arc(q.x,q.y,r,0,Math.PI*2)}target.fill();
 }
}
function entryKind(g,L){return entrance==='auto'?['stream','rain','vortex','twin'][L.number%4]:entrance}
function flowField(point,model,kind){
 const b=model.bounds,x=clamp((point.x-b.left)/(b.right-b.left)),y=clamp((point.y-b.top)/(b.bottom-b.top)),s=model.seed||0;
 // Low-frequency variation connects neighbouring grains into currents, not white noise.
 const wave=Math.sin(x*5.1+y*3.7+s)*.095+Math.sin(y*9.2-x*2.8+s*1.7)*.045+Math.sin(x*14+y*11+s*.6)*.018;
 const direction=kind==='rain'?y:kind==='vortex'?.64*x+.36*y:kind==='twin'?1-Math.abs(x-.5)*2:x;
 const rank=clamp(.10+.80*direction+wave);
 const arrival=.35+.55*rank;
 const travel=.29+.12*(.5+.5*Math.sin(y*4.9-x*3.2+s));
 return{rank,arrival,travel,x,y};
}
function inkAmount(progress,arrival){return smooth((progress-arrival-.012)/.070)}
const soft=v=>{v=clamp(v);return v*v*v*(v*(v*6-15)+10)};
function motePosition(g,point,j,progress,outgoing,L){
 const model=particleModel(g,L),kind=entryKind(g,L),f=point.flow?.[kind]||flowField(point,model,kind);
 const seed=j*13+g.index*401+L.number*7901,a=hash(seed),b=hash(seed+2),c=hash(seed+9);
 const arrival=f.arrival-(a*.014),travel=f.travel*(.94+b*.12);
 const local=outgoing?clamp((progress-f.rank*.24)/.70):clamp((progress-(arrival-travel))/travel);
 const u=soft(local),v=1-u,scale=intensity*g.size,vertical=1;
 const lane=Math.sin(f.y*5.4+model.seed)*.5+Math.sin(f.x*3.1+model.seed)*.22;
 let ox,oy,c1x,c1y,c2x,c2y;
 if(kind==='stream'){
  ox=-1.20-b*.95;oy=lane*.48+(a-.5)*.30;
  c1x=ox*.72;c1y=oy+(.26+lane*.32);c2x=-.20-c*.16;c2y=-.12+lane*.17;
 }else if(kind==='rain'){
  ox=lane*.44+(a-.5)*.30;oy=-1.25-b*.85;
  c1x=ox+.24;c1y=oy*.65;c2x=-.14+lane*.25;c2y=-.24-c*.16;
 }else if(kind==='vortex'){
  const angle=lane*2.5+f.y*2.8+a*.7+model.seed*.3,r=.92+b*.68;
  ox=Math.cos(angle)*r;oy=Math.sin(angle)*r*.76;
  c1x=ox-Math.sin(angle)*.95;c1y=oy+Math.cos(angle)*.75;
  c2x=Math.cos(angle+1.7)*.24;c2y=Math.sin(angle+1.7)*.24;
 }else{
  const side=f.x<.5?-1:1;ox=side*(1.10+b*.82);oy=lane*.56+(a-.5)*.25;
  c1x=ox*.60;c1y=oy+side*.38;c2x=side*.22;c2y=-side*.13+lane*.14;
 }
 let dx=v*v*v*ox+3*v*v*u*c1x+3*v*u*u*c2x,dy=v*v*v*oy+3*v*v*u*c1y+3*v*u*u*c2y;
 // A small curl decays smoothly as each particle joins the letter. Nothing oscillates at rest.
 const curl=Math.sin(Math.PI*u)**2*.045;
 dx+=Math.sin(u*5+f.y*6+model.seed)*curl;dy+=Math.cos(u*4+f.x*5+model.seed)*curl;
 if(outgoing){dx=u*(.72+f.y*.28+b*.48);dy=u*(-.18+lane*.36)+Math.sin(Math.PI*u)*(.10+lane*.08)}
 return{x:g.x+point.x*g.size+dx*scale,y:g.y+point.y*g.size+dy*scale*vertical,rank:f.rank,local,arrival:f.arrival};
}
function inkLayer(g,L,model,kind){
 if(model.ink?.kind===kind)return model.ink;
 const c=document.createElement('canvas');c.width=290;c.height=238;const m=c.getContext('2d',{willReadFrequently:true});
 setFont(160,g.family,g.weight,m);m.fillStyle='white';m.fillText(g.g,24,188);
 const pixels=m.getImageData(0,0,290,238),cells=[];
 for(let y=0;y<238;y++)for(let x=0;x<290;x++){const i=(y*290+x)*4;if(!pixels.data[i+3])continue;
  const f=flowField({x:(x-24)/160,y:(y-188)/160},model,kind);cells.push({i,alpha:pixels.data[i+3],arrival:f.arrival,rank:f.rank});}
 return model.ink={kind,c,m,pixels,cells,color:null};
}
function revealInk(g,L,model,progress,color,alpha,outgoing=false){
 if(alpha<.002||(!outgoing&&progress<=.35))return;
 if(!outgoing&&progress>=.99){print(g,color,alpha);return}
 const layer=inkLayer(g,L,model,entryKind(g,L)),data=layer.pixels.data;
 if(layer.color!==color){const n=parseInt(color.slice(1),16);for(const cell of layer.cells){data[cell.i]=n>>16;data[cell.i+1]=(n>>8)&255;data[cell.i+2]=n&255}layer.color=color}
 for(const cell of layer.cells){const coverage=outgoing?1-smooth(clamp((progress-cell.rank*.24)/.70)/.20):inkAmount(progress,cell.arrival);data[cell.i+3]=Math.round(cell.alpha*coverage)}
 layer.m.putImageData(layer.pixels,0,0);
 const dx0=g.x-24/160*g.size,dy0=g.y-188/160*g.size,dw=290/160*g.size,dh=238/160*g.size;
 // 陰影跟著聚攏進度淡入，不是等字完成才「啪」地出現。
 const fx=outgoing?clamp(1-smooth(progress)):smooth(clamp((progress-.35)/.5));
 ctx.save();
 if(typo.shadow.on&&fx>.02){
  ctx.globalAlpha=alpha*fx;
  ctx.shadowColor=typo.shadow.color;ctx.shadowBlur=Math.min(typo.shadow.blur*1.6,g.size*.28);ctx.shadowOffsetY=typo.shadow.dy;
  ctx.drawImage(layer.c,dx0,dy0,dw,dh);
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
 }
 ctx.globalAlpha=alpha;ctx.drawImage(layer.c,dx0,dy0,dw,dh);
 ctx.restore();
}
function drawMotes(g,L,state,p,opacity){
 opacity*=g.hero?p.aOpacity:p.inkOpacity;
 const model=particleModel(g,L),color=g.hero?p.a:p.ink,kind=entryKind(g,L);
 if(!model.points.length){if(!state.entering&&!state.leaving)print(g,color,opacity);return}
 const outgoing=state.leaving,progress=outgoing?state.out:state.u;
 if(!state.entering&&!outgoing){print(g,color,opacity);return}
 revealInk(g,L,model,progress,color,opacity,outgoing);
 const positions=[];
 for(const pt of model.points){
  if(!pt.flow)pt.flow={};if(!pt.flow[kind])pt.flow[kind]=flowField(pt,model,kind);
  const f=pt.flow[kind],ink=outgoing?0:inkAmount(progress,f.arrival);
  if(!outgoing&&ink>=.999)continue;
  const q=motePosition(g,pt,pt.id,progress,outgoing,L);
  const alpha=outgoing?smooth(q.local/.14)*(1-smooth((q.local-.12)/.88)):smooth(q.local/.22)*(1-ink);
  if(alpha<.012)continue;
  positions.push({...q,r:pt.r*(.82+.18*smooth(q.local)),alpha,pt});
 }
 particleCount+=positions.length;if(!positions.length)return;
 ctx.save();ctx.strokeStyle=color;ctx.lineWidth=model.radius*.60;ctx.beginPath();ctx.globalAlpha=opacity*.13;
 for(let k=0;k<positions.length;k+=4){const q=positions[k];if(q.alpha<.3)continue;const prev=motePosition(g,q.pt,q.pt.id,Math.max(0,progress-.007),outgoing,L);const len=Math.hypot(q.x-prev.x,q.y-prev.y)||1,f=Math.min(1,4/len);ctx.moveTo(q.x-(q.x-prev.x)*f,q.y-(q.y-prev.y)*f);ctx.lineTo(q.x,q.y)}ctx.stroke();
 drawDots(ctx,positions,model.radius,color,opacity);ctx.restore();
}
// A complete glyph travels along one soft path. No slicing, flipping, elastic bounce or shear.
// Hero size is reserved by layout; its sustained-note growth fits inside that reservation.
function letterPose(g,L,time){
 const span=Math.max(.045,g.end-g.start),age=time-g.start,moving=!reduced&&intensity>0;
 const enter=clamp(span*(g.hero?.78:.85),.17,g.hero?.62:.44),lead=L.lineTimed?0:Math.min(.10,span*.22);
 const u=clamp((age+lead)/enter),remaining=1-ease(u),power=intensity;
 const dir=[[-1,1],[1,-1],[-1,-1],[1,1]][(g.index+L.number)%4];
 const longSpan=L.heroEnd-L.heroStart;
 const held=g.hero&&!L.lineTimed?Math.sin(Math.PI*clamp((time-L.heroStart)/Math.max(.1,longSpan))):0;
 const active=!L.lineTimed&&age>=0&&time<g.end;
 const onset=L.lineTimed?lines[L.number].start:g.start-lead;
 const alpha=smooth((time-onset)/Math.min(.13,enter));
 let x=moving?dir[0]*g.size*(g.hero?.10:.22)*remaining*power:0;
 let y=moving?g.size*(g.hero?.24:.29)*remaining*power*(g.hero?1:dir[1]):0;
 // The note opens once, gradually; ordinary characters keep their full shape and scale.
 const scale=moving&&g.hero?1-.10*remaining+.045*held*power:1;
 if(moving&&g.hero)y-=g.size*.012*held*power;
 const exitStart=Math.max(g.end,lines[L.number].end-.26);
 const leave=smooth((time-exitStart)/Math.max(.08,lines[L.number].end-exitStart));
 if(moving)y-=leave*g.size*.10*power;
 return{x,y,sx:scale,sy:scale,rot:0,shear:0,split:0,u,dir,held,remaining,power,active,alpha:alpha*(1-leave)};
}
function posedGlyph(g,v,color,alpha,dx=0,dy=0,stroke=false){
 if(alpha<.003||!g.g.trim())return;
 ctx.save();ctx.translate(g.x+g.w*.5+v.x+dx,g.y-g.size*.39+v.y+dy);ctx.scale(v.sx,v.sy);
 glyph(g.g,-g.w*.5,g.size*.39,g.size,color,alpha,false,!stroke,g.family,g.weight);ctx.restore();
}
function renderLine(line,L,time,p,opacity=1){
 ctx.save();
 // Give the Hero first use of the bounded particle budget, including in long-line exits.
 const ordered=[...L.words.filter(g=>g.hero),...L.words.filter(g=>!g.hero)];
 for(const g of ordered){
  if(!g.g.trim())continue;const state=particlePhase(g,L,time);if(!state.visible)continue;
  if(reduced||intensity<=0){const v=letterPose(g,L,time);posedGlyph(g,{...v,x:0,y:0,sx:1,sy:1},g.hero?p.a:p.ink,v.alpha*opacity*(g.hero?p.aOpacity:p.inkOpacity));continue}
  // quaddrift 只換「進場」的畫法（整字漂入，不是塵粒）；一旦進入 leaving（唱完退場）
  // 一律落回 drawMotes 的塵粒散開，跟其他四種進場共用同一套出場。
  if(entryKind(g,L)==='quaddrift'&&state.entering&&!state.leaving){drawQuadDriftGlyph(g,time,g.hero?p.a:p.ink,opacity*(g.hero?p.aOpacity:p.inkOpacity));continue}
  drawMotes(g,L,state,p,opacity);
 }
 ctx.restore();
}

function draw(time){
 t=Number.isFinite(time)?time:0;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);particleCount=0;
 if(typo.offX||typo.offY)ctx.translate(typo.offX,typo.offY);// 水平／垂直微調：整塊平移
 let lo=0,hi=lines.length-1,index=-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(lines[mid].start<=t){index=mid;lo=mid+1}else hi=mid-1}
 const active=index>=0&&t<lines[index].end?index:-1;
 const retiring=index>=0&&t>=lines[index].end&&t<lines[index].end+.94?index:
   index>0&&t>=lines[index-1].end&&t<lines[index-1].end+.94?index-1:-1;
 for(const key of modelCache.keys()){const n=Number(key.split(':')[0]);if(n!==active&&n!==retiring)modelCache.delete(key)}
 for(const key of Object.keys(layouts)){const n=Number(key);if(n!==active&&n!==retiring)delete layouts[key]}
 if(active>=0)renderLine(lines[active],layoutAt(active),t,palette);
 if(retiring>=0&&retiring!==active&&!reduced&&intensity>0)renderLine(lines[retiring],layoutAt(retiring),t,palette);
 ctx.globalAlpha=1;
 canvas.dataset.composition=active<0?'interlude':String(active%3);
 canvas.dataset.hero=active<0?'':layoutAt(active).heroText;
 canvas.dataset.letterMotion=active<0?entrance:entryKind(null,layoutAt(active));
 canvas.dataset.particleCount=String(particleCount);
 canvas.dataset.timing=active<0?'none':lines[active].words?'word':'line';
}
const colorCanvas=document.createElement('canvas');colorCanvas.width=colorCanvas.height=1;
const colorCtx=colorCanvas.getContext('2d',{willReadFrequently:true});
function color(value,fallback){
 colorCtx.clearRect(0,0,1,1);colorCtx.fillStyle=fallback; if(typeof value==='string')colorCtx.fillStyle=value;
 colorCtx.fillRect(0,0,1,1);const p=colorCtx.getImageData(0,0,1,1).data;
 return {hex:'#'+Array.from(p).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join(''),alpha:p[3]/255};
}
function settings(){
 const data=document.body.dataset;
 const css=getComputedStyle(document.documentElement),cv=n=>css.getPropertyValue(n).trim();
 // Snapshot the geometry-affecting knobs so we only rebuild cached layouts when one changed.
 const prev=JSON.stringify([typo.family,typo.weight,typo.sizeScale,typo.letterSpacing,typo.hpos,typo.vjustify,typo.orient,typo.padX,typo.padY,typo.safeMargin]);
 // ── Typography (all optional; unset → the shipped Sans/Serif pairing) ──
 const famRaw=(cv('--display-font-family')||'').trim();
 typo.family=famRaw&&!/^(serif|sans-serif|monospace|inherit|initial|unset|)$/i.test(famRaw)?famRaw:'';
 const w=parseInt(cv('--display-font-weight'),10);typo.weight=Number.isFinite(w)&&w>=100&&w<=900?w:0;
 const fs=parseFloat(cv('--display-font-size'));typo.sizeScale=Number.isFinite(fs)&&fs>0?clamp(fs/64,.5,2):1;
 const lsp=parseFloat(cv('--lyric-letter-spacing'));typo.letterSpacing=Number.isFinite(lsp)?lsp:0;
 // 陰影：吃共用的經典「陰影」控制（--lyric-shadow：預設樣式＋顏色組成的 CSS 字串）。
 const shRaw=cv('--lyric-shadow');
 const shOn=!!shRaw&&!/^none\b/i.test(shRaw)&&!/^0px?\s+0px?\s+0px?\s+transparent/i.test(shRaw);
 const shCol=shRaw.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/);
 const shNums=(shRaw.match(/-?\d[\d.]*px/g)||[]).map(parseFloat);
 typo.shadow={on:shOn,color:shCol?shCol[0]:'rgba(8,5,13,0.94)',blur:shNums[1]||6,dy:shNums[0]||1.3};
 // ── Composition ──
 typo.hpos=['left','right','split'].includes(data.lyricPos)?data.lyricPos:'center';
 const vj=cv('--lyric-justify');typo.vjustify=/^(flex-start|start)$/.test(vj)?'start':/^(flex-end|end)$/.test(vj)?'end':'center';
 typo.orient=data.particleOrient==='vertical'?'vertical':'horizontal';
 const px=parseFloat(cv('--lyric-padding-x')),py=parseFloat(cv('--lyric-padding-y'));
 typo.padX=Number.isFinite(px)?px:60;typo.padY=Number.isFinite(py)?py:48;
 const sm=parseFloat(data.stageSafeMargin);typo.safeMargin=Number.isFinite(sm)?clamp(sm,0,25):2;
 // 水平／垂直微調：跟星沙／流光等舞台模板同一組 offsetX/offsetY，這裡自己夾在邊距框內。
 const ox=parseFloat(data.particleOffsetX),oy=parseFloat(data.particleOffsetY);
 typo.offX=Number.isFinite(ox)?clamp(ox,-W*.4,W*.4):0;
 typo.offY=Number.isFinite(oy)?clamp(oy,-H*.4,H*.4):0;
 // 進場二選一（2026-09-12 加回這顆旋鈕，語意跟舊版不同，見 server sanitizeParticleSettings
 // 的說明）：'auto' 預設，逐句在 stream/rain/vortex/twin 四種聚散風格輪替；'quaddrift' 時
 // 全部改用四相漂字整字進場（entryKind 對非 auto 值本來就會原樣回傳給每個字，不需要另外改）。
 entrance=data.particleEntrance==='quaddrift'?'quaddrift':'auto';
 intensity={calm:.55,normal:1,chaotic:1.35}[data.lyricIntensity]||1;
 typo.intensityKey=['calm','chaotic'].includes(data.lyricIntensity)?data.lyricIntensity:'normal';
 // Manual "reduce motion" knob removed — only the OS/browser preference collapses to fade-in.
 reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const ink=color(cv('--lyric-color'),'#f6f0e5'),accent=color(cv('--lyric-color-active'),'#e97855');
 palette={ink:ink.hex,a:accent.hex,inkOpacity:ink.alpha,aOpacity:accent.alpha};
 if(prev!==JSON.stringify([typo.family,typo.weight,typo.sizeScale,typo.letterSpacing,typo.hpos,typo.vjustify,typo.orient,typo.padX,typo.padY,typo.safeMargin])){maskCache.clear();build()}
 draw(t);
}
return {
 resize,settings,draw,
 load(input){lines=input;build();draw(t)},
 fonts(){maskCache.clear();build();settings()},
 destroy(){lines=[];layouts=[];maskCache.clear();modelCache.clear();canvas.width=canvas.height=1}
};
}

// App word.start is relative milliseconds; demo words use absolute seconds.
// Invalid/mismatching word data falls back to the original line text, without reordering it.
function normalize(input){
 const sorted=(Array.isArray(input)?input:[]).filter(l=>l&&Number.isFinite(l.time)&&typeof l.text==='string')
   .slice().sort((a,b)=>a.time-b.time);
 const result=[];
 for(let i=0;i<sorted.length;i++){
   const l=sorted[i];if(!l.text.trim())continue;
   const start=l.time/1000,next=sorted[i+1]?.time/1000;
   const raw=Array.isArray(l.words)?l.words:[];
   const wordEnd=raw.reduce((end,w)=>Number.isFinite(w.start)&&Number.isFinite(w.duration)?Math.max(end,start+(w.start+w.duration)/1000):end,start);
   let end=Number.isFinite(l.endTime)&&l.endTime>l.time?l.endTime/1000:
     Number.isFinite(l.duration)&&l.duration>0?start+l.duration/1000:wordEnd>start?wordEnd:
     Number.isFinite(next)?next:start+5;
   if(Number.isFinite(next))end=Math.min(end,next);
   if(end<=start)continue;
   const line={text:l.text,start,end};
   let previous=start;
   const words=raw.map(w=>({text:w.text,start:start+w.start/1000,end:start+(w.start+w.duration)/1000}));
   if(words.length&&words.map(w=>w.text).join('')===l.text&&words.every(w=>{
     const valid=typeof w.text==='string'&&w.text.length>0&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.start>=previous-.0005&&w.end>w.start&&w.end<=end+.0005;
     previous=w.end;return valid;
   }))line.words=words;
   result.push(line);
 }
 return result;
}
let canvas=null,renderer=null,observer=null,source=null,mediaQuery=null,fontHandler=null,safeZoneGuide=null;
function refresh(context){
 if(!renderer)return;
 const lyrics=context?.getLyrics?.()||[];
 if(lyrics!==source){source=lyrics;renderer.load(normalize(lyrics))}
}
LyricTemplates.register({
 id:'particle',label:'風息成字',
 settings:[
  {key:'particleOrient',type:'enum',values:['horizontal','vertical'],default:'vertical',target:'data:particleOrient'},
  {key:'particleEntrance',type:'enum',values:['auto','quaddrift'],default:'auto',target:'data:particleEntrance'},
  // 水平／垂直微調：沿用共用的 offsetX/offsetY，寫進 body.dataset 讓 canvas 自己讀（reclamp 對滿版容器無效）。
  {key:'offsetX',type:'int',min:-960,max:960,default:0,target:'data:particleOffsetX'},
  {key:'offsetY',type:'int',min:-540,max:540,default:0,target:'data:particleOffsetY'},
  // 中央安全距離＋引導線：跟鏡像／紙帶完全共用同一套（stageSafeMargin / stage-show-safe-zone / mountStageSafeZoneGuide）。
  ...LyricTemplateSettings.STAGE_SAFE
 ],
 mount(container,context){
  canvas=document.createElement('canvas');canvas.id='particle-root';canvas.setAttribute('aria-hidden','true');container.appendChild(canvas);
  renderer=createRenderer(canvas);renderer.settings();renderer.resize();refresh(context);
  observer=new ResizeObserver(()=>renderer?.resize());observer.observe(canvas);
  const instance=renderer;fontHandler=()=>{if(renderer===instance)renderer.fonts()};
  document.fonts?.addEventListener('loadingdone',fontHandler);document.fonts?.ready.then(fontHandler);
  mediaQuery=matchMedia('(prefers-reduced-motion: reduce)');mediaQuery.addEventListener('change',updateSettings);
  if(typeof LyricMotion!=='undefined'&&LyricMotion.mountStageSafeZoneGuide)safeZoneGuide=LyricMotion.mountStageSafeZoneGuide(container);
 },
 onLyricsLoaded(lyrics,context){source=null;refresh(context)},
 onFrame(timeMs,context){refresh(context);renderer?.draw(timeMs/1000)},
 onSeek(timeMs,context){refresh(context);renderer?.draw(timeMs/1000)},
 onSettings(settings,context){refresh(context);renderer?.settings();if(safeZoneGuide)safeZoneGuide.sync();renderer?.draw((context?.getCurrentTimeMs?.()||0)/1000)},
 destroy(){observer?.disconnect();document.fonts?.removeEventListener('loadingdone',fontHandler);mediaQuery?.removeEventListener('change',updateSettings);if(safeZoneGuide){safeZoneGuide.destroy();safeZoneGuide=null}renderer?.destroy();canvas?.remove();renderer=canvas=observer=source=mediaQuery=fontHandler=null}
});
function updateSettings(){renderer?.settings()}
})();
