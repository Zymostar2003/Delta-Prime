/* CEOSkit — Smart Analysis engine + Signal iframe template */


//  SMART ANALYSIS — Independent live engine
let saSocket, saHistory=[], saActiveCat='volatility', saActiveType='rise_fall';
let saActiveBarrier=null, saPipSize=2, saOpen=false, saMasterSymbols=[];

function openSmartAnalysis(){
    closeAll();
    saOpen=true;
    applyModalTop('smart-overlay');
    document.getElementById('smart-overlay').classList.add('open');
    document.getElementById('btn-smart').classList.add('active-tool');
    // If already connected and has data, just refresh display
    if(saHistory.length>0){ saUpdateAll(); return; }
    // Otherwise connect fresh
    saConnect();
}

function closeSmartAnalysis(){
    saOpen=false;
    document.getElementById('smart-overlay').classList.remove('open');
    document.getElementById('btn-smart').classList.remove('active-tool');
}

// Category nav
document.querySelectorAll('.sa-nav-item').forEach(btn=>btn.onclick=function(){
    document.querySelectorAll('.sa-nav-item').forEach(b=>b.classList.remove('active'));
    this.classList.add('active');
    saActiveCat=this.dataset.sacat;
    saRenderList(saActiveCat);
});

// Contract type
document.querySelectorAll('.sa-contract-btn').forEach(btn=>btn.onclick=function(){
    document.querySelectorAll('.sa-contract-btn').forEach(b=>b.classList.remove('active'));
    this.classList.add('active');
    saActiveType=this.dataset.satype;
    saUpdateStats();
});

function saConnect(){
    if(saSocket&&saSocket.readyState<=1){ saSocket.close(); }
    // New API: Smart Analysis uses OTP WS if available, else public endpoint
    var _saWsUrl = 'wss://ws.derivws.com/websockets/v3?app_id=1';
    saSocket=new WebSocket(_saWsUrl);
    saSocket.onopen=()=>saSocket.send(JSON.stringify({active_symbols:'brief'}));
    saSocket.onmessage=(msg)=>{
        const d=JSON.parse(msg.data);
        if(d.msg_type==='active_symbols'){ saMasterSymbols=d.active_symbols; saRenderList(saActiveCat); }
        if(d.msg_type==='history'||d.msg_type==='tick'){
            const pips=d.tick?d.tick.pip_size:(d.history?d.pip_size:saPipSize);
            if(pips) saPipSize=pips;
            const prices=d.tick?[d.tick.quote]:d.history.prices;
            prices.forEach(p=>{
                const digit=parseInt(p.toFixed(saPipSize).slice(-1));
                const prev=saHistory.length>0?saHistory[saHistory.length-1].price:p;
                saHistory.push({price:p,digit,diff:p-prev});
            });
            if(saHistory.length>1000) saHistory.splice(0,saHistory.length-1000);
            if(d.tick){
                const last=saHistory[saHistory.length-1];
                const priceStr=last.price.toFixed(saPipSize);
                document.getElementById('sa-live-price').innerHTML=
                    `${priceStr.slice(0,-1)}<span style="color:#00c853">${last.digit}</span>`;
                saMoveCursor(last.digit);
            }
            document.getElementById('sa-tick-count').textContent=saHistory.length;
            if(saOpen) saUpdateAll();
        }
    };
    saSocket.onclose=()=>{ if(saOpen) setTimeout(saConnect,3000); };
}

function saRenderList(cat){
    const filtered=saMasterSymbols.filter(m=>{
        const s=(m.underlying_symbol||m.symbol||'').toUpperCase();
        const d=(m.underlying_symbol_name||m.display_name||'').toUpperCase();
        if(cat==='volatility') return s.startsWith('R_')||s.startsWith('1HZ')||d.includes('VOLATILITY');
        if(cat==='crash_boom') return d.includes('CRASH')||d.includes('BOOM');
        if(cat==='step')       return d.includes('STEP');
        if(cat==='jump')       return d.includes('JUMP');
        return false;
    });
    const sel=document.getElementById('sa-market-select');
    sel.innerHTML=filtered.map(m=>{
        const sym=m.underlying_symbol||m.symbol||'';
        const name=m.underlying_symbol_name||m.display_name||sym;
        return `<option value="${sym}">${name}</option>`;
    }).join('');
    sel.onchange=(e)=>{
        saHistory=[];
        const newSym = e.target.value;
        if(saSocket&&saSocket.readyState===1){
            saSocket.send(JSON.stringify({forget_all:'ticks'}));
            saSocket.send(JSON.stringify({ticks_history:newSym,count:1000,end:'latest',style:'ticks'}));
            saSocket.send(JSON.stringify({ticks:newSym,subscribe:1}));
        }
        // ── Sync to Signal Engine iframe ──
        const seIframe = document.getElementById('engine-iframe');
        if(seIframe && seIframe._blobLoaded && seIframe.contentWindow){
            seIframe.contentWindow.postMessage({type:'ceoskit_setSymbol', symbol:newSym}, '*');
        }
    };
    // Build digit panel fresh
    saSetupDigitGrid();
    // Show/hide contract nav based on category
    const showNav=(cat==='volatility'||cat==='jump');
    document.getElementById('sa-contract-grid').style.display=showNav?'flex':'none';
    if(filtered.length>0) sel.dispatchEvent(new Event('change'));
}

function saSetupDigitGrid(){
    const dp=document.getElementById('sa-digit-panel');
    dp.innerHTML='<div id="sa-digit-cursor" style="position:absolute;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:15px solid #00c853;transition:all .2s;z-index:99;pointer-events:none;display:none;"></div>';
    const bp=document.getElementById('sa-barrier-panel');
    bp.innerHTML='';
    for(let i=0;i<=9;i++){
        const g=document.createElement('div'); g.className='digit-group'; g.id=`sa-group-${i}`;
        g.innerHTML=`<div class="digit-circle" style="border-color:var(--border)">${i}</div><span class="pct-label" style="font-weight:900">0%</span>`;
        dp.appendChild(g);
        const b=document.createElement('div'); b.className='barrier-btn'; b.innerText=i;
        b.onclick=()=>{
            document.querySelectorAll('#sa-barrier-panel .barrier-btn').forEach(x=>x.classList.remove('active'));
            b.classList.add('active'); saActiveBarrier=i; saUpdateStats();
        };
        bp.appendChild(b);
    }
    const r=document.createElement('div'); r.className='barrier-btn btn-reset'; r.innerText='X';
    r.onclick=()=>{
        document.querySelectorAll('#sa-barrier-panel .barrier-btn').forEach(x=>x.classList.remove('active'));
        saActiveBarrier=null; saUpdateStats();
    };
    bp.appendChild(r);
}

function saMoveCursor(digit){
    const tg=document.getElementById(`sa-group-${digit}`);
    const cur=document.getElementById('sa-digit-cursor');
    if(!tg||!cur) return;
    cur.style.display='block';
    cur.style.left=(tg.offsetLeft+(tg.offsetWidth/2)-10)+'px';
    cur.style.top=(tg.offsetTop-15)+'px';
}

function saUpdateAll(){
    saUpdateStats();
    saUpdateDigitRanks();
    saUpdateInsight();
}

function saUpdateStats(){
    if(!saHistory.length) return;
    const wd=saHistory.slice(-50);
    const rollEl=document.getElementById('sa-rolling-window');
    rollEl.innerHTML='';
    let cp=0,lrd=null,ct=false;
    const isBarrier=(saActiveType==='matches_differs'||saActiveType==='over_under');
    const bp=document.getElementById('sa-barrier-panel');
    bp.style.display=isBarrier?'grid':'none';
    const showRep=(saActiveType==='matches_differs');
    const rs=wd.map((t,i)=>{
        if(!showRep) return false;
        return(i<wd.length-1&&t.digit===wd[i+1].digit)||(i>0&&t.digit===wd[i-1].digit);
    });
    wd.forEach((t,i)=>{
        const n=document.createElement('div'); n.className='roll-node'; let im=false;
        if(rs[i]){if(t.digit!==lrd){ct=!ct;}n.classList.add(ct?'node-repeat-A':'node-repeat-B');lrd=t.digit;}
        if(saActiveType==='matches_differs'){n.innerText=t.digit;im=(saActiveBarrier!==null&&t.digit===saActiveBarrier);}
        else if(saActiveType==='over_under'){n.innerText=t.digit>(saActiveBarrier??4)?'O':'U';im=(t.digit>(saActiveBarrier??4));}
        else if(saActiveType==='even_odd'){n.innerText=t.digit%2===0?'E':'O';im=(t.digit%2===0);}
        else{n.innerText=t.diff>=0?'R':'F';im=(t.diff>=0);}
        if(!rs[i]){
            if(saActiveType==='matches_differs'&&saActiveBarrier===null) n.classList.add('node-neutral');
            else n.classList.add(im?'node-green':'node-red');
        }
        if(im) cp++; rollEl.appendChild(n);
    });
    const pp=((cp/wd.length)*100).toFixed(0), sp=100-pp;
    let lL='RISE',lR='FALL';
    if(saActiveType==='even_odd'){lL='EVEN';lR='ODD';}
    else if(saActiveType==='over_under'){lL='OVER';lR='UNDER';}
    else if(saActiveType==='matches_differs'){lL='MATCH';lR='DIFF';}
    document.getElementById('sa-stat-left').innerHTML=`${lL}: <span style="color:var(--deep-black);font-weight:900">${pp}%</span>`;
    document.getElementById('sa-stat-right').innerHTML=`${lR}: <span style="color:var(--deep-black);font-weight:900">${sp}%</span>`;
}

function saUpdateDigitRanks(){
    if(!saHistory.length) return;
    const counts=Array(10).fill(0);
    saHistory.forEach(t=>counts[t.digit]++);
    const stats=counts.map((c,d)=>({digit:d,count:c,pct:((c/saHistory.length)*100).toFixed(1)}));
    const sorted=[...stats].sort((a,b)=>b.count-a.count);
    stats.forEach(s=>{
        const g=document.getElementById(`sa-group-${s.digit}`); if(!g) return;
        g.className='digit-group';
        const circle=g.querySelector('.digit-circle');
        if(s.digit===sorted[0].digit){ g.classList.add('rank-1'); circle.style.background='var(--green)'; circle.style.color='white'; }
        else if(s.digit===sorted[1].digit){ g.classList.add('rank-2'); circle.style.background='var(--orange)'; circle.style.color='white'; }
        else if(s.digit===sorted[9].digit){ g.classList.add('rank-last'); circle.style.background='var(--red)'; circle.style.color='white'; }
        else { circle.style.background=''; circle.style.color=''; }
        g.querySelector('.pct-label').innerText=`${s.pct}%`;
    });
}

function saUpdateInsight(){
    if(saHistory.length<30) return;
    const n=saHistory.length;
    const counts=Array(10).fill(0); saHistory.forEach(t=>counts[t.digit]++);
    const pcts=counts.map((c,d)=>({d,pct:(c/n*100)}));
    const sorted=[...pcts].sort((a,b)=>b.pct-a.pct);
    const hot=sorted[0], cold=sorted[9];

    // Streak
    let sLen=1, sType=saHistory[n-1].diff>=0?'RISE':'FALL';
    for(let i=n-2;i>=0;i--){if((saHistory[i].diff>=0?'RISE':'FALL')===sType)sLen++;else break;}

    // Rise/fall last 50
    const last50=saHistory.slice(-50);
    const rises=last50.filter(t=>t.diff>=0).length;
    const risePct=(rises/50*100).toFixed(0);

    // Even/odd
    const evens=pcts.filter(s=>[0,2,4,6,8].includes(s.d)).reduce((a,s)=>a+s.pct,0);
    const odds=pcts.filter(s=>[1,3,5,7,9].includes(s.d)).reduce((a,s)=>a+s.pct,0);
    const eoWin=evens>odds?'EVEN':'ODD';
    const eoGap=Math.abs(evens-odds).toFixed(1);

    // Over/under
    const oSum=pcts.filter(s=>s.d>4).reduce((a,s)=>a+s.pct,0);
    const uSum=pcts.filter(s=>s.d<=4).reduce((a,s)=>a+s.pct,0);
    const ouWin=oSum>uSum?'OVER':'UNDER';

    // Consecutive even/odd streak
    let eoStrLen=1;
    const lastEO=saHistory[n-1].digit%2===0?'E':'O';
    for(let i=n-2;i>=0;i--){if((saHistory[i].digit%2===0?'E':'O')===lastEO)eoStrLen++;else break;}

    // Build smart insight text
    let tips=[];
    if(sLen>=3) tips.push(`🔥 <strong>${sType}</strong> has run ${sLen} times in a row — ${sLen>=5?'expect a reversal soon':'momentum building'}`);
    if(risePct>60) tips.push(`📈 <strong>${risePct}%</strong> of last 50 ticks went UP — buyers are in control`);
    else if(risePct<40) tips.push(`📉 Only <strong>${risePct}%</strong> of last 50 ticks went UP — sellers are in control`);
    tips.push(`🌡️ Hottest digit: <strong>${hot.d}</strong> (${hot.pct.toFixed(1)}%) &nbsp;|&nbsp; Coldest: <strong>${cold.d}</strong> (${cold.pct.toFixed(1)}%)`);
    if(parseFloat(eoGap)>3) tips.push(`🔢 ${eoWin} side leads by <strong>${eoGap}%</strong> — ${eoWin} signal active`);
    if(eoStrLen>=3) tips.push(`⚡ Last <strong>${eoStrLen}</strong> digits were all <strong>${lastEO==='E'?'EVEN':'ODD'}</strong> — consider entering ${lastEO==='E'?'EVEN':'ODD'} now`);
    tips.push(`🔼 Over (5–9): <strong>${oSum.toFixed(1)}%</strong> &nbsp;|&nbsp; Under (0–4): <strong>${uSum.toFixed(1)}%</strong> → <strong style="color:${oSum>uSum?'var(--green)':'var(--accent)'}">${ouWin}</strong>`);

    document.getElementById('sa-insight-txt').innerHTML=tips.join('<br>');
}

// ── CHART LIB — prefetch in background so it's ready when engine opens ──
let _chartLibText = null;
let _chartLibLoading = false;
const CHART_CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.min.js',
    'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/4.1.3/lightweight-charts.standalone.production.min.js'
];

function preloadChartLib(){
    if(_chartLibText || _chartLibLoading) return;
    _chartLibLoading = true;
    (async function tryFetch(idx){
        if(idx >= CHART_CDN_URLS.length) return;
        try {
            const r = await fetch(CHART_CDN_URLS[idx]);
            if(!r.ok) throw new Error('bad status');
            _chartLibText = await r.text();
        } catch(e) { tryFetch(idx+1); }
    })(0);
}
// Start prefetch immediately on page load — runs silently in background
preloadChartLib();
const ENGINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Signal Engine</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<!-- LightweightCharts loaded dynamically in initApp() to avoid CDN race conditions -->
<style>
:root{
  /* Obsidian Dark — always-on dark terminal */
  --bg:       #09090B;   /* base layer — true black */
  --panel:    #18181B;   /* surface cards */
  --card:     #1C1C1F;   /* card interior */
  --border:   #27272A;   /* 1 px hairlines */
  --border2:  #3F3F46;   /* emphasis borders */
  --accent:   #6366F1;   /* indigo — primary action */
  --accent2:  #818CF8;   /* indigo light — hover */
  --green:    #10B981;   /* emerald — bullish / positive */
  --green2:   #34D399;   /* emerald light */
  --red:      #F43F5E;   /* rose — bearish / negative */
  --red2:     #FB7185;   /* rose light */
  --orange:   #F59E0B;   /* amber — caution */
  --teal:     #14B8A6;   /* teal */
  --purple:   #A78BFA;   /* violet */
  --yellow:   #FBBF24;   /* yellow */
  --text:     #FAFAFA;   /* primary text */
  --text2:    #A1A1AA;   /* muted text */
  --muted:    #71717A;   /* very muted */
  --glass:    rgba(24,24,27,0.80); /* glassmorphism base */
  --glow-up:  0 0 20px rgba(16,185,129,0.35), 0 0 40px rgba(16,185,129,0.15);
  --glow-dn:  0 0 20px rgba(244,63,94,0.35),  0 0 40px rgba(244,63,94,0.15);
  --nav-h:60px;--head-h:48px;--room-h:40px;
}
/* ── LIGHT MODE — toggled by adding data-theme="light" on <html> ── */
[data-theme="light"]{
  --bg:       #F4F4F5;
  --panel:    #FFFFFF;
  --card:     #FAFAFA;
  --border:   #E4E4E7;
  --border2:  #D4D4D8;
  --text:     #09090B;
  --text2:    #52525B;
  --muted:    #71717A;
  --glass:    rgba(255,255,255,0.85);
  --accent:   #4F46E5;
  --accent2:  #6366F1;
  --green:    #059669;
  --green2:   #10B981;
  --red:      #DC2626;
  --red2:     #EF4444;
  --orange:   #D97706;
  --teal:     #0D9488;
  --purple:   #7C3AED;
}
[data-theme="light"] header{background:#FFFFFF;border-bottom-color:#E4E4E7;}
[data-theme="light"] .room-tabs{background:rgba(255,255,255,.9);}
[data-theme="light"] .content{background:#F4F4F5;}
[data-theme="light"] .card{background:#FFFFFF;border-color:#E4E4E7;}
[data-theme="light"] .mkt-select,[data-theme="light"] .tf-select{background:#fff;color:#09090B;border-color:#D4D4D8;}

[data-theme="light"] .rtab{color:#71717A;}
[data-theme="light"] .rtab.on{color:#4F46E5;background:rgba(79,70,229,.06);}
*{box-sizing:border-box;margin:0;padding:0;font-family:'DM Sans','Segoe UI',sans-serif;-webkit-tap-highlight-color:transparent;}
body{background:var(--bg);color:var(--text);overflow:hidden;height:100dvh;display:flex;flex-direction:column;}

/* ── HEADER ── */
header{height:var(--head-h);background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;z-index:100;}
.hbrand{font-weight:900;font-size:1.0rem;letter-spacing:.4px;font-family:'DM Sans',sans-serif;}.hbrand span{color:var(--accent);}
.hlive{display:flex;align-items:center;gap:5px;margin-left:auto;}
.ldot{width:5px;height:5px;border-radius:50%;background:var(--green);animation:blink 1.2s infinite;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.15;}}
.ltxt{font-size:7.5px;font-weight:700;color:var(--green);letter-spacing:.6px;font-family:'DM Mono',monospace;}
.ltick{font-size:7.5px;font-weight:700;color:white;background:var(--accent);padding:1px 6px;border-radius:8px;margin-left:2px;font-family:'DM Mono',monospace;}
.thm-btn{width:28px;height:28px;border-radius:7px;background:var(--panel);border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;margin-left:6px;}

/* ── ROOM TABS — Glassmorphism ── */
.room-tabs{
  height:var(--room-h);
  background:var(--glass);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border-bottom:1px solid var(--border);
  display:flex;flex-shrink:0;position:relative;z-index:40;
}
.rtab{
  flex:1;display:flex;align-items:center;justify-content:center;
  font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;
  color:var(--muted);cursor:pointer;
  border-bottom:2px solid transparent;
  transition:all .2s cubic-bezier(.4,0,.2,1);
  -webkit-tap-highlight-color:transparent;
  user-select:none;-webkit-user-select:none;
  font-family:'DM Mono',monospace;
}
.rtab.on{color:var(--text);border-bottom-color:var(--accent);background:rgba(99,102,241,.06);}

/* ── MARKET SELECTOR ── */
.mkt-bar{
  padding:8px 12px;background:var(--panel);
  border-bottom:1px solid var(--border);
  display:flex;gap:8px;align-items:center;flex-shrink:0;
}
.mkt-select{
  flex:1;background:var(--card);color:var(--text);
  border:1px solid var(--border2);padding:7px 10px;border-radius:8px;
  font-weight:600;font-size:10.5px;font-family:'DM Sans',sans-serif;
  outline:none;cursor:pointer;
}
.mkt-select:focus{border-color:var(--accent);}
.tf-btns{display:flex;gap:4px;flex-shrink:0;}
.tf-btn{display:none;}/* hidden — replaced by dropdown */
.tf-select{
  background:var(--card);color:var(--text);
  border:1px solid var(--border2);padding:5px 8px;border-radius:8px;
  font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0;
  font-family:'DM Mono',monospace;outline:none;
}
.tf-select:focus{border-color:var(--accent);}

/* ── CONTENT & VIEW SYSTEM ── */
.content{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;background:var(--bg);}
.content::-webkit-scrollbar{width:3px;}
.content::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

/* View switching — CSS-class driven, no style.display in JS */
.tab-content{display:none;}
.tab-content.view-active{display:block;}
.room-page{display:none;padding:12px 12px 20px;}
.room-page.view-active{display:block;}

/* Context-aware module visibility */
/* Rise/Fall module: show directional, hide digit-specific */
[data-ctx="rf"]  .ctx-digit  {display:none !important;}
[data-ctx="rf"]  .ctx-parity {display:none !important;}
/* Even/Odd module: show parity, hide directional */
[data-ctx="eo"]  .ctx-rf     {display:none !important;}
[data-ctx="eo"]  .ctx-dist   {display:none !important;}
/* Over/Under module: show distribution, hide parity */
[data-ctx="ou"]  .ctx-parity {display:none !important;}
[data-ctx="ou"]  .ctx-rf     {display:none !important;}
/* Best Signal: show all relevant */
[data-ctx="bs"]  .ctx-rf-only{display:none !important;}

/* Mobile-first CSS Grid: signal always at top, stats below */
.sig-grid{
  display:grid;
  grid-template-columns:1fr;
  grid-template-rows:auto;
  gap:8px;
}
.sig-grid .sig-primary{grid-row:1;}
.sig-grid .sig-chart  {grid-row:2;}
.sig-grid .sig-stats  {grid-row:3;}
@media(min-width:640px){
  .sig-grid{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;}
  .sig-grid .sig-primary{grid-column:1 / -1;grid-row:1;}
  .sig-grid .sig-chart  {grid-column:1 / -1;grid-row:2;}
  .sig-grid .sig-stats  {grid-column:1;grid-row:3;}
}

/* ── BOTTOM NAV — Glassmorphism Terminal Style ── */
.bot-nav{
  height:var(--nav-h);
  background:var(--glass);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  border-top:1px solid var(--border);
  display:flex;flex-shrink:0;
  position:relative;z-index:50;
}
.bnav{
  flex:1;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:2px;cursor:pointer;
  border-top:2px solid transparent;
  transition:all .22s cubic-bezier(.4,0,.2,1);
  -webkit-tap-highlight-color:transparent;
  user-select:none;-webkit-user-select:none;
  padding:4px 2px 2px;
  position:relative;
}
.bnav::after{
  content:'';position:absolute;bottom:0;left:20%;right:20%;height:0;
  border-radius:2px 2px 0 0;
  transition:all .22s cubic-bezier(.4,0,.2,1);
}
.bnav.on{border-top-color:transparent;}
.bnav.on::after{height:2px;}
/* Per-tab accent colours */
#bnav-rf.on::after  {background:var(--green);}
#bnav-ou.on::after  {background:var(--accent);}
#bnav-eo.on::after  {background:var(--orange);}
.bnav-icon{font-size:1.15rem;line-height:1;transition:transform .2s;}
.bnav.on .bnav-icon{transform:scale(1.12);}
.bnav-txt{
  font-size:7.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.5px;color:var(--muted);
  font-family:'DM Sans',sans-serif;transition:color .22s;
}
.bnav.on .bnav-txt{color:var(--text2);}




/* ── CARDS ── */
.card{
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:12px;
  padding:12px 14px;
  margin-bottom:8px;
  transition:box-shadow .3s;
}
.card.green {border-left:2px solid var(--green);}
.card.red   {border-left:2px solid var(--red);}
.card.orange{border-left:2px solid var(--orange);}
.card.purple{border-left:2px solid var(--purple);}
.card.teal  {border-left:2px solid var(--teal);}
/* High-probability signal glow — applied by JS */
.card.glow-up  {box-shadow:var(--glow-up);}
.card.glow-down{box-shadow:var(--glow-dn);}
@keyframes glowPulseUp{0%,100%{box-shadow:0 0 12px rgba(16,185,129,.25);}60%{box-shadow:0 0 28px rgba(16,185,129,.50),0 0 50px rgba(16,185,129,.20);}}
@keyframes glowPulseDn{0%,100%{box-shadow:0 0 12px rgba(244,63,94,.25);}60%{box-shadow:0 0 28px rgba(244,63,94,.50),0 0 50px rgba(244,63,94,.20);}}
.card.signal-hot-up{animation:glowPulseUp 2s ease infinite;border-color:rgba(16,185,129,.5);}
.card.signal-hot-dn{animation:glowPulseDn 2s ease infinite;border-color:rgba(244,63,94,.5);}

.ctitle{
  font-size:9px;font-weight:800;text-transform:uppercase;
  letter-spacing:1.8px;color:var(--muted);margin-bottom:9px;
  font-family:'Inter',sans-serif;display:flex;align-items:center;gap:6px;
}
.card.green  .ctitle{color:var(--green);}
.card.red    .ctitle{color:var(--red);}
.card.orange .ctitle{color:var(--orange);}
.card.purple .ctitle{color:var(--purple);}
.card.teal   .ctitle{color:var(--teal);}

/* ── BIG SIGNAL ── */
.bigsig{text-align:center;padding:10px 0 6px;}
.sig{font-size:2.4rem;font-weight:900;letter-spacing:2px;line-height:1;font-family:'DM Sans',sans-serif;}
.sigbadge{display:inline-block;padding:3px 14px;border-radius:20px;font-size:8.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:6px;font-family:'DM Mono',monospace;}
.sb-s{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.4);}
.sb-m{background:rgba(245,158,11,.15);color:var(--orange);border:1px solid rgba(245,158,11,.4);}
.sb-w{background:rgba(244,63,94,.12);color:var(--red);border:1px solid rgba(244,63,94,.4);}

/* ── ENTRY BOX ── */
.ebox{border-radius:10px;padding:10px 12px;margin:6px 0;}
.ebox.go  {background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.35);}
.ebox.wait{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.35);}
.ebox.stop{background:rgba(244,63,94,.07); border:1px solid rgba(244,63,94,.35);}
.etitle{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-family:'DM Mono',monospace;}
.ebox.go .etitle{color:var(--green);}.ebox.wait .etitle{color:var(--orange);}.ebox.stop .etitle{color:var(--red);}
.etxt{font-size:10.5px;line-height:1.7;color:var(--text2);}

/* ── BARS ── */
.bwrap{background:var(--border);border-radius:4px;height:7px;overflow:hidden;margin:4px 0 2px;}
.bfill{height:100%;border-radius:4px;transition:width .2s ease;}
.blr{display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:var(--muted);margin-top:3px;font-family:'Inter',sans-serif;}
.dualbar{height:10px;background:var(--border);border-radius:5px;overflow:hidden;margin:5px 0 3px;position:relative;}
.db-g{position:absolute;left:0;top:0;height:100%;background:var(--green);border-radius:5px 0 0 5px;transition:width .2s ease;}
.db-r{position:absolute;right:0;top:0;height:100%;background:var(--red);border-radius:0 5px 5px 0;transition:width .2s ease;}
.dlr{display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:3px;font-family:'Inter',sans-serif;}

/* ── STAT ROW ── */
.sr2{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:11.5px;}
.sr2:last-child{border-bottom:none;}
.sl{font-weight:600;color:var(--muted);font-family:'Inter',sans-serif;}
.sv{font-weight:700;color:var(--text);font-family:'Inter',monospace;letter-spacing:.3px;}

/* ── CHECK ROW ── */
.cr{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px;font-weight:600;font-family:'Inter',sans-serif;line-height:1.5;}
.cr:last-child{border-bottom:none;}
.cd{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;margin-top:1px;}
.cd-y{background:var(--green);color:#fff;}.cd-n{background:var(--red);color:#fff;}.cd-w{background:var(--orange);color:#fff;}.cd-i{background:var(--accent);color:#fff;}
.csub{font-size:9px;color:var(--muted);font-weight:500;margin-top:2px;font-family:'Inter',sans-serif;}

/* ── DIGIT GRID ── */
.dgrid{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;margin:6px 0;}
.dcell{border-radius:6px;text-align:center;padding:5px 1px;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);}
.dcell .dn{font-size:12px;font-weight:800;color:#fff;display:block;font-family:'DM Mono',monospace;letter-spacing:.5px;}
.dcell .dp{font-size:9.5px;font-weight:800;color:#fff;display:block;font-family:'DM Mono',monospace;text-shadow:0 1px 4px rgba(0,0,0,.7);}
.dcell .da{font-size:9px;display:block;font-weight:700;}

/* ── DIGIT SELECTION BUTTONS ── */
.dsel-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:8px 0;}
.dsel-btn{
  padding:12px 4px;border-radius:10px;text-align:center;cursor:pointer;
  border:1px solid var(--border2);background:var(--card);transition:all .2s;
}
.dsel-btn.selected{background:var(--accent);border-color:var(--accent);box-shadow:0 0 12px rgba(99,102,241,.35);}
.dsel-btn .dbn{font-size:1.5rem;font-weight:800;color:var(--text);display:block;font-family:'DM Mono',monospace;}
.dsel-btn .dbp{font-size:10px;font-weight:800;color:var(--text2);display:block;font-family:'DM Mono',monospace;letter-spacing:.3px;}
.dsel-btn.selected .dbn,.dsel-btn.selected .dbp{color:#fff;}

/* ── DIGIT BARS (with animated height) ── */
.dbar-wrap{display:flex;gap:4px;align-items:flex-end;height:100px;margin:8px 0;}
.dbar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;}
.dbar-fill{width:100%;border-radius:4px 4px 0 0;transition:height .45s cubic-bezier(.4,0,.2,1);min-height:4px;}
.dbar-lbl{font-size:9.5px;font-weight:800;color:var(--text);font-family:'DM Mono',monospace;}
.dbar-pct{font-size:9px;color:var(--text2);font-weight:800;font-family:'DM Mono',monospace;letter-spacing:.2px;}

/* ── EVEN/ODD ROWS ── */
.eo-row{margin-bottom:6px;}
.eo-label{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-family:'DM Mono',monospace;}
.eo-cells{display:flex;gap:4px;}
.eo-cell{
  flex:1;border-radius:9px;text-align:center;padding:7px 2px;
  border:1px solid var(--border2);transition:all .3s;
}
.eo-cell .ecn{font-size:14px;font-weight:700;color:var(--text);display:block;font-family:'DM Mono',monospace;}
.eo-cell .ecp{font-size:8.5px;font-weight:600;color:var(--muted);display:block;font-family:'DM Mono',monospace;}
.eo-cell .ecb{height:3px;border-radius:2px;margin:3px 4px 0;transition:width .45s ease;}
.eo-cell.active{border-color:var(--green);background:rgba(16,185,129,.08);}
.eo-cell.strong{border-color:var(--orange);}

/* ── CANDLE CHART ── */
#chart-area-wrap{width:100%;display:flex;flex-direction:column;margin-bottom:8px;border-radius:10px;overflow:hidden;border:1px solid var(--border);}
/* VFP Legend */
#vfp-legend{position:absolute;top:5px;left:8px;z-index:10;display:flex;align-items:center;gap:7px;flex-wrap:wrap;pointer-events:none;}
.vfp-leg-item{font-size:7.5px;font-weight:700;letter-spacing:.5px;display:flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;}
.vfp-leg-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
#vfp-regime-badge{
  position:absolute;top:5px;right:8px;z-index:10;
  font-size:7px;font-weight:700;padding:2px 8px;border-radius:7px;
  letter-spacing:.6px;font-family:'DM Mono',monospace;border:1px solid transparent;
}
#vfp-confidence-bar{position:absolute;bottom:0;left:0;right:0;height:2px;background:#060a12;}
#vfp-confidence-fill{height:100%;border-radius:0;transition:width .4s ease,background .4s ease;}

/* ── INDICATOR TOGGLE BUTTONS ── */
.ind-toggle{
  display:flex;align-items:center;gap:3px;padding:3px 8px;
  border-radius:6px;font-size:7.5px;font-weight:700;letter-spacing:.8px;
  text-transform:uppercase;cursor:pointer;border:1px solid #161b28;
  background:#090e18;color:#3a4560;transition:all .2s;flex-shrink:0;
  font-family:'DM Mono',monospace;
  -webkit-tap-highlight-color:transparent;
}
.ind-toggle.active{background:#0f1828;border-color:#2a3550;color:#8899bb;}
.ind-toggle:active{opacity:.65;}

/* TCPI panel removed — chart takes full height */
#vfp-pane{display:none !important;}
#chart-container{width:100%;height:calc(100dvh - 268px);min-height:320px;background:#0A0A0D;}

/* ── CANDLE COUNTER ── */
.candle-row{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0;}
.cnd{width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:white;}

/* ── PILLS ── */
.pill{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:20px;font-size:8.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin:2px;font-family:'DM Mono',monospace;}
.pg{background:rgba(16,185,129,.12); color:var(--green); border:1px solid rgba(16,185,129,.35);}
.pr{background:rgba(244,63,94,.12);  color:var(--red);   border:1px solid rgba(244,63,94,.35);}
.po{background:rgba(245,158,11,.12); color:var(--orange);border:1px solid rgba(245,158,11,.35);}
.pa{background:rgba(99,102,241,.12); color:var(--accent);border:1px solid rgba(99,102,241,.35);}
.pt{background:rgba(20,184,166,.10); color:var(--teal);  border:1px solid rgba(20,184,166,.35);}

/* ── WORM ── */
.worm{display:flex;gap:2px;margin:5px 0;flex-wrap:nowrap;overflow:hidden;}
.wdot{width:14px;height:14px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:900;color:#fff;}

/* ── PSTRIP ── */
.pstrip{display:flex;gap:2px;align-items:flex-end;height:32px;margin:5px 0;}
.pbar{flex:1;border-radius:2px 2px 0 0;min-height:3px;transition:height .4s ease;}

/* ── METER ── */
.meter-wrap{position:relative;height:12px;border-radius:6px;background:linear-gradient(to right,var(--red),var(--orange),var(--green));margin:6px 0;overflow:visible;}
.meter-needle{position:absolute;top:-4px;width:4px;height:20px;background:var(--text);border-radius:2px;transform:translateX(-50%);transition:left .6s ease;box-shadow:0 0 6px rgba(0,0,0,.4);}

/* ── OVER/UNDER DIRECTION TOGGLE ── */
.dir-toggle{display:flex;gap:6px;margin:8px 0;}
.dirtbtn{flex:1;padding:10px;border-radius:10px;text-align:center;font-size:12px;font-weight:900;cursor:pointer;border:2px solid var(--border);background:var(--card);color:var(--muted);transition:all .2s;text-transform:uppercase;letter-spacing:1px;}
.dirtbtn.sel-over{background:var(--green);border-color:var(--green);color:#fff;}
.dirtbtn.sel-under{background:var(--accent);border-color:var(--accent);color:#fff;}

/* ── CONSECUTIVE TRACKER ── */
.consec{display:flex;align-items:center;gap:6px;margin:8px 0;}
.consec-dots{display:flex;gap:4px;}
.consec-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;transition:all .3s;}
.consec-dot.hit{background:var(--green);border-color:var(--green);color:#fff;}
.consec-txt{font-size:10px;font-weight:700;color:var(--muted);}

/* ── TWO COL ── */
.twocol{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:5px 0;}
.tcell{background:var(--card);border:1px solid var(--border);border-radius:8px;text-align:center;padding:7px 4px;}
.tv{font-size:1.2rem;font-weight:900;color:var(--accent);line-height:1;}
.tl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-top:3px;font-family:'Inter',sans-serif;}

/* ── RISK SLIDER VIS ── */
.risk-vis{height:20px;border-radius:10px;background:linear-gradient(to right,var(--green),var(--orange),var(--red));position:relative;margin:8px 0;}
.risk-marker{position:absolute;top:-4px;width:6px;height:28px;background:var(--text);border-radius:3px;transform:translateX(-50%);transition:left .6s ease;}

/* ── SOUND BTN ── */
.sound-btn{width:30px;height:30px;border-radius:8px;background:var(--panel);border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;}

/* ── FLASH ── */
@keyframes flash{0%{background:rgba(63,81,181,.15);}100%{background:transparent;}}
.updated{animation:flash .4s ease;}

/* ── DISCLAIMER FOOTER ── */

/* ── CANDLE GLOW ── */
@keyframes glowPulse{0%,100%{box-shadow:0 0 8px rgba(0,200,83,.6);}50%{box-shadow:0 0 20px rgba(0,200,83,.9);}}
.glow{animation:glowPulse 1.2s infinite;}
.glow-red{animation:glowPulseRed 1.2s infinite;}
@keyframes glowPulseRed{0%,100%{box-shadow:0 0 8px rgba(255,82,82,.6);}50%{box-shadow:0 0 20px rgba(255,82,82,.9);}}

/* ── STAG ── */
.stag{display:inline-block;background:var(--accent);color:#fff;font-size:7.5px;font-weight:800;padding:3px 9px;border-radius:10px;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;font-family:'Inter',sans-serif;}
<\/style>
</head>
<body>

<!-- SIGNAL HISTORY DRAWER -->
<div id="sig-drawer" onclick="if(event.target===this)closeSigDrawer()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:20000;align-items:flex-end;backdrop-filter:blur(4px)">
  <div style="width:100%;max-height:84vh;background:var(--panel-bg);border-radius:16px 16px 0 0;border-top:2px solid var(--accent);display:flex;flex-direction:column;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
      <span style="font-size:14px;font-weight:900;color:var(--text-main)">📋 Signal Log</span>
      <div onclick="closeSigDrawer()" style="width:30px;height:30px;border-radius:50%;background:var(--surface);border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--muted)">✕</div>
    </div>
    <!-- Win Rate card -->
    <div id="wr-card" style="display:none;flex-shrink:0;padding:11px 16px;background:var(--surface);border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)">Session Win Rate</span>
        <span id="wr-pct" style="font-size:1.5rem;font-weight:900;font-family:monospace;color:#00c853">—</span>
      </div>
      <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div id="wr-bar" style="height:100%;border-radius:3px;width:0%;background:#00c853;transition:width .5s,background .5s"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:var(--muted);margin-top:4px;font-family:monospace">
        <span id="wr-w">0 wins</span><span id="wr-l">0 losses</span><span id="wr-t">0 trades</span>
      </div>
    </div>
    <!-- Trade buttons -->
    <div style="flex-shrink:0;padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
      <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);flex-shrink:0">Log result:</span>
      <button onclick="logTrade('win')" style="flex:1;padding:10px;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;border:1.5px solid #00c853;background:rgba(0,200,83,.12);color:#00c853;font-family:inherit">✓ WIN</button>
      <button onclick="logTrade('loss')" style="flex:1;padding:10px;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;border:1.5px solid #ef4444;background:rgba(239,68,68,.1);color:#ef4444;font-family:inherit">✗ LOSS</button>
      <button onclick="clearTrades()" style="padding:8px 10px;border-radius:8px;font-size:10px;font-weight:700;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;font-family:inherit">Clear</button>
    </div>
    <!-- Log entries -->
    <div id="sig-entries" style="overflow-y:auto;flex:1;padding:0 16px 20px">
      <div style="text-align:center;color:var(--muted);font-size:11px;padding:28px">Signals log here automatically as they appear</div>
    </div>
  </div>
</div>
<!-- HEADER -->
<header>
  <div class="hbrand">Signal <span>Engine</span></div>
  <div class="hlive">
    <div class="ldot"></div>
    <div class="ltxt">LIVE</div>
    <div class="ltick" id="tick-count">0</div>
  </div>
  <div class="sound-btn thm-btn" id="sound-btn" title="Sound alerts">🔔</div>
  <button onclick="openSigDrawer()" title="Signal log &amp; trade tracker" style="padding:5px 11px;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:monospace;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:all .15s" onmouseenter="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">📋 Log</button>
  <div class="thm-btn" id="thm-toggle-btn" onclick="toggleTheme()" title="Toggle theme">🌙</div>
</header>

<!-- TICK COUNTDOWN STRIP -->
<div id="tick-countdown" style="display:none;height:26px;background:var(--panel-bg);border-bottom:1px solid var(--border);padding:0 14px;gap:10px;align-items:center;flex-shrink:0">
  <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);white-space:nowrap">Next tick</span>
  <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div id="tcd-bar" style="height:100%;border-radius:2px;background:#00c853;width:100%;transition:width .1s linear,background .3s"></div></div>
  <span id="tcd-secs" style="font-family:monospace;font-size:11px;font-weight:700;min-width:32px;text-align:right">—</span>
  <span id="tcd-price-mini" style="font-family:monospace;font-size:10px;color:var(--muted);min-width:60px;text-align:right">—</span>
</div>
<!-- ROOM TABS -->
<div class="room-tabs" id="room-tabs">
  <div class="rtab on" onclick="setRoom(0)">📶 Signals</div>
  <div class="rtab" onclick="setRoom(1)">🔬 Patterns</div>
  <div class="rtab" onclick="setRoom(2)">📊 Stats</div>
  <div class="rtab" onclick="setRoom(3)">📖 Guide</div>
</div>

<!-- MARKET + TIMEFRAME BAR -->
<div class="mkt-bar">
  <select class="mkt-select" id="mkt-cat" style="max-width:110px;font-size:10px;padding:5px 6px;" onchange="changeCat(this.value)">
    <option value="volatility">Volatility</option>
    <option value="jump">Jump Indices</option>
    <option value="crash_boom">Crash & Boom</option>
    <option value="step">Step Indices</option>
  </select>
  <select class="mkt-select" id="mkt-select" style="flex:1;"></select>
  <select class="tf-select" id="tf-select" onchange="setTimeframe(parseInt(this.value))">
    <optgroup label="Minutes">
      <option value="60">1 minute</option>
      <option value="120">2 minutes</option>
      <option value="180">3 minutes</option>
      <option value="300">5 minutes</option>
      <option value="600">10 minutes</option>
      <option value="900">15 minutes</option>
      <option value="1800">30 minutes</option>
    </optgroup>
    <optgroup label="Hours">
      <option value="3600">1 hour</option>
      <option value="7200">2 hours</option>
      <option value="14400">4 hours</option>
      <option value="28800">8 hours</option>
      <option value="86400">24 hours</option>
    </optgroup>
  </select>
</div>

<!-- CONTENT AREA -->
<div class="content" id="content">

  <!-- Rise/Fall Tab -->
  <div id="tab-rf" class="tab-content view-active" data-ctx="rf">
    <!-- ROOM 1 -->
    <div id="rf-r0" class="room-page view-active">
      <div id="chart-area-wrap">
        <!-- VFPI Indicator Pane -->
        <div id="vfp-pane">
          <div id="vfp-legend">
            <span class="vfp-leg-item" style="color:#a0a0b0;">VFPI</span>
            <span class="vfp-leg-item"><span class="vfp-leg-dot" style="background:#00c853"></span><span style="color:#00c853;">Bullish</span></span>
            <span class="vfp-leg-item"><span class="vfp-leg-dot" style="background:#ff5252"></span><span style="color:#ff5252;">Bearish</span></span>
            <span class="vfp-leg-item"><span class="vfp-leg-dot" style="background:#ffeb3b"></span><span style="color:#ffeb3b;">Exhaustion</span></span>
            <span class="vfp-leg-item" id="vfp-val-label" style="color:#e0e0e0;font-size:9px;"></span>
          </div>
          <span id="vfp-regime-badge" style="background:#1e2230;color:#888;">— LOADING</span>
          <div id="vfp-confidence-bar"><div id="vfp-confidence-fill"></div></div>
        </div>

        <!-- Indicator Toggle Bar -->
        <div id="ind-toggle-bar" style="display:none;">
          <span style="font-size:6.5px;font-weight:700;color:#1e2535;letter-spacing:1.2px;text-transform:uppercase;flex-shrink:0;font-family:'DM Mono',monospace;">SHOW</span>
          <div class="ind-toggle active" id="tog-vfpi"    onclick="toggleInd('vfpi')"   ><span style="color:#7c7cff;">&#9632;</span> VFPI</div>
          <span id="ind-status-lbl" style="font-size:6.5px;font-weight:700;color:#1e2535;margin-left:auto;letter-spacing:.3px;font-family:'DM Mono',monospace;"></span>
          <div id="ind-settings-btn" onclick="isOpen()" title="Indicator Settings"
               style="cursor:pointer;margin-left:4px;width:22px;height:22px;border-radius:5px;
                      background:#090e18;border:1px solid #1e2535;display:flex;align-items:center;
                      justify-content:center;font-size:11px;transition:all .2s;
                      -webkit-tap-highlight-color:transparent;user-select:none;"
               onmouseenter="this.style.borderColor='#7c4dff'"
               onmouseleave="this.style.borderColor='#1e2535'">⚙️</div>
        </div>

        <!-- TCPI: Tick Cluster Pressure Index -->
        <!-- Main Candle Chart -->
        <div id="chart-container"></div>
      </div>
      <!-- Candle counter -->
    </div>
    <!-- ROOM 2 -->
    <div id="rf-r1" class="room-page">
      <div class="card">
        <div class="ctitle">⚡ Trend Strength — Buyer vs Seller</div>
        <div id="rf-trend-bar"></div>
      </div>
      <div class="card">
        <div class="ctitle">🌊 How Jumpy is the Price Right Now?</div>
        <div id="rf-vol-meter"></div>
        <div id="rf-vol-label" style="text-align:center;font-size:10px;font-weight:900;margin-top:4px;"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔥 Run Tracker (Streak)</div>
        <div id="rf-streak"></div>
      </div>
      <div class="card">
        <div class="ctitle">📍 Price Zone</div>
        <div id="rf-zones"></div>
      </div>
      <div class="card">
        <div class="ctitle">🐛 Price Worm (Last 30 Ticks)</div>
        <div id="rf-worm"></div>
      </div>
    </div>
    <!-- ROOM 3 -->
    <div id="rf-r2" class="room-page">
      <div class="card">
        <div class="ctitle">📏 How Spread Out Are Prices?</div>
        <div class="stag">Standard Deviation</div>
        <div id="rf-spread"></div>
      </div>
      <div class="card">
        <div class="ctitle">📈 Price Momentum Direction</div>
        <div class="stag">Momentum Decay</div>
        <div id="rf-momentum"></div>
      </div>
      <div class="card">
        <div class="ctitle">🏆 Pattern Success Rate (last 100 ticks)</div>
        <div id="rf-winrate"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔗 RSI — Market Strength Meter</div>
        <div id="rf-rsi"></div>
      </div>
      <div class="twocol">
        <div class="tcell"><div class="tv" id="rf-ema20">—</div><div class="tl">20 EMA (avg line)</div></div>
        <div class="tcell"><div class="tv" id="rf-price-now">—</div><div class="tl">Current Price</div></div>
      </div>
    </div>
    <!-- ROOM 4 — Guide -->
    <div id="rf-r3" class="room-page">
      <div class="card">
        <div class="ctitle">🕯️ 3-Candle Pattern Tracker</div>
        <div id="rf-candle-display" style="margin-bottom:6px;"></div>
        <div id="rf-entry-box"></div>
      </div>
      <div class="card">
        <div class="ctitle">📊 Live Price Movement</div>
        <div id="rf-pstrip"></div>
        <div id="rf-dualbar"></div>
      </div>
      <div class="card">
        <div class="ctitle">📐 How To Trade (3-Candle Method)</div>
        <div class="cr"><div class="cd cd-i">1</div><div>Watch for 3 green candles in a row</div></div>
        <div class="cr"><div class="cd cd-i">2</div><div>When 4th opens → enter <strong>RISE</strong></div></div>
        <div class="cr"><div class="cd cd-i">3</div><div>Watch for 3 red candles → enter <strong>FALL</strong> on 4th</div></div>
        <div class="cr"><div class="cd cd-w">!</div><div>Duration: 1–5 ticks or 1–2 minutes</div></div>
        <div class="cr"><div class="cd cd-n">✗</div><div>Stop after 3 losses — take a break</div></div>
      </div>
    </div>
  </div>

  <!-- Over/Under Tab -->
  <div id="tab-ou" class="tab-content" data-ctx="ou">
    <!-- ROOM 1 -->
    <div id="ou-r0" class="room-page view-active">
      <!-- LIVE TICK PRICE — Over/Under -->
      <div class="card" style="background:linear-gradient(135deg,rgba(63,81,181,.10),rgba(63,81,181,.03));border-color:rgba(63,81,181,.3);">
        <div class="ctitle">⚡ LAST TICK — LIVE PRICE</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <div id="ou-live-price" style="font-size:1.6rem;font-weight:900;color:var(--accent);font-family:monospace;letter-spacing:1px;">—</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <div id="ou-live-digit" style="width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:900;border:2px solid var(--accent);color:var(--accent);transition:all .15s ease;">—</div>
            <div id="ou-live-verdict" style="font-size:11px;font-weight:900;text-align:center;line-height:1.3;min-width:48px;">—</div>
          </div>
        </div>
        <div id="ou-live-worm" style="margin-top:2px;"></div>
      </div>
      <div class="card">
        <div class="ctitle">🎯 Step 1 — Choose Your Barrier Digit</div>
        <div class="dsel-grid" id="ou-barrier-grid"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔀 Step 2 — Choose Direction</div>
        <div class="dir-toggle">
          <div class="dirtbtn" id="dir-over" onclick="setDir('over')">🔼 OVER<br><span style="font-size:8px;font-weight:400">Above barrier</span></div>
          <div class="dirtbtn" id="dir-under" onclick="setDir('under')">🔽 UNDER<br><span style="font-size:8px;font-weight:400">Below barrier</span></div>
        </div>
      </div>
      <div class="card">
        <div class="ctitle">🌡️ Step 3 — Live Digit Strength</div>
        <div id="ou-dbar-wrap" class="dbar-wrap"></div>
        <div id="ou-dgrid" class="dgrid"></div>
      </div>
      <div id="ou-entry-card" class="card green">
        <div class="ctitle">⚡ Entry Signal</div>
        <div id="ou-signal-box"></div>
      </div>
    </div>
    <!-- ROOM 2 -->
    <div id="ou-r1" class="room-page">
      <div class="card">
        <div class="ctitle">⚖️ Over vs Under Total Strength</div>
        <div id="ou-split-bar"></div>
        <div id="ou-gap-info"></div>
      </div>
      <div class="card">
        <div class="ctitle">🌡️ All 10 Digits — Heat Map</div>
        <div id="ou-heatmap" class="dgrid"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:7.5px;font-weight:700;">
          <span style="color:var(--red)">■ Very common</span>
          <span style="color:var(--orange)">■ Common</span>
          <span style="color:var(--accent)">■ Normal</span>
          <span style="color:#1a237e">■ Rare</span>
        </div>
      </div>
      <div class="card orange">
        <div class="ctitle">⚠️ Safety Alerts</div>
        <div id="ou-safety"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔄 Digit Changes (Last 50 vs All 1000)</div>
        <div id="ou-drift"></div>
      </div>
    </div>
    <!-- ROOM 3 -->
    <div id="ou-r2" class="room-page">
      <div class="card">
        <div class="ctitle">📊 Which Side Wins Most Often?</div>
        <div class="stag">Statistical Analysis</div>
        <div id="ou-stat-side"></div>
      </div>
      <div class="card">
        <div class="ctitle">⏰ Digits That Are "Due" to Appear</div>
        <div class="stag">Mean Reversion</div>
        <div id="ou-due"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔢 Barrier Hit Frequency</div>
        <div id="ou-barrier-freq"></div>
      </div>
      <div class="card">
        <div class="ctitle">🎲 How Random Is This Market?</div>
        <div class="stag">Shannon Entropy</div>
        <div id="ou-entropy"></div>
      </div>
    </div>
  </div>

  <!-- Even/Odd Tab -->
  <div id="tab-eo" class="tab-content" data-ctx="eo">
    <!-- ROOM 1 -->
    <div id="eo-r0" class="room-page view-active">
      <!-- LIVE TICK PRICE — Even/Odd -->
      <div class="card" style="background:linear-gradient(135deg,rgba(255,145,0,.10),rgba(255,145,0,.03));border-color:rgba(255,145,0,.3);">
        <div class="ctitle">⚡ LAST TICK — LIVE PRICE</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <div id="eo-live-price" style="font-size:1.6rem;font-weight:900;color:var(--accent);font-family:monospace;letter-spacing:1px;">—</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <div id="eo-live-digit" style="width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:900;border:2px solid var(--accent);color:var(--accent);transition:all .15s ease;">—</div>
            <div id="eo-live-verdict" style="font-size:11px;font-weight:900;text-align:center;line-height:1.3;min-width:48px;">—</div>
          </div>
        </div>
        <div id="eo-live-worm" style="margin-top:2px;"></div>
      </div>
      <div class="card green">
        <div class="ctitle">🔢 Even/Odd Live Signal</div>
        <div id="eo-signal"></div>
      </div>
      <div class="card">
        <div class="ctitle">🟢 Even Digits (0, 2, 4, 6, 8)</div>
        <div id="eo-even-row" class="eo-row"><div class="eo-cells" id="eo-even-cells"></div></div>
        <div id="eo-even-status"></div>
      </div>
      <div class="card">
        <div class="ctitle">🟠 Odd Digits (1, 3, 5, 7, 9)</div>
        <div id="eo-odd-row" class="eo-row"><div class="eo-cells" id="eo-odd-cells"></div></div>
        <div id="eo-odd-status"></div>
      </div>
      <div class="card">
        <div class="ctitle">🎯 Consecutive Counter</div>
        <div id="eo-consec"></div>
        <div id="eo-entry-box"></div>
      </div>
    </div>
    <!-- ROOM 2 -->
    <div id="eo-r1" class="room-page">
      <div class="card">
        <div class="ctitle">⚖️ Even vs Odd Dominance</div>
        <div id="eo-balance"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔥 Hot / Cold Digit Status</div>
        <div id="eo-hotcold"></div>
      </div>
      <div class="card orange">
        <div class="ctitle">⚠️ Spike Alert</div>
        <div id="eo-spike"></div>
      </div>
      <div class="card">
        <div class="ctitle">📊 Live Parity Bars</div>
        <div id="eo-parity-bars" class="dbar-wrap"></div>
      </div>
    </div>
    <!-- ROOM 3 -->
    <div id="eo-r2" class="room-page">
      <div class="card">
        <div class="ctitle">📈 Even vs Odd History (last 100 ticks)</div>
        <div id="eo-history-bar"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔗 Which Digits Move Together?</div>
        <div class="stag">Digit Correlation</div>
        <div id="eo-correlation"></div>
      </div>
      <div class="card">
        <div class="ctitle">⏳ Moving Toward Balance or Away?</div>
        <div class="stag">Probability Convergence</div>
        <div id="eo-convergence"></div>
      </div>
      <div class="card">
        <div class="ctitle">🔢 Full Digit Distribution (1000 ticks)</div>
        <div id="eo-distribution"></div>
      </div>
    </div>
  </div>

  <!-- Best Signal Tab -->

  <!-- Patterns Tab -->
  <div id="unified-patterns" class="room-page" style="padding:8px 8px 80px 8px;">
    <div class="card" style="background:linear-gradient(135deg,rgba(0,188,212,.08),rgba(0,188,212,.03));border-color:rgba(0,188,212,.25);">
      <div class="ctitle">⚡ LAST TICK — LIVE PRICE</div>
      <div id="up-tick-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <div id="up-tick-price" style="font-size:1.7rem;font-weight:900;color:var(--accent);font-family:monospace;letter-spacing:1px;">—</div>
        <div id="up-tick-digit" style="width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;border:2px solid var(--accent);color:var(--accent);transition:all .15s ease;">—</div>
      </div>
      <div id="up-tick-worm"></div>
    </div>
    <div class="card"><div class="ctitle">⚡ Trend Strength — Buyer vs Seller</div><div id="up-trend-bar"></div></div>
    <div class="card"><div class="ctitle">🌊 How Jumpy is the Price Right Now?</div><div id="up-vol-meter"></div><div id="up-vol-label" style="text-align:center;font-size:10px;font-weight:700;margin-top:6px;"></div></div>
    <div class="card"><div class="ctitle">🔥 Run Tracker (Streak)</div><div id="up-streak"></div></div>
    <div class="card"><div class="ctitle">📍 Price Zone</div><div id="up-zones"></div></div>
    <div class="card"><div class="ctitle">🐛 Price Worm (last 30 ticks)</div><div id="up-worm"></div></div>
    <div class="card"><div class="ctitle">⚖️ Even vs Odd Dominance</div><div id="up-balance"></div></div>
    <div class="card"><div class="ctitle">🔥 Hot / Cold Digit Status</div><div id="up-hotcold"></div></div>
    <div class="card orange"><div class="ctitle">⚠️ Spike Alert</div><div id="up-spike"></div></div>
    <div class="card"><div class="ctitle">📊 Live Parity Bars</div><div id="up-parity-bars" class="dbar-wrap"></div></div>
  </div>

</div><!-- /content -->

<!-- BOTTOM NAV -->
<nav class="bot-nav">
  <div class="bnav on" id="bnav-rf" onclick="setTab('rf')">
    <div class="bnav-icon" style="font-size:1.3rem;">📈</div>
    <div class="bnav-txt" style="color:#00c853;">Rise/Fall</div>
  </div>
  <div class="bnav" id="bnav-ou" onclick="setTab('ou')">
    <div class="bnav-icon" style="font-size:1.3rem;">🔼</div>
    <div class="bnav-txt" style="color:#3f51b5;">Over/Under</div>
  </div>
  <div class="bnav" id="bnav-eo" onclick="setTab('eo')">
    <div class="bnav-icon" style="font-size:1.3rem;">🔢</div>
    <div class="bnav-txt" style="color:#ff9100;">Even/Odd</div>
  </div>

</nav>

<script>
'use strict';
//  GLOBAL STATE
const APP_ID = (function(){ try{ return window.parent._cfg ? window.parent._cfg('app_id') : '339uDFslsPc2j0sH6Uup1'; }catch(e){ return '339uDFslsPc2j0sH6Uup1'; } })();
let socket, masterSymbols = [], fullHistory = [], candleHistory = [];
let pipSize = 2, currentSymbol = '', activeTab = 'rf', activeRoom = 0;
let activeBarrier = 5, activeDir = 'over', granularity = 60;
let activeMktCat = 'volatility';
let chart, candleSeries, chartReady = false;
let vfpChart, vfpHistSeries, vfpLineSeries, vfpReady = false;

//  INDICATOR SETTINGS — all tuneable parameters live here.
//  Modified by the settings panel sliders in real-time.
var IND_SETTINGS = {
  // ── Signal sensitivity ──
  vfpi_sig_conf:   52,    // VFPI min confidence to fire signal     [30-80]
};
let soundOn = false, lastSoundSig = '';
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

//  THEME
function toggleTheme() {
  const d = document.documentElement;
  const isLight = d.getAttribute('data-theme') === 'light';
  if(isLight){
    d.setAttribute('data-theme','dark');
    localStorage.setItem('ceo_theme','dark');
    if(chart) chart.applyOptions({layout:{background:{color:'#09090B'},textColor:'#FAFAFA'}});
  } else {
    d.setAttribute('data-theme','light');
    localStorage.setItem('ceo_theme','light');
    if(chart) chart.applyOptions({layout:{background:{color:'#FFFFFF'},textColor:'#09090B'}});
  }
  _syncThemeIcon();
}
function _syncThemeIcon(){
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const btn = document.getElementById('thm-toggle-btn');
  if(btn) btn.textContent = isLight ? '🌙' : '☀️';
}
function loadTheme(){
  const saved = localStorage.getItem('ceo_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  setTimeout(_syncThemeIcon, 0);
}
loadTheme();

//  SOUND
document.getElementById('sound-btn').onclick = () => {
  soundOn = !soundOn;
  document.getElementById('sound-btn').textContent = soundOn ? '🔔' : '🔕';
};
function beep(freq, dur, type) {
  freq = freq || 880; dur = dur || 0.15; type = type || 'sine';
  if(!soundOn) return;
  if(!audioCtx) audioCtx = new AudioCtx();
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.frequency.value = freq; o.type = type;
  g.gain.setValueAtTime(0.3, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+dur);
  o.start(); o.stop(audioCtx.currentTime+dur);
}

//  NAVIGATION — CSS class-based view switching (no style.display in logic)
const TABS = ['rf','ou','eo'];
function setTab(tab) {
  activeTab = tab; activeRoom = 0;
  // Toggle tab containers via CSS class — never touch style.display
  TABS.forEach(t => {
    const el = document.getElementById(\`tab-\${t}\`);
    if(el) el.classList.toggle('view-active', t === tab);
    document.getElementById(\`bnav-\${t}\`).classList.toggle('on', t === tab);
  });
  // Timeframe selector only relevant for Rise/Fall charting
  const tfSel = document.getElementById('tf-select');
  if(tfSel) tfSel.style.display = tab === 'rf' ? 'block' : 'none';
  updateRoomTabs();
  _lastRenderHash = '';
  renderAll();
}

function setRoom(r) {
  activeRoom = r;
  updateRoomTabs();
  _lastRenderHash = '';
  if(r === 1) { renderUnifiedPatterns(); } else { renderAll(); }
}

function updateRoomTabs() {
  const tabs = document.querySelectorAll('.rtab');
  tabs.forEach((t,i) => t.classList.toggle('on', i === activeRoom));
  const upEl = document.getElementById('unified-patterns');
  if(activeRoom === 1) {
    // Show patterns page, hide all room pages
    TABS.forEach(t => {
      for(let i = 0; i < 3; i++){
        const el = document.getElementById(\`\${t}-r\${i}\`);
        if(el) el.classList.remove('view-active');
      }
    });
    if(upEl) upEl.classList.add('view-active');
  } else if(activeRoom === 2) {
    // Stats: show all three *-r2 sections at once
    if(upEl) upEl.classList.remove('view-active');
    TABS.forEach(t => {
      const tabEl = document.getElementById(\`tab-\${t}\`);
      if(tabEl) tabEl.classList.add('view-active');
      for(let i = 0; i < 4; i++){
        const el = document.getElementById(\`\${t}-r\${i}\`);
        if(el) el.classList.toggle('view-active', i === 2);
      }
    });
  } else if(activeRoom === 3) {
    // Guide tab: only show rf-r3
    if(upEl) upEl.classList.remove('view-active');
    TABS.forEach(t => {
      const tabEl = document.getElementById(\`tab-\${t}\`);
      if(tabEl) tabEl.classList.toggle('view-active', t === activeTab);
      for(let i = 0; i < 4; i++){
        const el = document.getElementById(\`\${t}-r\${i}\`);
        if(el) el.classList.toggle('view-active', t === 'rf' && i === 3);
      }
    });
  } else {
    if(upEl) upEl.classList.remove('view-active');
    TABS.forEach(t => {
      const tabEl = document.getElementById(\`tab-\${t}\`);
      if(tabEl) tabEl.classList.toggle('view-active', t === activeTab);
      for(let i = 0; i < 4; i++){
        const el = document.getElementById(\`\${t}-r\${i}\`);
        if(el) el.classList.toggle('view-active', t === activeTab && i === activeRoom);
      }
    });
  }
  document.getElementById('content').scrollTop = 0;
}

//  CHART (LightweightCharts)
function initChart() {
  if(typeof LightweightCharts === 'undefined'){ console.warn('LightweightCharts not available'); return; }
  var mainCont = document.getElementById('chart-container');
  var vfpCont  = document.getElementById('vfp-pane');
  if(!mainCont || !vfpCont) return;

  var SHARED_TS_BASE = {
    borderColor:'#2a2d3e', timeVisible:true, secondsVisible:false,
    rightOffset:5, barSpacing:6, minBarSpacing:2,
    fixLeftEdge:false, fixRightEdge:false,
  };

  // ── VFP Sub-Chart (indicator pane above candles) ──
  vfpChart = LightweightCharts.createChart(vfpCont, {
    layout:{ background:{color:'#131722'}, textColor:'#888' },
    grid:{ vertLines:{color:'#1a1d2e'}, horzLines:{color:'#1a1d2e'} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.Normal },
    rightPriceScale:{ borderColor:'#2a2d3e', autoScale:true, scaleMargins:{top:.1,bottom:.1} },
    timeScale:{ borderColor:'#2a2d3e', timeVisible:false, secondsVisible:false, rightOffset:5, barSpacing:6, minBarSpacing:2, fixLeftEdge:false, fixRightEdge:false },
    handleScroll:true, handleScale:true,
  });
  vfpHistSeries = vfpChart.addHistogramSeries({ priceFormat:{type:'price',precision:2,minMove:0.01}, priceScaleId:'right', base:0 });
  vfpLineSeries = vfpChart.addLineSeries({ color:'#7c7cff', lineWidth:1, priceScaleId:'right', crosshairMarkerVisible:true, crosshairMarkerRadius:3, lastValueVisible:true, priceLineVisible:false });
  vfpChart.addLineSeries({ color:'#2a2d3e', lineWidth:1, priceScaleId:'right', crosshairMarkerVisible:false, lastValueVisible:false, priceLineVisible:false }).setData([]);

  // ── Main Candle Chart — clean, no overlaid indicators ──
  chart = LightweightCharts.createChart(mainCont, {
    layout:{ background:{color:'#131722'}, textColor:'#e0e0e0' },
    grid:{ vertLines:{color:'#1e2230'}, horzLines:{color:'#1e2230'} },
    crosshair:{ mode:LightweightCharts.CrosshairMode.Normal },
    rightPriceScale:{ borderColor:'#2a2d3e', autoScale:true },
    timeScale:{ borderColor:'#2a2d3e', timeVisible:true, secondsVisible:false, rightOffset:5, barSpacing:6, minBarSpacing:2, fixLeftEdge:false, fixRightEdge:false },
    handleScroll:true, handleScale:true,
  });
  candleSeries = chart.addCandlestickSeries({ upColor:'#00c853', downColor:'#ff5252', borderUpColor:'#00c853', borderDownColor:'#ff5252', wickUpColor:'#00c853', wickDownColor:'#ff5252' });

  // Chart initialized — indicators slot in as needed

  // ── Sync scroll between VFPI pane and main chart ──
  var _syncing = false;
  chart.timeScale().subscribeVisibleLogicalRangeChange(function(r){
    if(_syncing || !r) return; _syncing=true;
    try{ vfpChart.timeScale().setVisibleLogicalRange(r); }catch(e){}
    _syncing=false;
  });
  vfpChart.timeScale().subscribeVisibleLogicalRangeChange(function(r){
    if(_syncing || !r) return; _syncing=true;
    try{ chart.timeScale().setVisibleLogicalRange(r); }catch(e){}
    _syncing=false;
  });

  chartReady = true;
  vfpReady   = true;
  if(candleHistory.length) updateChart();
}

// ── Indicator visibility toggles ──
var _indState = { vfpi:true };
function toggleInd(which){
  _indState[which] = !_indState[which];
  var btn = document.getElementById('tog-'+which);
  if(btn){ btn.classList.toggle('active', _indState[which]); }
  if(which === 'vfpi'){
    var vp = document.getElementById('vfp-pane');
    if(vp) vp.style.display = _indState.vfpi ? '' : 'none';
    if(!_indState.vfpi && vfpHistSeries){ try{ vfpHistSeries.setData([]); vfpLineSeries.setData([]); }catch(e){} }
    else if(candleHistory.length) updateVFP(candleHistory);
  }
}

function updateChart() {
  if(!chartReady || !candleSeries || !candleHistory.length) return;
  var data = [];
  for(var ui = 0; ui < candleHistory.length; ui++){
    var c = candleHistory[ui];
    data.push({ time:c.epoch, open:parseFloat(c.open), high:parseFloat(c.high), low:parseFloat(c.low), close:parseFloat(c.close) });
  }
  data.sort(function(a,b){ return a.time - b.time; });
  try {
    candleSeries.setData(data);
    chart.timeScale().scrollToRealTime();
  } catch(e){}
  // Defer heavy indicator calcs so candles paint first
  setTimeout(function(){
    try { updateVFP(candleHistory); }  catch(e){}
  }, 50);
}

//  STGAMA-VFPI ENGINE v2.0 — Synthetic Tick Geometry Adaptive MA
//  © CEOskit Proprietary — High-Conviction Crossover Signal Engine
//
//  Four novel layers specifically designed for Deriv synthetic indices:
//
//  HIGUCHI FRACTAL DIMENSION (HFD)
//    Deriv generators produce price with HFD 1.2-1.45 in trend epochs
//    and 1.65-1.85 in noise epochs. Real markets rarely drop below 1.5.
//    This filter is uniquely exploitable on synthetic data.
//
//  SYNTHETIC TICK MOMENTUM SIGNATURE (STMS)
//    Four consecutive same-direction closes with body/range > 0.55
//    indicates the pseudo-random generator is in a drift epoch.
//    Returns a signed score (positive = bullish drift, negative = bearish).
//
//  BAR PROFILE SKEWNESS (BPS)
//    5-bar rolling (upper_wick - lower_wick) / total_wick.
//    Negative = buyers defending lows (bullish).
//    Positive = sellers rejecting highs (bearish).
//
function calcVFPI(candles) {
  if(!candles || candles.length < 55) return [];

  var len = candles.length;
  var closes = [], highs = [], lows = [], opens = [];
  for(var ii = 0; ii < len; ii++){
    closes.push(parseFloat(candles[ii].close));
    highs.push(parseFloat(candles[ii].high));
    lows.push(parseFloat(candles[ii].low));
    opens.push(parseFloat(candles[ii].open));
  }

  var N  = 14;  // ER lookback period (internal to VFPI engine)
  var fk = 2 / (2  + 1); // fast EMA constant
  var sk = 2 / (50 + 1); // slow EMA constant

  // ── ATR (Wilder smoothing) ──
  var tr = new Float64Array(len), atr = new Float64Array(len);
  var i, j, s;
  for(i = 0; i < len; i++){
    var pc = i > 0 ? closes[i-1] : closes[i];
    tr[i] = Math.max(highs[i]-lows[i], Math.abs(highs[i]-pc), Math.abs(lows[i]-pc));
  }
  s = 0; for(i = 0; i < N; i++) s += tr[i];
  atr[N-1] = s / N;
  for(i = N; i < len; i++) atr[i] = (atr[i-1]*(N-1)+tr[i]) / N;

  // ── Efficiency Ratio (ER) — raw then triple-smoothed ──
  // Raw ER spikes on individual bars and causes both FAMA lines to snap
  // into noise moves. We compute raw ER first, then build three layers:
  //   erRaw  : standard Kaufman ER over N bars
  //   erSmF  : EMA(3) of raw ER  — used for FAMA Fast (still responsive)
  //   erSmS  : EMA(erSmF, 5)     — used for FAMA Slow (committed trend only)
  // Both smoothed values remove single-bar spikes that cause fake crossovers.
  var erRaw = new Float64Array(len);
  for(i = N; i < len; i++){
    var direction = Math.abs(closes[i]-closes[i-N]);
    var noise = 0;
    for(j = i-N+1; j <= i; j++) noise += Math.abs(closes[j]-closes[j-1]);
    erRaw[i] = noise < 1e-12 ? 0 : direction / noise;
  }
  var er    = erRaw; // keep alias for rest of function that reads er[]
  var erSmF = new Float64Array(len); // fast-smoothed ER (EMA 3)
  var erSmS = new Float64Array(len); // slow-smoothed ER (EMA 5 of erSmF)
  var kEF = 2.0/4.0, kES = 2.0/6.0;
  erSmF[N] = erRaw[N];
  erSmS[N] = erRaw[N];
  for(i = N+1; i < len; i++){
    erSmF[i] = erSmF[i-1] + kEF*(erRaw[i]-erSmF[i-1]);
    erSmS[i] = erSmS[i-1] + kES*(erSmF[i]-erSmS[i-1]);
  }


  // ── FAMA FAST — High-Reactivity Adaptive MA ──
  //
  //  Designed to hug price closely and walk through every candle.
  //  Floor = EMA(8): even in dead-ranging markets the line responds
  //  like a short-period MA, staying near price and clearly above Slow.
  //  Ceiling = EMA(2): in strong trends it becomes ultra-reactive.
  //
  //  Commitment counter still prevents a single candle from triggering
  //  a false crossover — but the much higher floor ensures the line
  //  is always visibly active and separated from the slower lines.
  //
  var SC_FAST_FLOOR = 2.0 / 9.0;    // EMA(8) — snappy minimum, hugs price
  var SC_FAST_MAX   = fk;             // EMA(2) — full reactive speed in trends
  var famaFast = new Float64Array(len);
  famaFast[N] = closes[N];
  var ffCommit = 0;
  for(i = N+1; i < len; i++){
    if(erSmF[i] >= 0.38) ffCommit = Math.min(ffCommit+1, 5);
    else                  ffCommit = Math.max(ffCommit-1, 0);
    // commitScale: 1.0 when committed, 0.6 forming, 0.35 idle
    // Even at 0.35 the floor ensures the line keeps walking
    var commitScale = ffCommit >= 2 ? 1.0 : ffCommit === 1 ? 0.60 : 0.35;
    var erF = erSmF[i] * commitScale;
    var scRaw = Math.pow(erF*erF*(fk-sk)+sk, 2);
    var sc = Math.max(SC_FAST_FLOOR, scRaw);
    famaFast[i] = famaFast[i-1] + sc*(closes[i]-famaFast[i-1]);
  }

  // ── FAMA SLOW — Long-Lag Adaptive MA, fundamentally different speed ──
  //
  //  Designed to track only the broader macro trend, ignoring candle-level
  //  noise entirely. Floor = EMA(100): in ranging markets this line barely
  //  moves — like a very long MA anchored to the prevailing structure.
  //  This creates a wide, clear visual gap from FAMA Fast in ranging conditions
  //  and only closes toward Fast during genuine sustained trend phases.
  //
  //  Uses erSmS (double-smoothed ER, EMA-5 of EMA-3) and ER^0.45 power
  //  (more sub-linear than before) — extra penalty for low-ER environments
  //  so the slow line truly lags well behind Fast until a real trend locks in.
  //
  var SC_SLOW_FLOOR = 2.0 / 101.0;  // EMA(100) — drifts slowly, wide gap from Fast
  var SC_SLOW_MAX   = 2.0 / 18.0;   // EMA(17)  — even in trends stays clearly lagged
  var famaSlow = new Float64Array(len);
  famaSlow[N] = closes[N];
  for(i = N+1; i < len; i++){
    var erS = erSmS[i];
    // Soft damping: 20% of raw ER in noise, 55% in transition, full in strong trend
    var erSgated = erS < 0.22 ? erS * 0.20
                 : erS < 0.42 ? erS * 0.55
                 : erS;
    // ER^0.45 — highly sub-linear: penalises noise, rewards only committed trends
    var erSp    = Math.pow(Math.max(0, erSgated), 0.45);
    var sc2Raw  = Math.pow(erSp*(fk-sk)+sk, 2);
    // Clamp between EMA(100) floor and EMA(17) ceiling
    var sc2 = Math.max(SC_SLOW_FLOOR, Math.min(SC_SLOW_MAX, sc2Raw));
    famaSlow[i] = famaSlow[i-1] + sc2*(closes[i]-famaSlow[i-1]);
  }

  // ── FAMA Velocity & Acceleration ──
  var famaVel = new Float64Array(len);
  var famaAcc = new Float64Array(len);
  for(i = N+2; i < len; i++){
    famaVel[i] = famaFast[i] - famaFast[i-1];
    famaAcc[i] = famaVel[i]  - famaVel[i-1];
  }

  // ── Higuchi Fractal Dimension (HFD) ──
  //    Approximated with k=1..4 over a rolling N-bar window.
  //    Slope of log(L_k) vs log(1/k) = fractal dimension.
  //    Unique filter for synthetics: HFD < 1.55 = trend epoch.
  var hfd = new Float64Array(len);
  for(i = N+4; i < len; i++){
    var hStart = i - N;
    var logk = [], logL = [];
    for(var k = 1; k <= 4; k++){
      var m = Math.floor((N-1)/k);
      if(m < 2) continue;
      var Lk = 0;
      for(var mi = 1; mi <= k; mi++){
        var Lm = 0;
        for(var jj = 1; jj <= m; jj++){
          var i1 = hStart + mi + (jj-1)*k;
          var i0 = hStart + mi + (jj-2)*k;
          if(i1 < len && i0 >= 0) Lm += Math.abs(closes[i1]-closes[i0]);
        }
        Lk += (Lm*(N-1)) / (k*k*m);
      }
      logk.push(Math.log(1/k));
      logL.push(Math.log(Math.max(1e-12, Lk/k)));
    }
    if(logk.length < 2){ hfd[i] = 1.5; continue; }
    var sx=0, sy=0, sxy=0, sxx=0, nn=logk.length;
    for(var p=0; p<nn; p++){ sx+=logk[p]; sy+=logL[p]; sxy+=logk[p]*logL[p]; sxx+=logk[p]*logk[p]; }
    var denom = nn*sxx - sx*sx;
    hfd[i] = denom === 0 ? 1.5 : Math.max(1.0, Math.min(2.0, (nn*sxy-sx*sy)/denom));
  }

  // ── Synthetic Tick Momentum Signature (STMS) ──
  //    Signed: positive = bullish generator drift, negative = bearish.
  var stms = new Float64Array(len);
  for(i = 3; i < len; i++){
    if(atr[i] < 1e-12) continue;
    var d0 = closes[i] > opens[i] ? 1 : -1;
    var ok = true, scoreS = 0;
    for(var b = i; b >= i-3; b--){
      var dB = closes[b] > opens[b] ? 1 : -1;
      if(dB !== d0){ ok = false; break; }
      var rng = highs[b]-lows[b];
      var bod = Math.abs(closes[b]-opens[b]);
      scoreS += rng > 0 ? bod/rng : 0.5;
    }
    stms[i] = ok ? (scoreS/4)*d0 : 0;
  }

  // ── Bar Profile Skewness (BPS) — 5-bar rolling ──
  var bps = new Float64Array(len);
  for(i = 4; i < len; i++){
    var bpsSum=0, bpsW=0;
    for(var bb = i; bb >= i-4; bb--){
      var btop = Math.max(closes[bb],opens[bb]);
      var bbot = Math.min(closes[bb],opens[bb]);
      var uw = highs[bb]-btop, lw = bbot-lows[bb], tw = uw+lw;
      var wt = 1.0/(i-bb+1);
      bpsSum += (tw > 1e-12 ? (uw-lw)/tw : 0)*wt;
      bpsW   += wt;
    }
    bps[i] = bpsW > 0 ? bpsSum/bpsW : 0;
  }

  // ── ROC Divergence Layer ──
  var roc = new Float64Array(len), rocEma = new Float64Array(len);
  var roc_k = 2.0/6.0;
  for(i = 3; i < len; i++) roc[i] = closes[i]-closes[i-3];
  rocEma[3] = roc[3];
  for(i = 4; i < len; i++) rocEma[i] = rocEma[i-1]+roc_k*(roc[i]-rocEma[i-1]);
  var divLayer = new Float64Array(len);
  for(i = N+1; i < len; i++){
    if(atr[i] < 1e-12) continue;
    divLayer[i] = (roc[i]-rocEma[i])/atr[i];
  }

  // ── ER EMA for regime detection ──
  var erEma = new Float64Array(len);
  var er_k  = 2.0/11.0;
  erEma[N] = er[N];
  for(i = N+1; i < len; i++) erEma[i] = erEma[i-1]+er_k*(er[i]-erEma[i-1]);

  // ── TAMP (Tick-Range Adaptive Momentum Pressure) ──
  var tamp = new Float64Array(len);
  for(i = N+1; i < len; i++){
    if(atr[i] < 1e-12) continue;
    tamp[i] = ((closes[i]-famaFast[i])/atr[i]) * (0.5+0.5*er[i]);
  }

  // ── VFPI Composite (5-layer) ──
  var vfpi       = new Float64Array(len);
  var vfpiSmooth = new Float64Array(len);
  var sm_k       = 2.0/4.0;
  for(i = N+5; i < len; i++){
    var raw = tamp[i]*50 + divLayer[i]*20;

    // HFD modifier: trending regime amplifies signal, noise dampens it
    var hfdF = hfd[i] > 0 ? Math.max(0.45, Math.min(1.55, (1.98-hfd[i])/0.43)) : 1.0;
    raw *= hfdF;

    // STMS generator drift boost (signed — direction critical)
    if(Math.abs(stms[i]) > 0.38) raw += stms[i]*22;

    // BPS wick-skewness layer (lower wick dominant = bullish push)
    raw += -bps[i]*12;

    // FAMA acceleration bonus/penalty (trend gaining vs losing speed)
    if(atr[i] > 1e-12){
      var normAcc = famaAcc[i]/atr[i];
      raw += Math.max(-14, Math.min(14, normAcc*28));
    }

    vfpi[i] = Math.max(-150, Math.min(150, raw));
  }
  vfpiSmooth[N+5] = vfpi[N+5];
  for(i = N+6; i < len; i++) vfpiSmooth[i] = vfpiSmooth[i-1]+sm_k*(vfpi[i]-vfpiSmooth[i-1]);

  // ── Confidence Score (0-100) ──
  var confidence = new Uint8Array(len);
  for(i = N+5; i < len; i++){
    var hfdBonus  = hfd[i] > 0 && hfd[i] < 1.48 ? 18 : hfd[i] < 1.62 ? 9 : 0;
    var stmsBonus = Math.abs(stms[i]) > 0.62 ? 14 : Math.abs(stms[i]) > 0.40 ? 7 : 0;
    var bpsBonus  = Math.abs(bps[i]) > 0.35 ? 8 : 0;
    var velBonus  = famaVel[i] !== 0 && famaAcc[i] !== 0 &&
                    Math.sign(famaVel[i]) === Math.sign(famaAcc[i]) ? 10 : 0;
    var erScore   = er[i]*36;
    var tampScore = Math.min(Math.abs(tamp[i]),2)/2*28;
    var divScore  = Math.min(Math.abs(divLayer[i]),1)*10;
    confidence[i] = Math.round(Math.min(100, erScore+tampScore+divScore+hfdBonus+stmsBonus+bpsBonus+velBonus));
  }

  // ── DUAL FAMA CROSSOVER SIGNAL (no-repaint: bar i-1 → bar i) ──
  //
  //  Separation guard: after the cross, fast and slow must be apart by
  //  at least 0.08 × ATR. Prevents micro-cross signals at near-zero gap.
  //  Prior bar (i-2) must be on opposite side — confirms real crossover,
  //  not just noise touching the median.
  //
  var SIG_CONF = (typeof IND_SETTINGS !== 'undefined' ? IND_SETTINGS.vfpi_sig_conf : 52);
  var results  = [];
  for(i = N+7; i < len; i++){
    if(!vfpi[i] && vfpi[i] !== 0) continue;
    var regime    = erSmF[i] > 0.30 ? 'trending' : 'ranging';
    var conf      = confidence[i];
    var fastPrev2 = famaFast[i-2], slowPrev2 = famaSlow[i-2];
    var fastCur   = famaFast[i],   slowCur   = famaSlow[i];
    var minSepV   = atr[i] * 0.08;
    // Must come from clear prior separation AND have real post-cross gap
    var bullCross = (fastPrev2 < slowPrev2) && (fastCur > slowCur) && (fastCur - slowCur >= minSepV);
    var bearCross = (fastPrev2 > slowPrev2) && (fastCur < slowCur) && (slowCur - fastCur >= minSepV);
    var isExhaust = Math.abs(vfpi[i]) > 85 && erSmF[i] < 0.16;

    var signal = null;
    if(bullCross && conf >= SIG_CONF && vfpi[i] > 0)       signal = 'buy';
    else if(bearCross && conf >= SIG_CONF && vfpi[i] < 0)  signal = 'sell';
    else if(isExhaust)                                       signal = 'exhaustion';

    results.push({
      time:       candles[i].epoch,
      vfpi:       vfpi[i],
      smooth:     vfpiSmooth[i],
      fama:       famaFast[i],
      famaSlow:   famaSlow[i],
      confidence: conf,
      regime:     regime,
      er:         er[i],
      hfd:        hfd[i],
      stms:       stms[i],
      bps:        bps[i],
      famaVel:    famaVel[i],
      famaAcc:    famaAcc[i],
      bullCross:  bullCross,
      bearCross:  bearCross,
      signal:     signal,
    });
  }
  return results;
}


// ── VFPI Renderer ──
function updateVFP(candles) {
  if(!vfpReady || !vfpHistSeries || !vfpLineSeries || candles.length < 40) return;
  const results = calcVFPI(candles);
  if(!results.length) return;

  // Histogram bars (green / red / yellow for exhaustion)
  const histData = results.map(r => ({
    time:  r.time,
    value: r.vfpi,
    color: Math.abs(r.vfpi) > 75 && r.er < 0.18
      ? '#ffeb3b'
      : r.vfpi >= 0
        ? 'rgba(0,200,83,' + Math.min(0.9, 0.3 + Math.abs(r.vfpi)/200).toFixed(3) + ')'
        : 'rgba(255,82,82,' + Math.min(0.9, 0.3 + Math.abs(r.vfpi)/200).toFixed(3) + ')'
  }));

  // Smoothed line
  const lineData = results.map(r => ({ time:r.time, value:r.smooth }));

  try {
    vfpHistSeries.setData(histData);
    vfpLineSeries.setData(lineData);
  } catch(e){}

  // ── Update legend UI ──
  const last = results[results.length-1];
  if(!last) return;
  const confFill = document.getElementById('vfp-confidence-fill');
  const badge    = document.getElementById('vfp-regime-badge');
  const valLabel = document.getElementById('vfp-val-label');
  if(confFill){
    const confColor = last.confidence>=70?'#00c853':last.confidence>=45?'#ff9100':'#ff5252';
    confFill.style.width   = last.confidence+'%';
    confFill.style.background = confColor;
  }
  // regime badge updated below with HFD + crossover info
  if(valLabel){
    const col = Math.abs(last.vfpi)>75&&last.er<0.18?'#ffeb3b':last.vfpi>=0?'#00c853':'#ff5252';
    // Show VFPI value + HFD + STMS in the legend label
    let labelParts = ['VFPI ' + last.vfpi.toFixed(1)];
    if(last.hfd  !== undefined) labelParts.push('HFD ' + last.hfd.toFixed(2));
    if(last.stms !== undefined) labelParts.push('STMS ' + last.stms.toFixed(2));
    valLabel.textContent = labelParts.join(' | ');
    valLabel.style.color = col;
  }

  // ── Dual FAMA crossover status in regime badge ──
  if(badge){
    const isTrend = last.regime === 'trending';
    const hfdTrend = last.hfd !== undefined && last.hfd < 1.55;
    const crossLabel = last.bullCross ? ' | F× ▲' : last.bearCross ? ' | F× ▼' : '';
    const hfdLabel   = hfdTrend ? ' | HFD✓' : '';
    badge.textContent = (isTrend ? '↗ TRENDING' : '↔ RANGING') +
                        ' | CONF ' + last.confidence + '%' + hfdLabel + crossLabel;
    badge.style.background = isTrend ? 'rgba(0,230,118,.08)' : 'rgba(255,145,0,.08)';
    badge.style.color      = isTrend ? '#00e676' : '#ff9100';
    badge.style.borderColor= isTrend ? 'rgba(0,230,118,.28)' : 'rgba(255,145,0,.28)';
  }
}
// ── ASSET SWITCH — bulletproof for long sessions ──
var _currentSym = '';
var _pendingSubscribeSymbol = null;
var _heartbeatTimer = null;

function clearChartData() {
  candleHistory = [];
  try{ if(candleSeries) candleSeries.setMarkers([]); }catch(e){}
}

function startHeartbeat() {
  stopHeartbeat();
  _heartbeatTimer = setInterval(function(){
    if(socket && socket.readyState === 1){
      socket.send(JSON.stringify({ping:1}));
    }
  }, 25000); // ping every 25s — keeps Deriv WS alive indefinitely
}

function stopHeartbeat() {
  if(_heartbeatTimer){ clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

function doSubscribe(symbol) {
  socket.send(JSON.stringify({forget_all:'ticks'}));
  socket.send(JSON.stringify({forget_all:'candles'}));
  socket.send(JSON.stringify({ticks:symbol, subscribe:1}));
  socket.send(JSON.stringify({ticks_history:symbol, style:'candles', granularity:granularity, count:500, end:'latest', subscribe:1}));
  socket.send(JSON.stringify({ticks_history:symbol, style:'ticks', count:1000, end:'latest'}));
}

// ── Listen for symbol sync from outer CEOSkit / Smart Analysis ──
window.addEventListener('message', function(e){
  if(!e.data || e.data.type !== 'ceoskit_setSymbol') return;
  var newSym = e.data.symbol;
  if(!newSym || newSym === currentSymbol) return;
  // Update the mkt-select dropdown to match
  var sel = document.getElementById('mkt-select');
  if(sel){
    var opt = sel.querySelector('option[value="'+newSym+'"]');
    if(opt){
      sel.value = newSym;
      _currentSym = '';
      subscribe(newSym);
    } else {
      // Symbol not in current category — try switching to volatility category
      var catSel = document.getElementById('mkt-cat');
      if(catSel){ catSel.value = 'volatility'; activeMktCat = 'volatility'; buildMarketList(); }
      setTimeout(function(){
        var sel2 = document.getElementById('mkt-select');
        if(sel2){ var opt2 = sel2.querySelector('option[value="'+newSym+'"]');
          if(opt2){ sel2.value = newSym; _currentSym = ''; subscribe(newSym); } }
      }, 200);
    }
  }
});

function subscribe(symbol) {
  if(!symbol) return;
  // Always update tracking — never skip based on _currentSym
  // (user may switch back to same asset after a reconnect)
  _currentSym   = symbol;
  currentSymbol = symbol;
  fullHistory   = [];
  clearChartData();

  if(!socket || socket.readyState === 3 || socket.readyState === 2) {
    // Dead or dying — queue and reconnect
    _pendingSubscribeSymbol = symbol;
    if(!socket || socket.readyState === 3) connect();
    return;
  }
  if(socket.readyState === 0) {
    // Still connecting — queue it
    _pendingSubscribeSymbol = symbol;
    return;
  }
  // OPEN — fire immediately
  _pendingSubscribeSymbol = null;
  doSubscribe(symbol);
}

function connect() {
  stopHeartbeat();
  // Signal engine uses public WS for market data only
  var _pubWs = 'wss://ws.derivws.com/websockets/v3?app_id=1';
  socket = new WebSocket(_pubWs);

  socket.onopen = function() {
    startHeartbeat();
    socket.send(JSON.stringify({active_symbols:'brief'}));
    // If we have a pending symbol (from reconnect), re-subscribe immediately
    if(_pendingSubscribeSymbol) {
      var s = _pendingSubscribeSymbol; _pendingSubscribeSymbol = null;
      _currentSym = ''; // clear so subscribe() doesn't think it's already set
      subscribe(s);
    }
  };

  socket.onmessage = function(msg) {
    var d = JSON.parse(msg.data);

    if(d.msg_type === 'pong') return; // heartbeat response — ignore

    if(d.msg_type === 'active_symbols') {
      masterSymbols = d.active_symbols;
      buildMarketList();
      return;
    }

    if(d.msg_type === 'history') {
      if(!d.history || !d.history.prices) return;
      var hSym = d.echo_req && d.echo_req.ticks_history ? d.echo_req.ticks_history : _currentSym;
      if(hSym !== _currentSym) return;
      var pips = d.pip_size || pipSize; pipSize = pips;
      var liveTicks = fullHistory.slice();
      fullHistory = [];
      d.history.prices.forEach(function(p, i){
        var prev = fullHistory.length > 0 ? fullHistory[fullHistory.length-1].price : p;
        fullHistory.push({price:p, digit:parseInt(p.toFixed(pips).slice(-1)), diff:p-prev, time:d.history.times[i]});
      });
      var lastHTime = fullHistory.length ? fullHistory[fullHistory.length-1].time : 0;
      liveTicks.forEach(function(t){ if(t.time && t.time > lastHTime) fullHistory.push(t); });
      if(fullHistory.length > 1000) fullHistory.splice(0, fullHistory.length - 1000);
      var tc = document.getElementById('tick-count');
      if(tc) tc.textContent = fullHistory.length;
      _lastRenderHash = '';
      renderAll();
      return;
    }

    if(d.msg_type === 'tick') {
      var pips2 = d.tick.pip_size || pipSize; pipSize = pips2;
      var p2    = d.tick.quote;
      var prev2 = fullHistory.length > 0 ? fullHistory[fullHistory.length-1].price : p2;
      fullHistory.push({price:p2, digit:parseInt(p2.toFixed(pips2).slice(-1)), diff:p2-prev2, time:d.tick.epoch});
      if(fullHistory.length > 1000) fullHistory.splice(0, 1);
      var tc2 = document.getElementById('tick-count');
      if(tc2) tc2.textContent = fullHistory.length;
      renderAll();
      return;
    }

    if(d.msg_type === 'candles') {
      var sym = d.echo_req && d.echo_req.ticks_history ? d.echo_req.ticks_history : _currentSym;
      if(sym !== _currentSym) return; // stale — discard
      candleHistory = d.candles;
      if(candleHistory.length > 5000) candleHistory = candleHistory.slice(-5000);
      try{ if(vfpHistSeries) vfpHistSeries.setData([]); }catch(e){}
      try{ if(vfpLineSeries) vfpLineSeries.setData([]); }catch(e){}
      updateChart();
      return;
    }

    if(d.msg_type === 'ohlc') {
      var oSym = d.echo_req && d.echo_req.ticks_history ? d.echo_req.ticks_history : null;
      if(oSym && oSym !== _currentSym) return; // ghost — discard
      if(!candleHistory.length) return;

      var o = d.ohlc, existing = -1;
      for(var ei = 0; ei < candleHistory.length; ei++){
        if(candleHistory[ei].epoch === o.open_time){ existing = ei; break; }
      }
      var candle = {epoch:o.open_time, open:o.open, high:o.high, low:o.low, close:o.close};
      var isNewCandle = existing < 0;
      if(existing >= 0) candleHistory[existing] = candle;
      else {
        candleHistory.push(candle);
        if(candleHistory.length > 5200) candleHistory.splice(0, 200);
      }
      if(chartReady && candleSeries){
        try{ candleSeries.update({time:o.open_time, open:parseFloat(o.open), high:parseFloat(o.high), low:parseFloat(o.low), close:parseFloat(o.close)}); }catch(e){}
      }
      if(isNewCandle && candleHistory.length >= 40) {
        try { updateVFP(candleHistory); }  catch(e){}
      }
    }
  };

  socket.onclose = function() {
    stopHeartbeat();
    // Always queue current symbol for re-subscribe on reconnect
    if(currentSymbol) _pendingSubscribeSymbol = currentSymbol;
    // Reset _currentSym so subscribe() won't skip re-subscription after reconnect
    _currentSym = '';
    setTimeout(connect, 3000);
  };

  socket.onerror = function() { try{ socket.close(); }catch(e){}; };
}

function setTimeframe(tf) {
  granularity = tf;
  var sel = document.getElementById('tf-select');
  if(sel) sel.value = tf;
  clearChartData();
  if(socket && socket.readyState === 1 && currentSymbol) {
    socket.send(JSON.stringify({forget_all:'candles'}));
    socket.send(JSON.stringify({ticks_history:currentSymbol,style:'candles',granularity:tf,count:500,end:'latest',subscribe:1}));
  }
}

// tf-select handled via onchange in HTML

function changeCat(cat){
  activeMktCat = cat;
  buildMarketList();
}

function buildMarketList() {
  var cat = activeMktCat || 'volatility';
  var filtered = masterSymbols.filter(function(m){
    var s2 = (m.underlying_symbol||m.symbol||'').toUpperCase();
    var d2 = (m.underlying_symbol_name||m.display_name||'').toUpperCase();
    if(cat==='volatility') return s2.startsWith('R_') || s2.startsWith('1HZ') || d2.includes('VOLATILITY');
    if(cat==='jump')       return d2.includes('JUMP');
    if(cat==='crash_boom') return d2.includes('CRASH') || d2.includes('BOOM');
    if(cat==='step')       return d2.includes('STEP');
    return false;
  });
  var sel = document.getElementById('mkt-select');
  if(!sel) return;
  sel.innerHTML = filtered.map(function(m){
    var sym  = m.underlying_symbol||m.symbol||'';
    var name = m.underlying_symbol_name||m.display_name||sym;
    return '<option value="' + sym + '">' + name + '</option>';
  }).join('');
  sel.onchange = function(e){
    _currentSym = '';
    var sym = e.target.value;
    subscribe(sym);
    // ── Sync symbol to outer SA and CEOSkit ──
    try { window.parent.postMessage({type:'ceoskit_setSymbol', symbol:sym}, '*'); } catch(err){}
  };
  // Auto-subscribe only on first load (no active symbol yet)
  if(!_currentSym && !currentSymbol && filtered.length) {
    subscribe(filtered[0].underlying_symbol || filtered[0].symbol || '');
  }
}

//  ANALYSIS HELPERS
function dPcts(n) {
  const sample=fullHistory.slice(-Math.min(n,fullHistory.length));
  const total=sample.length||1, counts=Array(10).fill(0);
  sample.forEach(t=>counts[t.digit]++);
  return counts.map((c,d)=>({digit:d,count:c,pct:(c/total)*100}));
}
function heatColor(pct) {
  // High-contrast palette optimised for Obsidian Dark (#09090B)
  if(pct>=13)return'#EF4444'; // bright red — very hot
  if(pct>=11)return'#F97316'; // bright orange — hot
  if(pct>=10)return'#EAB308'; // amber — above baseline
  if(pct>=9) return'#6366F1'; // indigo — baseline
  if(pct>=7) return'#14B8A6'; // teal — below baseline
  return'#3B82F6';            // blue — cold
}
function barColor(pct) {
  if(pct>=13)return'#EF4444';
  if(pct>=11)return'#F97316';
  if(pct>=10)return'#EAB308';
  if(pct>=9) return'#6366F1';
  return'#14B8A6';
}
function driftOf(d,longN,shortN) {
  longN = longN||1000; shortN = shortN||50;
  return dPcts(shortN)[d].pct - dPcts(longN)[d].pct;
}
function ema(prices,p) {
  if(prices.length<p)return null;
  const k=2/(p+1); let e=prices.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<prices.length;i++) e=prices[i]*k+e*(1-k);
  return e;
}
function rsiCalc(prices,p) {
  p = p||14;
  if(prices.length<p+1)return null;
  const sl=prices.slice(-p-1); let g=0,l=0;
  for(let i=1;i<sl.length;i++){const d=sl[i]-sl[i-1];d>0?g+=d:l-=d;}
  const ag=g/p,al=l/p; return al===0?100:100-(100/(1+ag/al));
}
function stdDev(vals) {
  if(!vals.length)return 0;
  const m=vals.reduce((a,b)=>a+b,0)/vals.length;
  return Math.sqrt(vals.reduce(function(a,b){return a+Math.pow(b-m,2);},0)/vals.length);
}
function curStreak() {
  // Uses candleHistory so it follows switched asset AND respects timeframe
  var hist = candleHistory.length >= 3 ? candleHistory : fullHistory;
  if(!hist.length) return {type:'N/A', len:0};
  var last = hist[hist.length-1];
  var isRise = candleHistory.length >= 3
    ? parseFloat(last.close) >= parseFloat(last.open)
    : last.diff >= 0;
  var type = isRise ? 'RISE' : 'FALL', len = 1;
  for(var si = hist.length-2; si >= 0; si--){
    var r2 = candleHistory.length >= 3
      ? parseFloat(hist[si].close) >= parseFloat(hist[si].open)
      : hist[si].diff >= 0;
    if((r2 ? 'RISE' : 'FALL') === type) len++;
    else break;
  }
  return {type:type, len:len};
}

function consecDir() {
  // Uses candleHistory for candle direction (asset + timeframe aware)
  var hist = candleHistory.length >= 3 ? candleHistory : fullHistory;
  var rC = 0, fC = 0;
  for(var di = hist.length-1; di >= 0; di--){
    var isUp = candleHistory.length >= 3
      ? parseFloat(hist[di].close) >= parseFloat(hist[di].open)
      : hist[di].diff >= 0;
    if(isUp){ rC++; if(fC>0) break; }
    else { if(rC>0) break; fC++; }
  }
  return {rise:rC, fall:fC};
}

// ── VFPI alignment helper ──
// Returns 'bull', 'bear', or 'neutral' based on last VFPI value
function getIndicatorBias() {
  // Access VFPI last value from the badge text (available in DOM)
  var badge = document.getElementById('vfp-regime-badge');
  var vfpVal = document.getElementById('vfp-val-label');
  if(!vfpVal) return 'neutral';
  var txt = vfpVal.textContent || '';
  var match = txt.match(/VFPI\s*([-\d.]+)/);
  if(!match) return 'neutral';
  var val = parseFloat(match[1]);
  if(val > 15)  return 'bull';
  if(val < -15) return 'bear';
  return 'neutral';
}

// ── Debounce renderAll — 40ms for snappy bar/strip updates on every tick ──
var _renderTimer = null;
var _lastRenderHash = '';
function renderAll() {
  if(fullHistory.length < 5) return;
  var last = fullHistory[fullHistory.length-1];
  var hash = currentSymbol + '|' + (last ? last.time : 0) + '|' + fullHistory.length;
  if(hash === _lastRenderHash) return;
  _lastRenderHash = hash;
  if(_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(function(){
    _renderTimer = null;
    if(activeRoom === 2) {
      try{renderRFStats();}catch(e){console.warn('rfStats err',e);}
      try{renderOU();}catch(e){console.warn('ou err',e);}
      try{renderEO();}catch(e){console.warn('eo err',e);}
    } else {
      if(activeTab === 'rf') renderRF();
      else if(activeTab === 'ou') renderOU();
      else if(activeTab === 'eo') renderEO();
    }
    if(activeRoom === 1) renderUnifiedPatterns();
  }, 40);
}
function consecEO() {
  let eC=0,oC=0;
  for(let i=fullHistory.length-1;i>=0;i--){
    const isE=fullHistory[i].digit%2===0;
    if(isE){eC++;if(oC>0)break;}else{if(eC>0)break;oC++;}
  }
  return{even:eC,odd:oC};
}
function kellyF(wp){const q=1-wp,b=0.95;return Math.max(0,Math.min((b*wp-q)/b,0.2))*100;}
function shannonEnt(){
  const s=dPcts(1000); const H=s.reduce((a,t)=>{const p=t.pct/100;return p>0?a-p*Math.log2(p):a;},0);
  return H/Math.log2(10);
}

// HTML helpers
function sbar(val,color,label){
  label = label||'';
  var v=Math.min(Math.max(val,0),100);
  return \`<div class="bwrap"><div class="bfill" style="width:\${v}%;background:\${color}"></div></div>\${label?\`<div class="blr"><span>\${label}</span><span style="color:var(--text);font-weight:900">\${v.toFixed(1)}%</span></div>\`:''}\`;
}
function dualB(rp){
  const r=Math.min(Math.max(rp,0),100),f=100-r;
  return \`<div class="dualbar"><div class="db-g" style="width:\${r}%"></div><div class="db-r" style="width:\${f}%"></div></div><div class="dlr"><span style="color:var(--green)">▲ RISE \${r.toFixed(0)}%</span><span style="color:var(--red)">FALL \${f.toFixed(0)}% ▼</span></div>\`;
}
// Even/Odd dual bar — shows EVEN / ODD labels (no RISE/FALL bleed)
function dualBEO(evenPct){
  const e=Math.min(Math.max(evenPct,0),100),o=100-e;
  return \`<div class="dualbar"><div class="db-g" style="width:\${e}%"></div><div class="db-r" style="width:\${o}%"></div></div><div class="dlr"><span style="color:var(--green)">🔵 EVEN \${e.toFixed(0)}%</span><span style="color:var(--orange)">🟠 ODD \${o.toFixed(0)}%</span></div>\`;
}
// Over/Under dual bar — shows OVER / UNDER labels (no RISE/FALL bleed)
function dualBOU(overPct){
  const ov=Math.min(Math.max(overPct,0),100),un=100-ov;
  return \`<div class="dualbar"><div class="db-g" style="width:\${ov}%"></div><div class="db-r" style="width:\${un}%"></div></div><div class="dlr"><span style="color:var(--green)">🔼 OVER \${ov.toFixed(0)}%</span><span style="color:var(--accent)">🔽 UNDER \${un.toFixed(0)}%</span></div>\`;
}
function pstripHTML(){
  const last=fullHistory.slice(-20); if(!last.length)return'';
  const ps=last.map(t=>t.price),mn=Math.min(...ps),mx=Math.max(...ps),rng=mx-mn||0.001;
  return \`<div class="pstrip">\${last.map(t=>\`<div class="pbar" style="height:\${Math.max(3,((t.price-mn)/rng)*28)}px;background:\${t.diff>=0?'var(--green)':'var(--red)'}"></div>\`).join('')}</div>\`;
}
function wormHTML(n=30){
  // Rise/Fall worm — only used on RF tab
  const w=fullHistory.slice(-n);
  return \`<div class="worm">\${w.map(t=>\`<div class="wdot" style="background:\${t.diff>=0?'var(--green)':'var(--red)'}">\${t.diff>=0?'R':'F'}</div>\`).join('')}</div>\`;
}
function wormDigitHTML(n=20){
  // Digit worm — for Over/Under tab: shows last digit 0-9, coloured by over/under vs activeBarrier
  const w=fullHistory.slice(-n);
  return \`<div class="worm">\${w.map(t=>{
    const d=t.digit!==undefined?t.digit:parseInt(String(t.price).slice(-1));
    const isOver=d>activeBarrier;
    const bg=isOver?'var(--green)':'var(--red)';
    return \`<div class="wdot" style="background:\${bg};font-size:9px;">\${d}</div>\`;
  }).join('')}</div>\`;
}
function wormParityHTML(n=20){
  // Parity worm — for Even/Odd tab: shows E/O, never R/F
  const w=fullHistory.slice(-n);
  return \`<div class="worm">\${w.map(t=>{
    const d=t.digit!==undefined?t.digit:parseInt(String(t.price).slice(-1));
    const isEven=d%2===0;
    return \`<div class="wdot" style="background:\${isEven?'var(--teal)':'var(--orange)'};">\${isEven?'E':'O'}</div>\`;
  }).join('')}</div>\`;
}

// ── renderAll replaced by debounced version above ──

//  PRO SIGNAL ENGINE — CEOskit Advanced Confluence System
//  Computes run recommendation (1-7) for each contract type
//  using 6 independent scoring layers weighted per contract.
function proSignal() {
  if(fullHistory.length < 100) return null;
  var p1000 = dPcts(1000), p200 = dPcts(200), p50 = dPcts(50);
  var prices = fullHistory.map(function(t){ return t.price; });
  var evenD = [0,2,4,6,8], oddD = [1,3,5,7,9];
  var n = fullHistory.length;

  var cd = consecDir(); var eoS = consecEO();
  var riseStreak = cd.rise, fallStreak = cd.fall;
  var evenStreak = eoS.even, oddStreak = eoS.odd;

  function groupEdge(dArr) {
    var long = dArr.reduce(function(a,d){ return a+p1000[d].pct; },0);
    var med  = dArr.reduce(function(a,d){ return a+p200[d].pct;  },0);
    var sht  = dArr.reduce(function(a,d){ return a+p50[d].pct;   },0);
    var magnitude = Math.abs(sht - long);
    var trending = (sht>med&&med>long)||(sht<med&&med<long);
    return { long:long, med:med, short:sht, trending:trending, magnitude:magnitude };
  }

  function driftScore(dArr) {
    var upD = dArr.filter(function(d){ return driftOf(d)>0.5; }).length;
    var dnD = dArr.filter(function(d){ return driftOf(d)<-0.5; }).length;
    return { up:upD, dn:dnD };
  }

  var evenEdge = groupEdge(evenD), oddEdge = groupEdge(oddD);
  var evenDrift = driftScore(evenD), oddDrift = driftScore(oddD);
  var oSum1000 = [5,6,7,8,9].reduce(function(a,d){ return a+p1000[d].pct; },0);
  var uSum1000 = [0,1,2,3,4].reduce(function(a,d){ return a+p1000[d].pct; },0);
  var oEdge50  = [5,6,7,8,9].reduce(function(a,d){ return a+p50[d].pct;   },0);
  var uEdge50  = [0,1,2,3,4].reduce(function(a,d){ return a+p50[d].pct;   },0);
  var overDrift = driftScore([5,6,7,8,9]), underDrift = driftScore([0,1,2,3,4]);

  var exp = n/10;
  var overdue = p1000.map(function(s){ return { digit:s.digit, deficit:exp-s.count, pct:s.pct, count:s.count }; });
  var evenOverdue  = overdue.filter(function(d){ return evenD.indexOf(d.digit)>=0&&d.deficit>Math.sqrt(n)*0.8; }).length;
  var oddOverdue   = overdue.filter(function(d){ return oddD.indexOf(d.digit)>=0 &&d.deficit>Math.sqrt(n)*0.8; }).length;
  var overDue5to9  = overdue.filter(function(d){ return d.digit>=5&&d.deficit>Math.sqrt(n)*0.6; }).length;
  var underDue0to4 = overdue.filter(function(d){ return d.digit<=4&&d.deficit>Math.sqrt(n)*0.6; }).length;

  var ent = shannonEnt(), stable = ent < 0.97;
  var cBias = getIndicatorBias();
  var riseConf = cBias==='bull'?1:cBias==='bear'?-1:0;
  var rises50r = fullHistory.slice(-50).filter(function(t){ return t.diff>=0; }).length;
  var rises50pct = rises50r/50;
  var vol = stdDev(fullHistory.slice(-100).map(function(t){ return t.diff; }));
  var volPenalty = vol>0.5?0.7:vol>0.2?0.88:1.0;

  // ── RISE/FALL ──
  var rfScore = 0, rfDir = riseStreak>=fallStreak?'RISE':'FALL';
  var rfStreak = rfDir==='RISE'?riseStreak:fallStreak;
  rfScore += Math.min(32, rfStreak*7);
  if(rfDir==='RISE'&&rises50pct>0.55) rfScore += Math.min(26,(rises50pct-0.5)*220);
  if(rfDir==='FALL'&&rises50pct<0.45) rfScore += Math.min(26,(0.5-rises50pct)*220);
  if(rfDir==='RISE'&&riseConf===1)  rfScore += 26;
  if(rfDir==='FALL'&&riseConf===-1) rfScore += 26;
  if(riseConf===0) rfScore += 8;
  if(stable) rfScore += 12;
  rfScore = Math.round(Math.min(100, rfScore * volPenalty));
  var rfRuns = rfScore>=90?7:rfScore>=80?6:rfScore>=68?5:rfScore>=54?4:rfScore>=40?3:rfScore>=26?2:rfScore>=15?1:0;

  // ── EVEN/ODD ──
  var evenAb11 = evenD.filter(function(d){ return p1000[d].pct>=11; }).length;
  var oddAb11  = oddD.filter(function(d){ return p1000[d].pct>=11; }).length;
  var eoDir = (oddAb11>evenAb11||(oddEdge.magnitude>evenEdge.magnitude&&oddEdge.short>oddEdge.long))?'ODD':'EVEN';
  var eoStrk = eoDir==='EVEN'?evenStreak:oddStreak;
  var eoEdge = eoDir==='EVEN'?evenEdge:oddEdge;
  var eoDrift2 = eoDir==='EVEN'?evenDrift:oddDrift;
  var eoOverdue = eoDir==='EVEN'?evenOverdue:oddOverdue;
  var eoScore = 0;
  eoScore += Math.min(30, eoStrk*10);
  eoScore += Math.min(26, eoEdge.magnitude*4.5); if(eoEdge.trending) eoScore+=10;
  eoScore += Math.min(20, eoDrift2.up*6);
  eoScore += Math.min(12, eoOverdue*6);
  if(stable) eoScore += 12;
  eoScore = Math.round(Math.min(100, eoScore));
  var eoRuns = eoScore>=90?7:eoScore>=80?6:eoScore>=68?5:eoScore>=54?4:eoScore>=40?3:eoScore>=26?2:eoScore>=15?1:0;

  // ── OVER/UNDER ──
  var ouDir = oSum1000>uSum1000?'OVER':'UNDER';
  var ouGap1000 = Math.abs(oSum1000-uSum1000);
  var ouGap50   = Math.abs(oEdge50-uEdge50);
  var ouDrift2  = ouDir==='OVER'?overDrift:underDrift;
  var ouOvr     = ouDir==='OVER'?overDue5to9:underDue0to4;
  var ouScore = 0;
  ouScore += Math.min(32, ouGap1000*3.2);
  if((ouDir==='OVER'&&oEdge50>uEdge50)||(ouDir==='UNDER'&&uEdge50>oEdge50)) ouScore+=Math.min(26,ouGap50*3.2);
  ouScore += Math.min(22, ouDrift2.up*6);
  ouScore += Math.min(14, ouOvr*5);
  if(stable) ouScore += 12;
  ouScore = Math.round(Math.min(100, ouScore*volPenalty));
  var ouRuns = ouScore>=90?7:ouScore>=80?6:ouScore>=68?5:ouScore>=54?4:ouScore>=40?3:ouScore>=26?2:ouScore>=15?1:0;

  // ── DIFFERS (best cold digit) ──
  var coldest = overdue.slice().sort(function(a,b){ return b.deficit-a.deficit; })[0];
  var diffScore = 0;
  diffScore += Math.min(40,(10-coldest.pct)*4.5);
  diffScore += Math.min(28,coldest.deficit*0.55);
  if(driftOf(coldest.digit)<-0.5) diffScore += 20;
  if(stable) diffScore += 14;
  diffScore = Math.round(Math.min(100, diffScore));
  var diffRuns = diffScore>=90?7:diffScore>=80?6:diffScore>=68?5:diffScore>=54?4:diffScore>=40?3:diffScore>=26?2:diffScore>=15?1:0;

  // ── MATCHES (best hot digit) ──
  var hottest = p1000.slice().sort(function(a,b){ return b.pct-a.pct; })[0];
  var matchScore = 0;
  matchScore += Math.min(38,(hottest.pct-10)*5.5);
  if(driftOf(hottest.digit)>0.5) matchScore += 28;
  if(stable) matchScore += 14;
  matchScore += Math.min(20,(hottest.pct-10)*3);
  matchScore = Math.round(Math.min(100, matchScore));
  var matchRuns = matchScore>=90?7:matchScore>=80?6:matchScore>=68?5:matchScore>=54?4:matchScore>=40?3:matchScore>=26?2:matchScore>=15?1:0;

  return {
    rf:   { dir:rfDir,            score:rfScore,    runs:rfRuns,    streak:rfStreak },
    eo:   { dir:eoDir,            score:eoScore,    runs:eoRuns,    streak:eoStrk   },
    ou:   { dir:ouDir,            score:ouScore,    runs:ouRuns,    gap:ouGap1000.toFixed(1) },
    diff: { digit:coldest.digit,  score:diffScore,  runs:diffRuns,  pct:coldest.pct.toFixed(2) },
    mtch: { digit:hottest.digit,  score:matchScore, runs:matchRuns, pct:hottest.pct.toFixed(2) },
    entropy:ent, stable:stable, vol:vol.toFixed(3),
  };
}

function runMeterHTML(runs, score, col) {
  var dots = '';
  for(var ri=1;ri<=7;ri++){
    var active = ri<=runs;
    var bg = active?(ri<=5?col:'#ff6d00'):'rgba(255,255,255,.06)';
    var bc = active?(ri<=5?col:'#ff6d00'):'rgba(255,255,255,.12)';
    var sz = active?'26px':'20px';
    dots += '<div style="width:'+sz+';height:'+sz+';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;background:'+bg+';border:1.5px solid '+bc+';color:'+(active?'white':'rgba(255,255,255,.22)')+';transition:all .3s ease;">'+ri+'</div>';
  }
  var label=runs===0?'WAIT':runs<=2?'WEAK':runs<=4?'MODERATE':runs<=5?'STRONG':runs===6?'VERY STRONG':'MAX POWER 🔥';
  var barCol=score>=80?col:score>=55?'#ff9100':'#445';
  return '<div style="display:flex;align-items:center;gap:4px;margin:6px 0;">'+dots+'</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:9px;font-weight:900;margin-bottom:4px;">'+
    '<span style="color:'+col+';">'+runs+' Run'+(runs!==1?'s':'')+' — '+label+'</span>'+
    '<span style="color:rgba(255,255,255,.35);">Score: '+score+'/100</span></div>'+
    '<div style="height:5px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;">'+
    '<div style="height:100%;width:'+score+'%;background:'+barCol+';border-radius:3px;transition:width .5s ease;"></div></div>';
}

//  RISE / FALL
function renderRF() {
  var prices = fullHistory.map(function(t){ return t.price; });
  var consDir = consecDir(), streak = curStreak();
  var rises50 = fullHistory.slice(-50).filter(function(t){ return t.diff>=0; }).length;
  var curP    = prices[prices.length-1] || 0;
  var vol     = stdDev(fullHistory.slice(-100).map(function(t){ return t.diff; }));
  var volLevel= vol>0.5?'HIGH':vol>0.2?'MEDIUM':'LOW';
  var volPct  = vol>0.5?80:vol>0.2?50:25;

  // ── VFPI alignment ──
  var bias = getIndicatorBias();
  var biasBoostRise = bias === 'bull' ? 1 : bias === 'bear' ? -1 : 0;

  if(activeRoom===0||activeRoom===3){
    var rCnt = consDir.rise, fCnt = consDir.fall;
    // Require indicator alignment for signal upgrade
    var riseReady = rCnt >= 3 && biasBoostRise >= 0;  // VFPI must not be bearish
    var fallReady = fCnt >= 3 && biasBoostRise <= 0;  // VFPI must not be bullish
    var hasSig    = riseReady || fallReady;
    var sigType   = riseReady ? 'RISE' : fallReady ? 'FALL' : null;

    var rBorder = riseReady ? '#00c853' : (rCnt > 0 ? '#ff9100' : 'var(--border)');
    var fBorder = fallReady ? '#ff5252' : (fCnt > 0 ? '#ff9100' : 'var(--border)');
    var rBg     = riseReady ? 'rgba(0,200,83,.07)' : 'var(--panel)';
    var fBg     = fallReady ? 'rgba(255,82,82,.07)' : 'var(--panel)';

    // ── Candle dots — filled green/red/grey based on OHLC direction ──
    var riseDots = '';
    for(var ri=0;ri<3;ri++){
      var filled = ri < rCnt;
      riseDots += '<div style="flex:1;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;background:' + (filled?'#00c853':'rgba(0,200,83,.1)') + ';border:1.5px solid ' + (filled?'#00c853':'rgba(0,200,83,.25)') + ';color:' + (filled?'white':'#00c853') + ';transition:all .3s ease;">' + (filled?'▲':'○') + '</div>';
    }
    var fallDots = '';
    for(var fi=0;fi<3;fi++){
      var filled2 = fi < fCnt;
      fallDots += '<div style="flex:1;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;background:' + (filled2?'#ff5252':'rgba(255,82,82,.1)') + ';border:1.5px solid ' + (filled2?'#ff5252':'rgba(255,82,82,.25)') + ';color:' + (filled2?'white':'#ff5252') + ';transition:all .3s ease;">' + (filled2?'▼':'○') + '</div>';
    }

    // VFPI bias badge
    var biasBadge = bias === 'bull'
      ? '<span style="font-size:8px;font-weight:900;background:rgba(0,200,83,.15);color:#00c853;padding:2px 7px;border-radius:8px;margin-left:6px;">VFPI ▲ BULL</span>'
      : bias === 'bear'
      ? '<span style="font-size:8px;font-weight:900;background:rgba(255,82,82,.15);color:#ff5252;padding:2px 7px;border-radius:8px;margin-left:6px;">VFPI ▼ BEAR</span>'
      : '<span style="font-size:8px;font-weight:900;background:rgba(255,145,0,.12);color:#ff9100;padding:2px 7px;border-radius:8px;margin-left:6px;">VFPI — WAIT</span>';

    var riseSignalBox = riseReady
      ? '<div style="margin-top:8px;background:rgba(0,200,83,.12);border:1.5px solid #00c853;border-radius:10px;padding:10px 12px;">' +
        '<div style="font-size:11px;font-weight:900;color:#00c853;margin-bottom:3px;">✅ ENTER RISE NOW</div>' +
        '<div style="font-size:10px;color:var(--muted);font-weight:700;">' + rCnt + ' rising candles confirmed. Next candle opens — enter <strong>RISE</strong>.</div>' +
        '</div>'
      : '<div style="margin-top:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;">' +
        '<div style="font-size:10px;color:var(--muted);font-weight:700;">⏳ Need ' + (3-rCnt) + ' more rising candle' + ((3-rCnt)===1?'':'s') + ' + VFPI confirm</div>' +
        '</div>';

    var fallSignalBox = fallReady
      ? '<div style="margin-top:8px;background:rgba(255,82,82,.09);border:1.5px solid #ff5252;border-radius:10px;padding:10px 12px;">' +
        '<div style="font-size:11px;font-weight:900;color:#ff5252;margin-bottom:3px;">✅ ENTER FALL NOW</div>' +
        '<div style="font-size:10px;color:var(--muted);font-weight:700;">' + fCnt + ' falling candles confirmed. Next candle opens — enter <strong>FALL</strong>.</div>' +
        '</div>'
      : '<div style="margin-top:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;">' +
        '<div style="font-size:10px;color:var(--muted);font-weight:700;">⏳ Need ' + (3-fCnt) + ' more falling candle' + ((3-fCnt)===1?'':'s') + ' + VFPI confirm</div>' +
        '</div>';

    var html =
      '<div style="border:2px solid ' + rBorder + ';border-radius:14px;padding:12px;margin-bottom:10px;background:' + rBg + ';transition:all .4s ease;">' +
        '<div style="display:flex;align-items:center;margin-bottom:8px;">' +
          '<span style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#00c853;">📈 RISE GROUP</span>' +
          biasBadge +
        '</div>' +
        '<div style="display:flex;gap:5px;margin-bottom:6px;">' + riseDots + '</div>' +
        '<div style="font-size:9px;color:var(--muted);font-weight:700;">' + rCnt + '/3 rising candles (this ' + (granularity>=60?Math.round(granularity/60)+'min':'1min') + ' chart)</div>' +
        riseSignalBox +
      '</div>' +
      '<div style="border:2px solid ' + fBorder + ';border-radius:14px;padding:12px;margin-bottom:10px;background:' + fBg + ';transition:all .4s ease;">' +
        '<div style="display:flex;align-items:center;margin-bottom:8px;">' +
          '<span style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#ff5252;">📉 FALL GROUP</span>' +
        '</div>' +
        '<div style="display:flex;gap:5px;margin-bottom:6px;">' + fallDots + '</div>' +
        '<div style="font-size:9px;color:var(--muted);font-weight:700;">' + fCnt + '/3 falling candles (this ' + (granularity>=60?Math.round(granularity/60)+'min':'1min') + ' chart)</div>' +
        fallSignalBox +
      '</div>';

    // ── PRO RUN METER ──
    var ps = proSignal();
    if(ps) {
      var meterCol = ps.rf.dir==='RISE'?'#00c853':'#ff5252';
      html += '<div style="background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;margin-top:4px;">' +
        '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.5);margin-bottom:8px;">RUN METER — ' + ps.rf.dir + '</div>' +
        runMeterHTML(ps.rf.runs, ps.rf.score, meterCol) + '</div>';
    }

    if(hasSig && sigType) beepSignal(sigType);

    // ── Signal glow: apply CSS pulse animation when high-probability (≥85 score) ──
    var rfDisp = document.getElementById('rf-candle-display');
    if(rfDisp) {
      rfDisp.innerHTML = html;
      // Remove stale glow classes before applying new state
      rfDisp.classList.remove('signal-hot-up','signal-hot-dn');
      if(ps && ps.rf && ps.rf.score >= 85){
        rfDisp.classList.add(ps.rf.dir === 'RISE' ? 'signal-hot-up' : 'signal-hot-dn');
      }
    }
    var rfEnt  = document.getElementById('rf-entry-box');
    if(rfEnt) rfEnt.innerHTML = '';
    var rfPs   = document.getElementById('rf-pstrip');
    if(rfPs) rfPs.innerHTML = pstripHTML();
    var rfDu   = document.getElementById('rf-dualbar');
    if(rfDu) rfDu.innerHTML = dualB(rises50/50*100);
  }

  if(activeRoom===1){
    document.getElementById('rf-trend-bar').innerHTML=\`
      \${dualB(rises50/50*100)}
      <div style="text-align:center;font-size:10px;font-weight:700;margin-top:4px;color:\${rises50>27?'var(--green)':rises50<23?'var(--red)':'var(--orange)'}">
        \${rises50>27?'Buyers are in control 🟢':rises50<23?'Sellers are in control 🔴':'Balanced — no clear side ⚖️'}
      </div>\`;

    const vc=volLevel==='HIGH'?'var(--red)':volLevel==='MEDIUM'?'var(--orange)':'var(--green)';
    document.getElementById('rf-vol-meter').innerHTML=\`
      <div class="meter-wrap"><div class="meter-needle" style="left:\${volPct}%;background:\${vc}"></div></div>
      <div class="blr"><span>Calm</span><span>Medium</span><span>Jumpy</span></div>\`;
    document.getElementById('rf-vol-label').innerHTML=\`<span style="color:\${vc}">\${volLevel}</span> — \${volLevel==='LOW'?'Good for entry':volLevel==='MEDIUM'?'Trade carefully':'Reduce risk size'}\`;

    const strCol=streak.len>=5?'var(--red)':streak.len>=3?'var(--orange)':'var(--green)';
    const revProb=Math.min(95,30+streak.len*12);
    document.getElementById('rf-streak').innerHTML=\`
      <div style="display:flex;align-items:center;gap:10px">
        <div style="background:var(--card);border:2px solid \${strCol};border-radius:10px;padding:7px 12px;text-align:center;flex-shrink:0">
          <div style="font-size:1.6rem;font-weight:900;color:\${strCol};line-height:1">\${streak.len}</div>
          <div style="font-size:7px;font-weight:900;color:var(--muted)">\${streak.type} streak</div>
        </div>
        <div style="flex:1">
          <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">Reversal chance</div>
          \${sbar(revProb,strCol)}
          <div style="font-size:9px;font-weight:700;margin-top:3px;color:\${strCol}">\${streak.len>=5?'⚠ Streak very long — reversal likely':streak.len>=3?'⚠ Be cautious':'✅ Safe to follow'}</div>
        </div>
      </div>\`;

    const sr=()=>{const w=fullHistory.slice(-50).map(t=>t.price);return{s:Math.min(...w),r:Math.max(...w)};};
    const {s,r}=sr();
    const mid=(s+r)/2;
    const pos=(curP-s)/(r-s)*100;
    document.getElementById('rf-zones').innerHTML=\`
      <div class="bwrap" style="height:10px;position:relative">
        <div class="bfill" style="width:100%;background:linear-gradient(to right,var(--green),var(--orange),var(--red))"></div>
        <div style="position:absolute;top:-3px;left:\${pos.toFixed(0)}%;width:3px;height:16px;background:var(--text);border-radius:2px;transform:translateX(-50%)"></div>
      </div>
      <div class="blr"><span>Floor \${s.toFixed(pipSize)}</span><span>Mid \${mid.toFixed(pipSize)}</span><span>Ceiling \${r.toFixed(pipSize)}</span></div>
      <div style="font-size:9px;font-weight:700;margin-top:3px;color:var(--muted)">Price at \${pos.toFixed(0)}% of range — \${pos>65?'Near ceiling (FALL zone)':pos<35?'Near floor (RISE zone)':'Middle (wait for direction)'}</div>\`;

    document.getElementById('rf-worm').innerHTML=wormHTML(30);
  }

}

let lastSignalPlay='';
function beepSignal(sig){if(sig!==lastSignalPlay){lastSignalPlay=sig;beep(sig==='RISE'?660:440,0.3,'sine');}}

function renderRFStats(){
  if(fullHistory.length < 5) return;
  var prices  = fullHistory.map(function(t){ return t.price; });
  var curP    = prices[prices.length-1] || 0;
  var rsi14   = rsi(prices, 14);
  var ema20v  = ema(prices, 20);

  // Spread
  var diffs      = fullHistory.slice(-20).map(function(t){ return t.diff; });
  var spreadVal  = stdDev(diffs);
  var spreadPct  = Math.min(spreadVal / 0.8 * 100, 100);
  var spreadEl   = document.getElementById('rf-spread');
  if(spreadEl) spreadEl.innerHTML =
    sbar(spreadPct,'var(--accent)','Price spread level') +
    \`<div style="font-size:9px;font-weight:700;margin-top:4px;color:var(--muted)">\${spreadPct>60?'Prices are very spread out — high volatility':spreadPct>35?'Moderate spread — normal market':'Prices are tight — calm market'}</div>\`;

  // Momentum
  var last10  = fullHistory.slice(-10).map(function(t){ return t.diff; });
  var posDir  = last10.filter(function(d){ return d>0; }).length;
  var momPct  = posDir / 10 * 100;
  var momEl   = document.getElementById('rf-momentum');
  if(momEl) momEl.innerHTML =
    dualB(momPct) +
    \`<div style="font-size:9px;font-weight:700;margin-top:3px;color:var(--muted)">\${posDir}/10 recent ticks went UP — momentum is \${posDir>=7?'UPWARD 📈':posDir<=3?'DOWNWARD 📉':'MIXED'}</div>\`;

  // Pattern win rate
  var wins=0, tot=0;
  for(var i=3; i<fullHistory.length-1; i++){
    var pat=[fullHistory[i-3],fullHistory[i-2],fullHistory[i-1],fullHistory[i]];
    var allR=pat.slice(0,3).every(function(t){ return t.diff>=0; });
    var allF=pat.slice(0,3).every(function(t){ return t.diff<0; });
    if(allR){ tot++; if(pat[3].diff>=0) wins++; }
    if(allF){ tot++; if(pat[3].diff<0)  wins++; }
  }
  var wr = tot>0 ? (wins/tot*100) : 55;
  var wrEl = document.getElementById('rf-winrate');
  if(wrEl) wrEl.innerHTML =
    sbar(wr,'var(--green)','3-candle pattern win rate') +
    \`<div style="font-size:9px;color:var(--muted);margin-top:3px">Out of \${tot} patterns found: \${wins} worked ✅ | Target: 60–70% win rate</div>\`;

  // RSI
  var rsiEl = document.getElementById('rf-rsi');
  if(rsiEl){
    if(rsi14!=null){
      var rsiColor=rsi14>70?'var(--red)':rsi14<30?'var(--green)':'var(--accent)';
      rsiEl.innerHTML=\`<div style="text-align:center;font-size:1.8rem;font-weight:900;color:\${rsiColor}">\${rsi14.toFixed(0)}/100</div>\`
        + sbar(rsi14,rsiColor)
        + \`<div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:3px">\${rsi14>70?'Overbought — price may drop soon':rsi14<30?'Oversold — price may rise soon':'Neutral — balanced'}</div>\`;
    } else {
      rsiEl.innerHTML='<div style="color:var(--muted);font-size:10px">Need more ticks for RSI...</div>';
    }
  }

  // EMA + current price
  var emaEl = document.getElementById('rf-ema20');
  if(emaEl) emaEl.textContent = ema20v ? ema20v.toFixed(pipSize) : '—';
  var priceEl = document.getElementById('rf-price-now');
  if(priceEl){
    priceEl.textContent = curP.toFixed(pipSize);
    priceEl.style.color = (ema20v && curP>ema20v) ? 'var(--green)' : 'var(--red)';
  }
}

//  OVER / UNDER
function setDir(dir){
  activeDir=dir;
  document.getElementById('dir-over').className='dirtbtn'+(dir==='over'?' sel-over':'');
  document.getElementById('dir-under').className='dirtbtn'+(dir==='under'?' sel-under':'');
  renderOU();
}

function initOUGrid(){
  const g=document.getElementById('ou-barrier-grid'); g.innerHTML='';
  for(let i=0;i<=9;i++){
    const btn=document.createElement('div');
    btn.className='dsel-btn'+(i===activeBarrier?' selected':'');
    btn.innerHTML=\`<span class="dbn">\${i}</span><span class="dbp">--%</span>\`;
    btn.onclick=()=>{activeBarrier=i;initOUGrid();renderOU();};
    g.appendChild(btn);
  }
}

function renderOU(){
  if(!fullHistory.length) return;
  const p1000=dPcts(1000), p50=dPcts(50);
  const cur=fullHistory[fullHistory.length-1]?.digit??0;

  // Update barrier grid percentages
  const btns=document.querySelectorAll('#ou-barrier-grid .dsel-btn');
  btns.forEach((b,i)=>{
    b.className='dsel-btn'+(i===activeBarrier?' selected':'');
    b.querySelector('.dbp').textContent=p1000[i].pct.toFixed(1)+'%';
  });

  if(activeRoom===0){
    // ── LIVE PRICE UPDATE ──
    const ouLP=document.getElementById('ou-live-price');
    const ouLD=document.getElementById('ou-live-digit');
    const ouLV=document.getElementById('ou-live-verdict');
    const ouLW=document.getElementById('ou-live-worm');
    const ouLast=fullHistory[fullHistory.length-1];
    if(ouLP&&ouLast){
      ouLP.textContent=ouLast.price.toFixed(pipSize);
      ouLP.style.color=ouLast.diff>=0?'var(--green)':'var(--red)';
    }
    if(ouLD&&ouLast){
      const isOver=activeBarrier!==null?(ouLast.digit>activeBarrier):null;
      ouLD.textContent=ouLast.digit;
      ouLD.style.borderColor=isOver===null?'var(--accent)':isOver?'var(--green)':'var(--red)';
      ouLD.style.color=isOver===null?'var(--accent)':isOver?'var(--green)':'var(--red)';
      ouLD.style.background=isOver===null?'transparent':isOver?'rgba(0,200,83,.12)':'rgba(244,67,54,.12)';
      ouLD.style.transform='scale(1.2)';
      setTimeout(function(){if(ouLD)ouLD.style.transform='scale(1)';},150);
    }
    if(ouLV&&ouLast){
      if(activeBarrier!==null){
        const isOverV=ouLast.digit>activeBarrier;
        ouLV.innerHTML='<span style="color:'+(isOverV?'var(--green)':'var(--red)')+';display:block;font-size:13px;">'+(isOverV?'\u25b2 OVER':'\u25bc UNDER')+'</span><span style="font-size:9px;color:var(--muted)"> barrier '+activeBarrier+'</span>';
      } else { ouLV.textContent='Pick barrier'; }
    }
    if(ouLW) ouLW.innerHTML=wormDigitHTML(20);
    // Animated digit bars
    const dbarWrap=document.getElementById('ou-dbar-wrap');
    if(!dbarWrap.children.length){
      dbarWrap.innerHTML=Array.from({length:10},(_,i)=>\`
        <div class="dbar-col">
          <div class="dbar-fill" id="ou-dfill-\${i}" style="height:3px;background:var(--accent)"></div>
          <div class="dbar-lbl">\${i}</div>
          <div class="dbar-pct" id="ou-dpct-\${i}">--%</div>
        </div>\`).join('');
    }
    p1000.forEach(s=>{
      const fill=document.getElementById(\`ou-dfill-\${s.digit}\`);
      const pctEl=document.getElementById(\`ou-dpct-\${s.digit}\`);
      if(fill){fill.style.height=\`\${Math.max(3,s.pct/15*70)}px\`;fill.style.background=s.digit===activeBarrier?'var(--orange)':barColor(s.pct);}
      if(pctEl)pctEl.textContent=s.pct.toFixed(1)+'%';
    });

    // Digit grid heatmap
    document.getElementById('ou-dgrid').innerHTML=p1000.map(s=>{
      const dr=driftOf(s.digit);
      const arrow=dr>0.5?'▲':dr<-0.5?'▼':'–';
      const isBarrier=s.digit===activeBarrier;
      return \`<div class="dcell" style="background:\${isBarrier?'var(--orange)':heatColor(s.pct)};\${isBarrier?'border:2px solid white':''}" title="Digit \${s.digit}">
        <span class="dn">\${s.digit}</span>
        <span class="dp">\${s.pct.toFixed(1)}%</span>
        <span class="da" style="color:\${dr>0?'#00ffaa':dr<0?'#ff8080':'#ffffff99'}">\${arrow}</span>
      </div>\`;
    }).join('');

    // Entry signal
    const barrierPct=p1000[activeBarrier].pct;
    const cursorOnBarrier=cur===activeBarrier;
    const isStable=Math.abs(driftOf(activeBarrier))<0.5;
    const belowWeak=activeDir==='over'?Array.from({length:activeBarrier+1},(_,i)=>i).every(i=>p1000[i].pct<=9):false;
    const aboveWeak=activeDir==='under'?Array.from({length:9-activeBarrier},(_,i)=>activeBarrier+i).every(i=>p1000[i]?.pct<10):false;
    const canEnter=(cursorOnBarrier&&isStable&&(activeDir==='over'?belowWeak:aboveWeak));

    let sigHTML='';
    // ── OVER GROUP ──
    const overDigits=[activeBarrier+1,activeBarrier+2,activeBarrier+3,activeBarrier+4,activeBarrier+5].filter(d=>d<=9);
    const underDigits=[0,1,2,3,4,5,6,7,8,9].slice(0,activeBarrier+1);
    const overPct=overDigits.reduce((a,d)=>a+p1000[d].pct,0);
    const underPct=underDigits.reduce((a,d)=>a+p1000[d].pct,0);
    const overStrong=overPct>underPct&&overDigits.every(d=>p1000[d].pct>0);
    const underStrong=underPct>overPct;
    sigHTML=\`
      <div style="border:2px solid \${activeDir==='over'?(overStrong?'var(--green)':'var(--orange)'):'var(--border)'};border-radius:10px;padding:9px 11px;margin-bottom:8px;background:\${activeDir==='over'?'rgba(0,200,83,.05)':'var(--card)'};">
        <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:var(--green);margin-bottom:6px;">🔼 OVER \${activeBarrier} GROUP (digits >\${activeBarrier})</div>
        <div style="display:flex;gap:4px;margin-bottom:5px;">\${overDigits.map(d=>\`<div style="flex:1;background:\${p1000[d].pct>=10?'var(--green)':'var(--border)'};border-radius:4px;text-align:center;padding:4px 2px;"><span style="font-size:10px;font-weight:900;color:white;display:block">\${d}</span><span style="font-size:7px;font-weight:700;color:rgba(255,255,255,.8)">\${p1000[d].pct.toFixed(1)}%</span></div>\`).join('')}</div>
        <div style="font-size:9px;font-weight:700;color:var(--muted)">Over side total: <strong style="color:var(--green)">\${overPct.toFixed(1)}%</strong></div>
        \${activeDir==='over'?(canEnter?'<div class="ebox go" style="margin-top:5px;"><div class="etitle">✅ ENTER OVER '+activeBarrier+'</div><div class="etxt">Cursor landed on Digit '+activeBarrier+' and is stable. Enter OVER '+activeBarrier+' now.</div></div>':'<div class="ebox wait" style="margin-top:5px;"><div class="etitle">⏳ Watching for OVER entry</div><div class="etxt">'+( cursorOnBarrier?'Cursor on '+activeBarrier+' — wait 2–3s for stability before entering OVER.':'Waiting for cursor to land on Digit '+activeBarrier+'.')+'</div></div>'):''}
      </div>
      <div style="border:2px solid \${activeDir==='under'?(underStrong?'var(--accent)':'var(--orange)'):'var(--border)'};border-radius:10px;padding:9px 11px;background:\${activeDir==='under'?'rgba(63,81,181,.05)':'var(--card)'};">
        <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin-bottom:6px;">🔽 UNDER \${activeBarrier} GROUP (digits ≤\${activeBarrier})</div>
        <div style="display:flex;gap:4px;margin-bottom:5px;">\${underDigits.map(d=>\`<div style="flex:1;background:\${p1000[d].pct>=10?'var(--accent)':'var(--border)'};border-radius:4px;text-align:center;padding:4px 2px;"><span style="font-size:10px;font-weight:900;color:white;display:block">\${d}</span><span style="font-size:7px;font-weight:700;color:rgba(255,255,255,.8)">\${p1000[d].pct.toFixed(1)}%</span></div>\`).join('')}</div>
        <div style="font-size:9px;font-weight:700;color:var(--muted)">Under side total: <strong style="color:var(--accent)">\${underPct.toFixed(1)}%</strong></div>
        \${activeDir==='under'?(canEnter?'<div class="ebox go" style="margin-top:5px;"><div class="etitle">✅ ENTER UNDER '+activeBarrier+'</div><div class="etxt">Cursor landed on Digit '+activeBarrier+' and is stable. Enter UNDER '+activeBarrier+' now.</div></div>':'<div class="ebox wait" style="margin-top:5px;"><div class="etitle">⏳ Watching for UNDER entry</div><div class="etxt">'+(cursorOnBarrier?'Cursor on '+activeBarrier+' — wait 2–3s for stability before entering UNDER.':'Waiting for cursor to land on Digit '+activeBarrier+'.')+'</div></div>'):''}
      </div>\`;
    if(canEnter) beepSignal('OU'+activeDir+activeBarrier);
    // ── PRO RUN METER ──
    var psOU = proSignal();
    if(psOU) {
      var mCol = psOU.ou.dir==='OVER'?'#7c4dff':'#00bcd4';
      sigHTML += '<div style="background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;margin-top:8px;">' +
        '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.5);margin-bottom:8px;">RUN METER — ' + psOU.ou.dir + ' ' + activeBarrier + '</div>' +
        runMeterHTML(psOU.ou.runs, psOU.ou.score, mCol) + '</div>';
    }
    document.getElementById('ou-signal-box').innerHTML=sigHTML;
  }

  if(activeRoom===1){
    const oSum=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    const gap=Math.abs(oSum-uSum);
    document.getElementById('ou-split-bar').innerHTML=\`
      \${dualBOU(oSum/(oSum+uSum)*100)}\`;
    document.getElementById('ou-gap-info').innerHTML=\`
      <div class="sr2"><span class="sl">Over side (5–9)</span><span class="sv" style="color:var(--green)">\${oSum.toFixed(1)}%</span></div>
      <div class="sr2"><span class="sl">Under side (0–4)</span><span class="sv" style="color:var(--accent)">\${uSum.toFixed(1)}%</span></div>
      <div class="sr2"><span class="sl">Gap between sides</span><span class="sv">\${gap.toFixed(1)}% \${gap>10?'★ Strong':'— Weak'}</span></div>
      <div class="sr2"><span class="sl">Recommended side</span><span class="sv"><span class="pill \${oSum>uSum?'pg':'pa'}">\${oSum>uSum?'OVER':'UNDER'}</span></span></div>\`;

    document.getElementById('ou-heatmap').innerHTML=p1000.map(s=>{
      const dr=driftOf(s.digit);
      return \`<div class="dcell" style="background:\${heatColor(s.pct)}">
        <span class="dn">\${s.digit}</span><span class="dp">\${s.pct.toFixed(1)}%</span>
        <span class="da" style="color:\${dr>0?'#00ffaa':dr<0?'#ff8080':'#999'}">\${dr>0.5?'▲':dr<-0.5?'▼':'—'}</span>
      </div>\`;
    }).join('');

    const movingDigits=p1000.filter(s=>Math.abs(driftOf(s.digit))>1);
    document.getElementById('ou-safety').innerHTML=movingDigits.length>=2
      ?\`<div class="cr"><div class="cd cd-n">!</div><div><div>⚠ \${movingDigits.length} digits changing fast (\${movingDigits.map(s=>s.digit).join(',')})</div><div class="csub">Do NOT enter when 2+ digits change by 1%+ at the same time</div></div></div>\`
      :\`<div class="cr"><div class="cd cd-y">✓</div><div>Market is stable — safe to look for entry</div></div>\`;

    document.getElementById('ou-drift').innerHTML=p1000.map(s=>{
      const dr=driftOf(s.digit);
      const col=dr>0.5?'var(--green)':dr<-0.5?'var(--red)':'var(--muted)';
      return \`<div class="sr2"><span class="sl">Digit \${s.digit}</span><span class="sv" style="color:\${col}">\${dr>0?'+':''}\${dr.toFixed(1)}% \${dr>1?'▲▲':dr>0.5?'▲':dr<-1?'▼▼':dr<-0.5?'▼':'—'}</span></div>\`;
    }).join('');
  }

  if(activeRoom===2){
    const oSum=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    document.getElementById('ou-stat-side').innerHTML=\`
      \${dualBOU(oSum/(oSum+uSum)*100)}
      \${sbar(oSum/(oSum+uSum)*100,'var(--green)','Over side strength')}
      \${sbar(uSum/(oSum+uSum)*100,'var(--accent)','Under side strength')}
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:4px">Over the last 1000 ticks, the \${oSum>uSum?'OVER side wins more — favour OVER trades':'UNDER side wins more — favour UNDER trades'}</div>\`;

    const n=fullHistory.length;
    const exp=n/10;
    const due=p1000.map(s=>({...s,deficit:Math.round(exp-s.count)})).sort((a,b)=>b.deficit-a.deficit);
    document.getElementById('ou-due').innerHTML=due.slice(0,5).map(d=>\`
      <div class="cr"><div class="cd \${d.deficit>Math.sqrt(n)?'cd-y':d.deficit<-Math.sqrt(n)?'cd-n':'cd-i'}">\${d.digit}</div>
      <div><div>\${d.deficit>Math.sqrt(n)?\`Digit \${d.digit} is OVERDUE — should appear more\`:d.deficit<-Math.sqrt(n)?\`Digit \${d.digit} appeared TOO OFTEN — may cool down\`:\`Digit \${d.digit} is balanced\`}</div>
      <div class="csub">\${d.pct.toFixed(2)}% | diff: \${d.deficit>0?'+':''}\${d.deficit} appearances</div></div></div>\`).join('');

    // Barrier frequency
    let barrierHits=0;
    for(let i=0;i<fullHistory.length;i++) if(fullHistory[i].digit===activeBarrier) barrierHits++;
    const bFreq=barrierHits/fullHistory.length*100;
    document.getElementById('ou-barrier-freq').innerHTML=\`
      \${sbar(bFreq,'var(--orange)',\`Digit \${activeBarrier} frequency\`)}
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:3px">Digit \${activeBarrier} appeared \${barrierHits} times out of \${fullHistory.length} ticks (\${bFreq.toFixed(2)}%)</div>
      <div style="font-size:9px;color:var(--muted);margin-top:2px">\${bFreq<8?'Rare digit — good target for DIFFERS / barriers':bFreq>12?'Common digit — caution':'Normal frequency'}</div>\`;

    const ent=shannonEnt();
    const entColor=ent>0.97?'var(--orange)':ent>0.9?'var(--green)':'var(--green)';
    document.getElementById('ou-entropy').innerHTML=\`
      \${sbar(ent*100,entColor,'randomness level')}
      <div style="font-size:9px;font-weight:700;margin-top:4px;color:\${entColor}">\${ent>0.97?'Very random — hard to predict':ent>0.9?'Slightly patterned — some edge possible':'Clearly patterned — good trading conditions'}</div>\`;
  }
}

//  EVEN / ODD
function renderEO(){
  if(!fullHistory.length) return;
  const p1000=dPcts(1000), p50=dPcts(50);
  const evenD=[0,2,4,6,8], oddD=[1,3,5,7,9];
  const evenPcts=evenD.map(d=>p1000[d]), oddPcts=oddD.map(d=>p1000[d]);
  const evenSum=evenD.reduce((a,d)=>a+p1000[d].pct,0);
  const oddSum=oddD.reduce((a,d)=>a+p1000[d].pct,0);
  const evenAbove10=evenD.filter(d=>p1000[d].pct>=10).length;
  const oddAbove10=oddD.filter(d=>p1000[d].pct>=10).length;
  const noOddHigh=!oddD.some(d=>p1000[d].pct>=9.7);
  const noEvenHigh=!evenD.some(d=>p1000[d].pct>=9.7);
  const eoStreak=consecEO();

  if(activeRoom===0){
    // ── LIVE PRICE UPDATE ──
    const eoLP=document.getElementById('eo-live-price');
    const eoLD=document.getElementById('eo-live-digit');
    const eoLV=document.getElementById('eo-live-verdict');
    const eoLW=document.getElementById('eo-live-worm');
    const eoLast=fullHistory[fullHistory.length-1];
    if(eoLP&&eoLast){
      eoLP.textContent=eoLast.price.toFixed(pipSize);
      eoLP.style.color=eoLast.diff>=0?'var(--green)':'var(--red)';
    }
    if(eoLD&&eoLast){
      const isEven=eoLast.digit%2===0;
      eoLD.textContent=eoLast.digit;
      eoLD.style.borderColor=isEven?'var(--green)':'var(--orange)';
      eoLD.style.color=isEven?'var(--green)':'var(--orange)';
      eoLD.style.background=isEven?'rgba(0,200,83,.12)':'rgba(255,145,0,.12)';
      eoLD.style.transform='scale(1.2)';
      setTimeout(function(){if(eoLD)eoLD.style.transform='scale(1)';},150);
    }
    if(eoLV&&eoLast){
      const isEvenV=eoLast.digit%2===0;
      eoLV.innerHTML='<span style="color:'+(isEvenV?'var(--green)':'var(--orange)')+';display:block;font-size:13px;">'+(isEvenV?'\U0001f7e2 EVEN':'\U0001f7e0 ODD')+'</span><span style="font-size:9px;color:var(--muted)"> digit '+eoLast.digit+'</span>';
    }
    if(eoLW) eoLW.innerHTML=wormParityHTML(20);
    const evenReady=evenAbove10>=3&&noOddHigh;
    const oddReady=oddAbove10>=3&&noEvenHigh;
    const sig=evenReady&&eoStreak.even>=3?'EVEN':oddReady&&eoStreak.odd>=3?'ODD':evenSum>oddSum?'EVEN':'ODD';
    const conf=((sig==='EVEN'&&evenReady&&eoStreak.even>=3)||(sig==='ODD'&&oddReady&&eoStreak.odd>=3))?'STRONG':(evenAbove10>=2||oddAbove10>=2)?'MODERATE':'WEAK';

    // ── EVEN GROUP ──
    const evenConsec = eoStreak.even;
    document.getElementById('eo-signal').innerHTML=\`
      <div style="font-size:9px;font-weight:900;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;">
        Best signal: <span style="color:\${sig==='EVEN'?'var(--green)':'var(--orange)'};font-size:11px;font-weight:900;">\${sig}</span>
        <span class="sigbadge \${conf==='STRONG'?'sb-s':conf==='MODERATE'?'sb-m':'sb-w'}" style="margin-left:6px">\${conf}</span>
      </div>\`;

    // ── EVEN GROUP ──
    document.getElementById('eo-even-cells').innerHTML=evenD.map(d=>{
      const p=p1000[d].pct, dr=driftOf(d);
      const strong=p>=11, warm=p>=9&&p<11;
      return \`<div class="eo-cell \${strong?'active':warm?'strong':''}">
        <span class="ecn">\${d}</span>
        <span class="ecp">\${p.toFixed(1)}%</span>
        <div class="ecb" style="width:\${Math.min(100,p/15*100)}%;background:\${strong?'var(--green)':warm?'var(--orange)':'var(--border)'}"></div>
      </div>\`;
    }).join('');
    document.getElementById('eo-even-status').innerHTML=\`
      <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:5px;">
        <span style="color:var(--green)">\${evenAbove10}/5 digits ≥ 10%</span>
        <span style="color:\${evenReady?'var(--green)':'var(--muted)'}">\${evenReady?'✅ STRONG':'Needs 3+ at 10%'}</span>
      </div>
      <div class="ebox \${evenReady&&evenConsec>=3?'go':'wait'}" style="margin-top:6px">
        <div class="etitle" style="color:\${evenReady&&evenConsec>=3?'var(--green)':'var(--orange)'}">📈 EVEN ENTRY: \${evenConsec}/3 in a row</div>
        <div class="etxt">\${evenReady&&evenConsec>=3?'✅ Enter EVEN now — 3+ even digits hit AND percentages are strong.':evenReady?'Wait for '+evenConsec+'/3 even digits in a row, then enter.':'Percentages not strong enough for EVEN yet.'}</div>
      </div>\`;

    // ── ODD GROUP ──
    document.getElementById('eo-odd-cells').innerHTML=oddD.map(d=>{
      const p=p1000[d].pct, dr=driftOf(d);
      const strong=p>=11, warm=p>=9&&p<11;
      return \`<div class="eo-cell \${strong?'active':warm?'strong':''}">
        <span class="ecn">\${d}</span>
        <span class="ecp">\${p.toFixed(1)}%</span>
        <div class="ecb" style="width:\${Math.min(100,p/15*100)}%;background:\${strong?'var(--orange)':warm?'var(--orange)':'var(--border)'}"></div>
      </div>\`;
    }).join('');
    const oddConsec = eoStreak.odd;
    document.getElementById('eo-odd-status').innerHTML=\`
      <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:5px;">
        <span style="color:var(--orange)">\${oddAbove10}/5 digits ≥ 10%</span>
        <span style="color:\${oddReady?'var(--orange)':'var(--muted)'}">\${oddReady?'✅ STRONG':'Needs 3+ at 10%'}</span>
      </div>
      <div class="ebox \${oddReady&&oddConsec>=3?'go':'wait'}" style="margin-top:6px">
        <div class="etitle" style="color:\${oddReady&&oddConsec>=3?'var(--green)':'var(--orange)'}">🟠 ODD ENTRY: \${oddConsec}/3 in a row</div>
        <div class="etxt">\${oddReady&&oddConsec>=3?'✅ Enter ODD now — 3+ odd digits hit AND percentages are strong.':oddReady?'Wait for '+oddConsec+'/3 odd digits in a row, then enter.':'Percentages not strong enough for ODD yet.'}</div>
      </div>\`;

    // Consecutive counter (combined)
    const needSig=sig, needStreak=needSig==='EVEN'?eoStreak.even:eoStreak.odd;
    const dotsHTML=\`<div class="consec-dots">\${[0,1,2].map(i=>\`<div class="consec-dot \${i<needStreak?'hit':''}">\${i<needStreak?(needSig==='EVEN'?'E':'O'):(i+1)}</div>\`).join('')}</div>\`;
    document.getElementById('eo-consec').innerHTML=\`
      <div class="consec">\${dotsHTML}<div class="consec-txt">\${needStreak}/3 \${needSig} in a row — \${needStreak>=3?'ENTER NOW!':needStreak===2?'1 more to go!':'waiting for '+needSig+' digits'}</div></div>\`;
    document.getElementById('eo-entry-box').innerHTML='';

    // ── PRO RUN METER — replace single reusable element, never accumulate ──
    var psEO = proSignal();
    var eoMeterEl = document.getElementById('eo-run-meter-box');
    if(!eoMeterEl){
      eoMeterEl = document.createElement('div');
      eoMeterEl.id = 'eo-run-meter-box';
      eoMeterEl.style.cssText = 'background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;margin-top:8px;';
      var evStat = document.getElementById('eo-even-status');
      if(evStat && evStat.parentNode) evStat.parentNode.appendChild(eoMeterEl);
    }
    if(psEO && eoMeterEl){
      var eoCol = psEO.eo.dir==='EVEN'?'#00bcd4':'#ff9100';
      eoMeterEl.innerHTML='<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.5);margin-bottom:8px;">RUN METER — '+psEO.eo.dir+'</div>'+runMeterHTML(psEO.eo.runs,psEO.eo.score,eoCol);
    }
  }

  if(activeRoom===1){
    document.getElementById('eo-balance').innerHTML=\`
      \${dualBEO(evenSum/(evenSum+oddSum)*100)}
      <div class="sr2"><span class="sl">Even total (0,2,4,6,8)</span><span class="sv" style="color:var(--green)">\${evenSum.toFixed(1)}%</span></div>
      <div class="sr2"><span class="sl">Odd total (1,3,5,7,9)</span><span class="sv" style="color:var(--orange)">\${oddSum.toFixed(1)}%</span></div>
      <div class="sr2"><span class="sl">Gap (need 3%+ for edge)</span><span class="sv">\${Math.abs(evenSum-oddSum).toFixed(1)}% \${Math.abs(evenSum-oddSum)>=3?'✅':'❌'}</span></div>\`;

    const allDigits=[...evenD,...oddD];
    document.getElementById('eo-hotcold').innerHTML=allDigits.sort((a,b)=>p1000[b].pct-p1000[a].pct).map(d=>{
      const p=p1000[d].pct, isE=d%2===0;
      const status=p>=13?'🔥 Very hot':p>=11?'♨️ Hot':p>=9?'Normal':p<7?'❄️ Cold':'Mild';
      const col=p>=11?'var(--red)':p>=9?'var(--orange)':p<7?'var(--accent)':'var(--muted)';
      return \`<div class="sr2"><span class="sl">\${isE?'Even':'Odd'} Digit \${d}</span><span class="sv" style="color:\${col}">\${p.toFixed(1)}% — \${status}</span></div>\`;
    }).join('');

    const spikeDig=p1000.find(s=>s.pct>15);
    document.getElementById('eo-spike').innerHTML=spikeDig
      ?\`<div class="cr"><div class="cd cd-n">!</div><div><div>⚠ Digit \${spikeDig.digit} is at \${spikeDig.pct.toFixed(1)}% — above 15%! DO NOT trade \${spikeDig.digit%2===0?'EVEN':'ODD'}</div></div></div>\`
      :\`<div class="cr"><div class="cd cd-y">✓</div><div>No digit above 15% — safe to look for entry</div></div>\`;

    // Parity animated bars
    const parWrap=document.getElementById('eo-parity-bars');
    if(!parWrap.children.length){
      parWrap.innerHTML=[...evenD,...oddD].sort((a,b)=>a-b).map(d=>\`
        <div class="dbar-col">
          <div class="dbar-fill" id="eo-dfill-\${d}" style="height:3px;background:\${d%2===0?'var(--green)':'var(--orange)'}"></div>
          <div class="dbar-lbl">\${d}</div>
          <div class="dbar-pct" id="eo-dpct-\${d}">--%</div>
        </div>\`).join('');
    }
    p1000.forEach(s=>{
      const fill=document.getElementById(\`eo-dfill-\${s.digit}\`);
      const pctEl=document.getElementById(\`eo-dpct-\${s.digit}\`);
      if(fill){fill.style.height=\`\${Math.max(3,s.pct/15*70)}px\`;}
      if(pctEl)pctEl.textContent=s.pct.toFixed(1)+'%';
    });
  }

  if(activeRoom===2){
    // History bar
    const p100=dPcts(100);
    const eH=[0,2,4,6,8].reduce((a,d)=>a+p100[d].pct,0);
    const oH=[1,3,5,7,9].reduce((a,d)=>a+p100[d].pct,0);
    document.getElementById('eo-history-bar').innerHTML=\`
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:3px">Last 100 ticks:</div>
      \${dualBEO(eH/(eH+oH)*100)}
      \${sbar(eH/(eH+oH)*100,'var(--green)','Even rate (100tk)')}
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:6px;margin-bottom:3px">Last 1000 ticks:</div>
      \${dualBEO(evenSum/(evenSum+oddSum)*100)}
      \${sbar(evenSum/(evenSum+oddSum)*100,'var(--green)','Even rate (1000tk)')}\`;

    // Correlation: which digits from same parity move together
    const eCorr=evenD.map(d=>({d,pct:p1000[d].pct})).sort((a,b)=>b.pct-a.pct);
    document.getElementById('eo-correlation').innerHTML=\`
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:4px">Even digits ranked by strength:</div>
      \${eCorr.map((e,i)=>\`<div class="sr2"><span class="sl">#\${i+1} Digit \${e.d}</span><span class="sv">\${e.pct.toFixed(2)}%</span></div>\`).join('')}
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-top:6px;margin-bottom:4px">Odd digits ranked by strength:</div>
      \${oddD.map(d=>({d,pct:p1000[d].pct})).sort((a,b)=>b.pct-a.pct).map((e,i)=>\`<div class="sr2"><span class="sl">#\${i+1} Digit \${e.d}</span><span class="sv">\${e.pct.toFixed(2)}%</span></div>\`).join('')}\`;

    // Convergence
    const idealEven=50,actualEven=evenSum;
    const diff=actualEven-idealEven;
    document.getElementById('eo-convergence').innerHTML=\`
      \${sbar(actualEven,'var(--green)','Current even share')}
      <div style="font-size:9px;font-weight:700;margin-top:4px;color:var(--muted)">\${Math.abs(diff)<1?'✅ Very balanced — near 50/50':diff>3?\`Even side is \${diff.toFixed(1)}% above centre — may pull back toward balance\`:diff<-3?\`Odd side is \${(-diff).toFixed(1)}% above centre — may rebalance\`:'Slight imbalance — within normal range'}</div>\`;

    document.getElementById('eo-distribution').innerHTML=\`<div class="dgrid">\${p1000.map(s=>\`
      <div class="dcell" style="background:\${s.digit%2===0?heatColor(s.pct):'#455a64'}">
        <span class="dn">\${s.digit}</span><span class="dp">\${s.pct.toFixed(1)}%</span>
      </div>\`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:4px;font-size:7px;font-weight:700">
        <span style="color:var(--green)">■ Even (hot-cold)</span><span style="color:#455a64">■ Odd</span>
      </div>\`;
  }
}

//  UNIFIED PATTERNS — both RF & EO in one scroll
var _upParityBuilt = false;
function renderUnifiedPatterns() {
  if(!fullHistory.length) return;
  var curP  = fullHistory[fullHistory.length-1].price;
  var last  = fullHistory[fullHistory.length-1];
  var pips  = pipSize;

  // LIVE TICK
  var priceEl = document.getElementById('up-tick-price');
  var digitEl = document.getElementById('up-tick-digit');
  var wEl0    = document.getElementById('up-tick-worm');
  if(priceEl){ priceEl.textContent=curP.toFixed(pips); priceEl.style.color=last.diff>=0?'var(--green)':'var(--red)'; }
  if(digitEl){
    var isEvenD=last.digit%2===0;
    digitEl.textContent=last.digit;
    digitEl.style.borderColor=isEvenD?'var(--green)':'var(--orange)';
    digitEl.style.color=isEvenD?'var(--green)':'var(--orange)';
    digitEl.style.background=isEvenD?'rgba(0,200,83,.12)':'rgba(255,145,0,.12)';
    digitEl.style.transform='scale(1.2)';
    setTimeout(function(){if(digitEl)digitEl.style.transform='scale(1)';},150);
  }
  if(wEl0) wEl0.innerHTML=wormHTML(30);

  // RF PATTERNS
  var vol=stdDev(fullHistory.slice(-100).map(function(t){return t.diff;}));
  var volLevel=vol>0.5?'HIGH':vol>0.2?'MEDIUM':'LOW';
  var volPct=vol>0.5?80:vol>0.2?50:25;
  var streak=curStreak();
  var rises50=fullHistory.slice(-50).filter(function(t){return t.diff>=0;}).length;
  var vc=volLevel==='HIGH'?'var(--red)':volLevel==='MEDIUM'?'var(--orange)':'var(--green)';
  var strCol=streak.len>=5?'var(--red)':streak.len>=3?'var(--orange)':'var(--green)';

  var tEl=document.getElementById('up-trend-bar');
  if(tEl) tEl.innerHTML=dualB(rises50/50*100)+'<div style="text-align:center;font-size:10px;font-weight:700;margin-top:4px;color:'+(rises50>27?'var(--green)':rises50<23?'var(--red)':'var(--orange)')+'">'+( rises50>27?'Buyers in control \uD83D\uDFE2':rises50<23?'Sellers in control \uD83D\uDD34':'Balanced \u2014 no clear side \u2696\uFE0F')+'</div>';

  var vmEl=document.getElementById('up-vol-meter');
  if(vmEl) vmEl.innerHTML='<div class="meter-wrap"><div class="meter-needle" style="left:'+volPct+'%;background:'+vc+'"></div></div><div class="blr"><span>Calm</span><span>Medium</span><span>Jumpy</span></div>';
  var vlEl=document.getElementById('up-vol-label');
  if(vlEl) vlEl.innerHTML='<span style="color:'+vc+'">'+volLevel+'</span> \u2014 '+(volLevel==='LOW'?'Good for entry':volLevel==='MEDIUM'?'Trade carefully':'Reduce risk size');

  var stEl=document.getElementById('up-streak');
  if(stEl) stEl.innerHTML='<div style="display:flex;align-items:center;gap:10px"><div style="background:var(--card);border:2px solid '+strCol+';border-radius:10px;padding:7px 12px;text-align:center;flex-shrink:0"><div style="font-size:1.6rem;font-weight:900;color:'+strCol+';line-height:1">'+streak.len+'</div><div style="font-size:7px;font-weight:900;color:var(--muted)">'+streak.type+' streak</div></div><div style="flex:1">'+sbar(Math.min(95,30+streak.len*12),strCol)+'<div style="font-size:9px;font-weight:700;margin-top:3px;color:'+strCol+'">'+(streak.len>=5?'\u26a0 Reversal likely':streak.len>=3?'\u26a0 Be cautious':'\u2705 Safe to follow')+'</div></div></div>';

  var w50=fullHistory.slice(-50).map(function(t){return t.price;});
  var s50=Math.min.apply(null,w50),r50=Math.max.apply(null,w50),mid=(s50+r50)/2;
  var pos=((curP-s50)/(r50-s50)*100)||0;
  var znEl=document.getElementById('up-zones');
  if(znEl) znEl.innerHTML='<div class="bwrap" style="height:10px;position:relative"><div class="bfill" style="width:100%;background:linear-gradient(to right,var(--green),var(--orange),var(--red))"></div><div style="position:absolute;top:-3px;left:'+pos.toFixed(0)+'%;width:3px;height:16px;background:var(--text);border-radius:2px;transform:translateX(-50%)"></div></div><div class="blr"><span>Floor '+s50.toFixed(pips)+'</span><span>Mid '+mid.toFixed(pips)+'</span><span>Ceiling '+r50.toFixed(pips)+'</span></div><div style="font-size:9px;font-weight:700;margin-top:3px;color:var(--muted)">Price at '+pos.toFixed(0)+'% \u2014 '+(pos>65?'Near ceiling (FALL zone)':pos<35?'Near floor (RISE zone)':'Middle (wait)')+'</div>';

  var wEl=document.getElementById('up-worm');
  if(wEl) wEl.innerHTML=wormHTML(30);

  // EO PATTERNS
  var p1000=dPcts(1000);
  var evenD=[0,2,4,6,8],oddD=[1,3,5,7,9];
  var evenSum=evenD.reduce(function(a,d){return a+p1000[d].pct;},0);
  var oddSum=oddD.reduce(function(a,d){return a+p1000[d].pct;},0);

  var balEl=document.getElementById('up-balance');
  if(balEl) balEl.innerHTML=dualBEO(evenSum/(evenSum+oddSum)*100)+'<div class="sr2"><span class="sl">Even total (0,2,4,6,8)</span><span class="sv" style="color:var(--green)">'+evenSum.toFixed(1)+'%</span></div><div class="sr2"><span class="sl">Odd total (1,3,5,7,9)</span><span class="sv" style="color:var(--orange)">'+oddSum.toFixed(1)+'%</span></div><div class="sr2"><span class="sl">Gap (need 3%+ for edge)</span><span class="sv">'+Math.abs(evenSum-oddSum).toFixed(1)+'% '+(Math.abs(evenSum-oddSum)>=3?'\u2705':'\u274c')+'</span></div>';

  var hcEl=document.getElementById('up-hotcold');
  if(hcEl) hcEl.innerHTML=[0,1,2,3,4,5,6,7,8,9].sort(function(a,b){return p1000[b].pct-p1000[a].pct;}).map(function(d){
    var p=p1000[d].pct,isE=d%2===0;
    var status=p>=13?'\uD83D\uDD25 Very hot':p>=11?'\u2668\uFE0F Hot':p>=9?'Normal':p<7?'\u2744\uFE0F Cold':'Mild';
    var col=p>=11?'var(--red)':p>=9?'var(--orange)':p<7?'var(--accent)':'var(--muted)';
    return '<div class="sr2"><span class="sl">'+(isE?'Even':'Odd')+' Digit '+d+'</span><span class="sv" style="color:'+col+'">'+p.toFixed(1)+'% \u2014 '+status+'</span></div>';
  }).join('');

  var spkEl=document.getElementById('up-spike');
  var spikeDig=p1000.find(function(s){return s.pct>15;});
  if(spkEl) spkEl.innerHTML=spikeDig?'<div class="cr"><div class="cd cd-n">!</div><div>\u26a0 Digit '+spikeDig.digit+' at '+spikeDig.pct.toFixed(1)+'% \u2014 DO NOT trade '+(spikeDig.digit%2===0?'EVEN':'ODD')+'</div></div>':'<div class="cr"><div class="cd cd-y">\u2713</div><div>No digit above 15% \u2014 safe to look for entry</div></div>';

  var parWrap=document.getElementById('up-parity-bars');
  if(parWrap&&!_upParityBuilt){
    parWrap.innerHTML=[0,1,2,3,4,5,6,7,8,9].map(function(d){
      return '<div class="dbar-col"><div class="dbar-fill" id="up-dfill-'+d+'" style="height:3px;background:'+(d%2===0?'var(--green)':'var(--orange)')+'"></div><div class="dbar-lbl">'+d+'</div><div class="dbar-pct" id="up-dpct-'+d+'">--%</div></div>';
    }).join('');
    _upParityBuilt=true;
  }
  if(parWrap){
    p1000.forEach(function(s){
      var fill=document.getElementById('up-dfill-'+s.digit);
      var pctEl=document.getElementById('up-dpct-'+s.digit);
      if(fill){fill.style.height=Math.max(3,s.pct/15*70)+'px';fill.style.outline=(last&&s.digit===last.digit)?'2px solid white':'none';}
      if(pctEl)pctEl.textContent=s.pct.toFixed(1)+'%';
    });
  }
}


//  INIT
// ── DISMISS ENGINE — safe cross-origin close ──────────────────────────────────
function dismissEngine(){
  // Strategy 1: postMessage to parent (universal cross-origin)
  try { window.parent.postMessage('ceoskit_close_engine', '*'); } catch(e1){}
  // Strategy 2: direct parent call (same-origin fallback)
  try { if(window.parent && window.parent.closeEngine) window.parent.closeEngine(); } catch(e2){}
  // NOTE: Never navigate the iframe — that destroys the blob and freezes on next open
}

function initApp(){
  initOUGrid();
  setDir('over');
  setTab('rf');
  connect();
  // LightweightCharts is injected inline into this blob by the outer page — call directly
  if(typeof LightweightCharts !== 'undefined'){ initChart(); }
  else {
    // Fallback: try CDN (slow path, only if outer page inject failed)
    function tryFallback(urls,i){
      if(i>=urls.length) return;
      const s=document.createElement('script'); s.src=urls[i];
      s.onload=()=>initChart(); s.onerror=()=>tryFallback(urls,i+1);
      document.head.appendChild(s);
    }
    tryFallback([
      'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.min.js',
      'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js'
    ],0);
  }
}

initApp();
<\/script>

<\/body>
<!-- Indicator Settings Panel (inside iframe) -->
<style>
#is-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;
  display:none;align-items:flex-end;justify-content:center;
  -webkit-tap-highlight-color:transparent;
}
#is-overlay.open{display:flex;}
#is-sheet{
  background:#0d1117;border-radius:20px 20px 0 0;
  border-top:3px solid #7c4dff;width:100%;max-width:520px;
  max-height:90vh;overflow-y:auto;
  box-shadow:0 -10px 48px rgba(124,77,255,.30);
  animation:isSlideUp .3s cubic-bezier(.32,1.2,.5,1) both;
}
@keyframes isSlideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
#is-sheet::-webkit-scrollbar{width:3px;}
#is-sheet::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:3px;}

#is-topbar{
  position:sticky;top:0;z-index:2;
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px 12px;
  background:#0d1117;border-bottom:1px solid #1e2230;
}
#is-topbar-left h2{
  font-size:13px;font-weight:900;color:#e0e0e0;
  letter-spacing:.5px;text-transform:uppercase;margin:0 0 2px;
}
#is-topbar-left p{font-size:9px;color:#556;margin:0;letter-spacing:.3px;}
#is-dismiss{
  width:34px;height:34px;border-radius:50%;
  background:#1e2230;border:1px solid #3a4560;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;font-size:16px;color:#aaa;font-weight:900;
  flex-shrink:0;-webkit-tap-highlight-color:transparent;
  transition:background .15s,color .15s;
}
#is-dismiss:active{background:#ff1744;color:#fff;border-color:#ff1744;}

.is-sec{padding:14px 16px 2px;}
.is-sec-title{
  font-size:8px;font-weight:900;letter-spacing:1.5px;
  text-transform:uppercase;padding-bottom:8px;
  border-bottom:1px solid #1e2230;margin-bottom:12px;
}
.is-row{margin-bottom:16px;}
.is-lbl-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
.is-lbl{font-size:10px;font-weight:700;color:#c0c0c0;letter-spacing:.3px;}
.is-val{font-size:12px;font-weight:900;font-family:monospace;min-width:32px;text-align:right;}
.is-hint{font-size:8px;color:#445;margin-top:3px;line-height:1.4;}

input[type=range].isl{
  -webkit-appearance:none;width:100%;height:6px;border-radius:4px;
  background:#1e2230;outline:none;cursor:pointer;margin:0;
}
input[type=range].isl::-webkit-slider-thumb{
  -webkit-appearance:none;width:22px;height:22px;border-radius:50%;
  border:2px solid #fff;cursor:pointer;transition:transform .12s;
  box-shadow:0 2px 8px rgba(0,0,0,.5);
}
input[type=range].isl:active::-webkit-slider-thumb{transform:scale(1.3);}
input[type=range].isl.c-orange::-webkit-slider-thumb{background:#ff9100;}
input[type=range].isl.c-purple::-webkit-slider-thumb{background:#9c27b0;}
input[type=range].isl.c-green::-webkit-slider-thumb{background:#00e676;}
input[type=range].isl.c-red::-webkit-slider-thumb{background:#ff1744;}
input[type=range].isl.c-cyan::-webkit-slider-thumb{background:#00bcd4;}
input[type=range].isl.c-violet::-webkit-slider-thumb{background:#7c7cff;}

.is-track{position:relative;margin:4px 0;}
.is-track-bg{
  position:absolute;top:50%;transform:translateY(-50%);
  left:0;right:0;height:6px;border-radius:4px;
  background:#1e2230;pointer-events:none;
}
.is-track-fill{
  position:absolute;top:50%;transform:translateY(-50%);
  left:0;height:6px;border-radius:4px 0 0 4px;
  pointer-events:none;transition:width .08s;
}

#is-reset{
  margin:12px 16px 4px;padding:12px;
  background:#1a1d2e;border:1px solid #2a2d3e;border-radius:12px;
  font-size:10px;font-weight:900;color:#778;
  letter-spacing:.5px;text-transform:uppercase;
  text-align:center;cursor:pointer;
  -webkit-tap-highlight-color:transparent;
  transition:all .15s;
}
#is-reset:active{background:#2a2d3e;color:#ccc;}
#is-footer-note{text-align:center;font-size:8px;color:#334;padding:8px 16px 20px;letter-spacing:.3px;}
<\/style>

<div id="is-overlay" onclick="if(event.target===this)isClose()">
  <div id="is-sheet">

    <div id="is-topbar">
      <div id="is-topbar-left">
        <h2>⚙️ Indicator Settings</h2>
        <p>VFPI — drag slider to tune in real-time</p>
      </div>
      <div id="is-dismiss" onclick="isClose()">✕</div>
    </div>

    <!-- Signal Tiers -->
    <div class="is-sec">
      <div class="is-sec-title" style="color:#9c27b0;">🟣 Signal Tier Thresholds</div>

      <div class="is-row">
        <div class="is-lbl-row">
          <span class="is-lbl">⭐ Strong — RISE / FALL arrow</span>
          <span class="is-val" id="sv-strong" style="color:#00e676;">72</span>
        </div>
        <div class="is-track">
          <div class="is-track-bg"></div>
          <div class="is-track-fill" id="tf-strong" style="background:#00e676;width:49%"></div>
          <input type="range" class="isl c-green" id="sl-strong" min="50" max="95" value="72" step="1" oninput="isUpdate('strong',this.value)">
        </div>
        <div class="is-hint">Score ≥ this → large arrow with RISE/FALL text. Higher = fewer, surer signals</div>
      </div>

      <div class="is-row">
        <div class="is-lbl-row">
          <span class="is-lbl">✅ Confirmed — R / F arrow</span>
          <span class="is-val" id="sv-conf" style="color:#69f0ae;">50</span>
        </div>
        <div class="is-track">
          <div class="is-track-bg"></div>
          <div class="is-track-fill" id="tf-conf" style="background:#69f0ae;width:50%"></div>
          <input type="range" class="isl c-green" id="sl-conf" min="30" max="70" value="50" step="1" oninput="isUpdate('conf',this.value)">
        </div>
        <div class="is-hint">Score ≥ this → medium arrow. Lower = more signals</div>
      </div>

      <div class="is-row">
        <div class="is-lbl-row">
          <span class="is-lbl">🚫 Noise Floor (ignore below)</span>
          <span class="is-val" id="sv-nf" style="color:#ff5252;">30</span>
        </div>
        <div class="is-track">
          <div class="is-track-bg"></div>
          <div class="is-track-fill" id="tf-nf" style="background:#ff1744;width:43%"></div>
          <input type="range" class="isl c-red" id="sl-nf" min="15" max="50" value="30" step="1" oninput="isUpdate('nf',this.value)">
        </div>
        <div class="is-hint">Signals below this are silently discarded — raise to cut noise</div>
      </div>
    </div>

    <!-- VFPI Confidence -->
    <div class="is-sec">
      <div class="is-sec-title" style="color:#7c7cff;">🟣 VFPI Sensitivity</div>

      <div class="is-row">
        <div class="is-lbl-row">
          <span class="is-lbl">VFPI Min Confidence</span>
          <span class="is-val" id="sv-vfpiconf" style="color:#7c7cff;">52</span>
        </div>
        <div class="is-track">
          <div class="is-track-bg"></div>
          <div class="is-track-fill" id="tf-vfpiconf" style="background:#7c7cff;width:44%"></div>
          <input type="range" class="isl c-violet" id="sl-vfpiconf" min="30" max="80" value="52" step="1" oninput="isUpdate('vfpiconf',this.value)">
        </div>
        <div class="is-hint">VFPI arrows only fire above this confidence level</div>
      </div>
    </div>

    <div id="is-reset" onclick="isReset()">↺ &nbsp; Reset All to Defaults</div>
    <div id="is-footer-note">Changes apply on next tick · No reload needed</div>

  </div>
</div>

<script>
// ── Settings panel functions (inside iframe) ──
var IS_DEF = { strong:72,conf:50,nf:30,vfpiconf:52 };

function isOpen(){
  var ov = document.getElementById('is-overlay');
  if(ov){ ov.classList.add('open'); isSync(); }
}
function isClose(){
  var ov = document.getElementById('is-overlay');
  if(ov) ov.classList.remove('open');
}

function isFill(fillId, val, min, max){
  var el = document.getElementById(fillId);
  if(el) el.style.width = ((val-min)/(max-min)*100).toFixed(1)+'%';
}

function isSync(){
  var s = (typeof IND_SETTINGS !== 'undefined') ? IND_SETTINGS : {};
  var map = [
    ['strong',s.sig_strong||72,'sv-strong','tf-strong',50,95],
    ['conf',s.sig_confirmed||50,'sv-conf','tf-conf',30,70],
    ['nf',s.sig_noise_floor||30,'sv-nf','tf-nf',15,50],
    ['vfpiconf',s.vfpi_sig_conf||52,'sv-vfpiconf','tf-vfpiconf',30,80],
  ];
  map.forEach(function(row){
    var key=row[0],val=row[1],svId=row[2],tfId=row[3],min=row[4],max=row[5];
    var slEl=document.getElementById('sl-'+key);
    var svEl=document.getElementById(svId);
    if(slEl) slEl.value=val;
    if(svEl) svEl.textContent=val;
    isFill(tfId,val,min,max);
  });
}

function isUpdate(key, rawVal){
  var val = parseFloat(rawVal);
  var map = {
    'strong': ['sig_strong',       'sv-strong',  'tf-strong',  50, 95],
    'conf':   ['sig_confirmed',    'sv-conf',    'tf-conf',    30, 70],
    'nf':     ['sig_noise_floor',  'sv-nf',      'tf-nf',      15, 50],
    'vfpiconf':['vfpi_sig_conf',   'sv-vfpiconf','tf-vfpiconf',30, 80],
  };
  var entry = map[key]; if(!entry) return;
  var prop=entry[0],svId=entry[1],tfId=entry[2],min=entry[3],max=entry[4];
  if(typeof IND_SETTINGS !== 'undefined') IND_SETTINGS[prop] = val;
  var svEl=document.getElementById(svId); if(svEl) svEl.textContent=val;
  isFill(tfId,val,min,max);
  // Enforce ordering: nf < conf < strong
  if(typeof IND_SETTINGS !== 'undefined'){
    if(IND_SETTINGS.sig_noise_floor >= IND_SETTINGS.sig_confirmed){
      IND_SETTINGS.sig_confirmed = IND_SETTINGS.sig_noise_floor+5;
      var ce=document.getElementById('sv-conf'); if(ce) ce.textContent=IND_SETTINGS.sig_confirmed;
      var cf=document.getElementById('sl-conf'); if(cf) cf.value=IND_SETTINGS.sig_confirmed;
      isFill('tf-conf',IND_SETTINGS.sig_confirmed,30,70);
    }
    if(IND_SETTINGS.sig_confirmed >= IND_SETTINGS.sig_strong){
      IND_SETTINGS.sig_strong = IND_SETTINGS.sig_confirmed+5;
      var se=document.getElementById('sv-strong'); if(se) se.textContent=IND_SETTINGS.sig_strong;
      var sf=document.getElementById('sl-strong'); if(sf) sf.value=IND_SETTINGS.sig_strong;
      isFill('tf-strong',IND_SETTINGS.sig_strong,50,95);
    }
  }
  // Re-render VFPI with new settings
  if(typeof candleHistory!=='undefined'&&candleHistory.length>55){
    try{ if(typeof updateVFP==='function') updateVFP(candleHistory); }catch(e){}
  }
}

function isReset(){
  if(typeof IND_SETTINGS!=='undefined'){
    IND_SETTINGS.sig_strong=72;IND_SETTINGS.sig_confirmed=50;IND_SETTINGS.sig_noise_floor=30;
    IND_SETTINGS.vfpi_sig_conf=52;
  }
  isSync();
  if(typeof candleHistory!=='undefined'&&candleHistory.length>55){
    try{ if(typeof updateVFP==='function') updateVFP(candleHistory); }catch(e){}
  }
}
<\/script>

<\/html>
`;

function openEngine(){
    closeAll();
    const overlay = document.getElementById('engine-overlay');
    const iframe  = document.getElementById('engine-iframe');
    const loading = document.getElementById('engine-loading');
    const _ch = measureChrome ? measureChrome() : 0;
    overlay.style.top     = _ch + 'px';
    overlay.style.display = 'flex';
    // Mark toolbar button active
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
    const engineBtn = document.getElementById('btn-engine');
    if(engineBtn) engineBtn.classList.add('active-tool');

    if(iframe._blobLoaded){
        loading.style.display = 'none';
        // Re-trigger resize so chart + icons repaint correctly on revisit
        try {
            iframe.contentWindow.dispatchEvent(new Event('resize'));
            if(iframe.contentWindow._resizeChart) iframe.contentWindow._resizeChart();
        } catch(e){}
        return;
    }

    loading.style.display = 'flex';

    let htmlToLoad = ENGINE_HTML;
    if(_chartLibText){
        htmlToLoad = ENGINE_HTML.replace(
            '<!-- LightweightCharts loaded dynamically in initApp() to avoid CDN race conditions -->',
            '<script>' + _chartLibText + '<\/script>'
        );
    }

    const blob = new Blob([htmlToLoad], {type:'text/html'});
    iframe.onload = function(){
        loading.style.display = 'none';
        const saSel  = document.getElementById('sa-market-select');
        const curSym = (saSel && saSel.value) || '';
        if(curSym && iframe.contentWindow){
            setTimeout(function(){
                try { iframe.contentWindow.postMessage({type:'ceoskit_setSymbol', symbol:curSym}, '*'); } catch(err){}
            }, 800);
        }
    };
    if(iframe._prevBlobURL){ try { URL.revokeObjectURL(iframe._prevBlobURL); } catch(e){} }
    const blobURL = URL.createObjectURL(blob);
    iframe._prevBlobURL = blobURL;
    iframe.src = blobURL;
    iframe._blobLoaded = true;
}

function closeEngine(){
    const overlay = document.getElementById('engine-overlay');
    const loading = document.getElementById('engine-loading');
    // Hide overlay — do NOT touch the iframe src or _blobLoaded flag.
    // The blob iframe stays live in memory so reopening is instant with no freeze.
    if(overlay) overlay.style.display = 'none';
    // Reset button text
    const engineBtn = document.getElementById('btn-engine');
    if(engineBtn) engineBtn.classList.remove('active-tool');
}


// ── TOOLS OVERLAY ──
var _activeToolsTab = 'risk';
function liveRefreshTools(){
    var overlay = document.getElementById('tools-overlay');
    if(!overlay || !overlay.classList.contains('open')) return;
    var tab = _activeToolsTab;
    if(tab === 'risk'){
        try {
            var el = document.getElementById('tools-panel-risk');
            if(el) el.innerHTML = build_risk();
        } catch(e){}
    } else if(tab === 'calc'){
        try { calcRisk(); } catch(e){}
    } else if(tab === 'report'){
        try {
            var el = document.getElementById('tools-panel-report');
            if(el) el.innerHTML = build_report();
        } catch(e){}
    }
}
function openTools(){
    closeAll();
    applyModalTop('tools-overlay');
    document.getElementById('tools-overlay').classList.add('open');
    document.getElementById('btn-tools').classList.add('active-tool');
    switchToolsTab(_activeToolsTab);
}
function closeTools(){
    document.getElementById('tools-overlay').classList.remove('open');
    document.getElementById('btn-tools').classList.remove('active-tool');
}
function switchToolsTab(tab){
    _activeToolsTab = tab;
    document.querySelectorAll('.tools-tab').forEach(function(t,i){
        var tabs = ['risk','calc','report'];
        t.classList.toggle('tact', tabs[i] === tab);
    });
    document.querySelectorAll('.tools-panel').forEach(function(p){
        p.classList.remove('tshow');
    });
    var panel = document.getElementById('tools-panel-' + tab);
    if(panel) panel.classList.add('tshow');

    if(tab === 'risk'){
        try {
            var el = document.getElementById('tools-panel-risk');
            if(el) el.innerHTML = build_risk();
        } catch(e){ console.warn('tools risk err',e); }
    } else if(tab === 'calc'){
        var mount = document.getElementById('tools-rc-mount');
        if(mount && mount.innerHTML.trim() === ''){
            // Move the rc-body DOM node into tools (not a clone — the real one)
            var orig = document.querySelector('#risk-calc-overlay .rc-body');
            if(orig){ mount.appendChild(orig); }
        }
        calcRisk();
    } else if(tab === 'report'){
        try {
            var el = document.getElementById('tools-panel-report');
            if(el){
                el.innerHTML = build_report();
                // Also request fresh profit_table and statement from WS
                if(socket && socket.readyState===1){
                    socket.send(JSON.stringify({
                        profit_table:1, description:1, limit:50,
                        sort:'DESC', req_id:20
                    }));
                    socket.send(JSON.stringify({
                        statement:1, description:1, limit:50,
                        req_id:21
                    }));
                }
            }
        } catch(e){ console.warn('tools report err',e); }
    }
}
// Also update closeAll to include tools overlay

// Handle messages from Signal Engine iframe
window.addEventListener('message', function(e){
    if(!e.data) return;
    // Accept both string form ('ceoskit_close_engine') and object form ({type:...})
    var isClose = e.data === 'ceoskit_close_engine' ||
                  (typeof e.data === 'object' && e.data.type === 'ceoskit_close_engine');
    if(isClose){ closeEngine(); return; }
    if(typeof e.data === 'object' && e.data.type === 'ceoskit_setSymbol'){
        // handled by existing listener below
    }
});



// ═══════════════════════════════════════════════════════════════
//  ADMIN PANEL JS
// ═══════════════════════════════════════════════════════════════
var _admOpen = false;

function openAdminPanel(){
    _admOpen = true;
    document.getElementById('admin-overlay').classList.add('open');
    admLoadFields();
    admRefreshStatus();
}
function closeAdminPanel(){
    _admOpen = false;
    document.getElementById('admin-overlay').classList.remove('open');
}

const _ADM_KEYS = ['app_id','client_id','redirect_uri','affiliate_token','utm_campaign','ws_public','rest_base'];

function admLoadFields(){
    _ADM_KEYS.forEach(k=>{
        const el = document.getElementById('adm-'+k);
        if(el) el.value = _cfg(k) || '';
        admUpdateBadge(k, _cfg(k));
    });
    // Token + acct (safe even if auth helpers not yet defined)
    const tok = (typeof getAuthToken === 'function') ? getAuthToken() : localStorage.getItem('deriv_token1');
    const tokEl = document.getElementById('adm-token');
    if(tokEl) tokEl.value = tok ? '••••••••••••••••' : '';
    admUpdateBadge('token', tok);
    const acct = getActiveAccount();
    const acctEl = document.getElementById('adm-acct');
    if(acctEl) acctEl.value = acct || '';
    admUpdateBadge('acct', acct && acct !== '—' ? acct : '');
}

function admUpdateBadge(key, val){
    const el = document.getElementById('adm-badge-'+key);
    if(!el) return;
    if(val && val !== '—' && !val.startsWith('••')){
        el.className = 'adm-badge set';
        el.textContent = '✓ set';
    } else if(val && val.startsWith('••')){
        el.className = 'adm-badge set';
        el.textContent = '✓ stored';
    } else {
        el.className = 'adm-badge unset';
        el.textContent = 'not set';
    }
}

async function admFetchAccounts(){
    admShowStatus('Fetching accounts…', 'ok');

    // ── Try new REST API first ──────────────────────────────────────────────
    try{
        const accounts = await restGetAccounts();
        if(accounts && accounts.length){
            const demo = accounts.find(a=>a.account_type==='demo') || accounts[0];
            const acctEl = document.getElementById('adm-acct');
            if(acctEl){ acctEl.value = demo.account_id; admUpdateBadge('acct', demo.account_id); }
            localStorage.setItem('deriv_active_acct', demo.account_id);
            const tok = localStorage.getItem('deriv_token1');
            localStorage.setItem('deriv_accounts', JSON.stringify(accounts.map(a=>({
                account: a.account_id, account_id: a.account_id,
                currency: a.currency, balance: a.balance,
                isReal: a.account_type==='real', account_type: a.account_type, token: tok
            }))));
            populateMenuAccount();
            admRefreshStatus();
            admShowStatus('✅ Found '+accounts.length+' account(s). Active: '+demo.account_id, 'ok');
            return;
        }
    } catch(e){ console.warn('REST get accounts failed, trying legacy WS…', e); }

    // ── Fallback: PAT token via legacy WebSocket authorize ──────────────────
    const tok = localStorage.getItem('deriv_token1');
    const appId = _cfg('app_id');
    if(!tok || !appId){ admShowStatus('❌ No token or App ID set.', 'err'); return; }

    admShowStatus('Trying legacy WebSocket…', 'ok');
    try{
        await new Promise((resolve, reject) => {
            const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
            const timeout = setTimeout(()=>{ ws.close(); reject(new Error('Timeout')); }, 8000);
            ws.onopen = () => ws.send(JSON.stringify({authorize: tok}));
            ws.onmessage = (msg) => {
                const d = JSON.parse(msg.data);
                if(d.msg_type === 'authorize'){
                    if(d.error){ clearTimeout(timeout); ws.close(); reject(new Error(d.error.message)); return; }
                    // Got auth — now get account list
                    ws.send(JSON.stringify({account_list: 1}));
                }
                if(d.msg_type === 'account_list'){
                    clearTimeout(timeout); ws.close();
                    const accts = d.account_list || [];
                    if(!accts.length){ reject(new Error('No accounts returned')); return; }
                    // Store accounts in unified format
                    const stored = accts.map(a=>({
                        account: a.loginid, account_id: a.loginid,
                        currency: a.currency||'USD',
                        balance: a.balance!=null ? parseFloat(a.balance) : null,
                        isReal: !a.is_virtual,
                        account_type: a.is_virtual?'demo':'real',
                        token: tok
                    }));
                    localStorage.setItem('deriv_accounts', JSON.stringify(stored));
                    const active = stored.find(a=>!a.isReal) || stored[0];
                    localStorage.setItem('deriv_active_acct', active.account);
                    localStorage.setItem('deriv_token_type', 'pat');
                    // Update admin UI
                    const acctEl = document.getElementById('adm-acct');
                    if(acctEl){ acctEl.value = active.account; admUpdateBadge('acct', active.account); }
                    if(typeof populateMenuAccount==='function') populateMenuAccount();
                    admRefreshStatus();
                    admShowStatus('✅ Found '+stored.length+' account(s) via legacy WS. Active: '+active.account, 'ok');
                    resolve();
                }
                if(d.error && d.msg_type !== 'authorize'){
                    clearTimeout(timeout); ws.close(); reject(new Error(d.error.message));
                }
            };
            ws.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket error')); };
        });
    } catch(e){ admShowStatus('❌ '+e.message+'. Check App ID and Token.', 'err'); }
}

async function admResetDemo(){
    const active = getActiveAccount();
    if(!active || active==='—'){ admShowStatus('❌ No active account set. Fetch accounts first.','err'); return; }
    admShowStatus('Resetting demo balance…','ok');
    try{
        const result = await restResetDemoBalance(active);
        if(result){
            onBalanceUpdate({balance:result.balance, currency:result.currency, loginid:result.account_id||active});
            admShowStatus('✅ Balance reset to '+result.balance+' '+result.currency, 'ok');
        }
    } catch(e){ admShowStatus('❌ '+e.message,'err'); }
}

function admSave(){
    // Save config keys
    _ADM_KEYS.forEach(k=>{
        const el = document.getElementById('adm-'+k);
        if(el && el.value.trim()) _setCfg(k, el.value.trim());
        else if(el && !el.value.trim()) localStorage.removeItem('csk_cfg_'+k);
    });

    // Save token if not placeholder
    const tokEl = document.getElementById('adm-token');
    if(tokEl && tokEl.value && !tokEl.value.startsWith('••')){
        const rawTok = tokEl.value.trim();
        localStorage.setItem('deriv_token1', rawTok);
        // Detect type: JWT = long with dots (ory_at_... format), PAT = pat_ prefix or shorter
        const isJwt = (rawTok.startsWith('ory_at_') || (rawTok.includes('.') && rawTok.length > 100));
        const isPat = rawTok.startsWith('pat_') || rawTok.startsWith('a1-');
        localStorage.setItem('deriv_token_type', isJwt ? 'jwt' : isPat ? 'pat' : 'legacy');
    }

    // Save account id
    const acctEl = document.getElementById('adm-acct');
    if(acctEl && acctEl.value.trim()){
        localStorage.setItem('deriv_active_acct', acctEl.value.trim());
    }

    admShowStatus('✅ Saved! Applying…', 'ok');
    admRefreshStatus();
    admLoadFields();

    // If login overlay is visible and we now have a token — boot the app
    const loginOverlay = document.getElementById('login-overlay');
    const hasToken     = !!localStorage.getItem('deriv_token1');
    const loginVisible = loginOverlay && loginOverlay.style.display !== 'none';

    if(hasToken && loginVisible){
        closeAdminPanel();
        loBootApp();
        return;
    }

    // Already in app — just reconnect
    setTimeout(()=>{
        if(socket && socket.readyState <= 1) { try{ socket.close(); }catch(e){} }
        setTimeout(()=>connect(), 500);
    }, 600);
}

function admClear(){
    if(!confirm('Clear all stored API config? You will need to log in again.')) return;
    _ADM_KEYS.forEach(k=>localStorage.removeItem('csk_cfg_'+k));
    clearAuth();
    admLoadFields();
    admShowStatus('🗑️ Cleared. Reload the page to log in again.', 'err');
}

function admShowStatus(msg, type){
    const el = document.getElementById('adm-status');
    el.textContent = msg;
    el.className = 'adm-status ' + type;
    el.style.display = 'block';
    setTimeout(()=>{ el.style.display='none'; }, 4000);
}

function admRefreshStatus(){
    const el = document.getElementById('adm-conn-status');
    if(!el) return;
    const wsState = ['CONNECTING','OPEN','CLOSING','CLOSED'];
    const tok = (typeof getAuthToken==='function') ? getAuthToken() : localStorage.getItem('deriv_token1');
    const tokType = localStorage.getItem('deriv_token_type') || 'legacy';
    const acct = (typeof getActiveAccount==='function') ? getActiveAccount() : (localStorage.getItem('deriv_active_acct')||'—');
    const exp = localStorage.getItem('deriv_token_exp');
    const expStr = exp ? new Date(parseInt(exp)).toLocaleTimeString() : '—';
    const appId = _cfg('app_id');
    const clientId = _cfg('client_id');
    const wsMode = clientId ? 'New (OTP/PKCE)' : 'Legacy (app_id)';
    const wsStatus = socket ? (wsState[socket.readyState]||'?') : 'Not started';

    el.innerHTML = [
        `App ID: ${appId || '⚠️ not set'}`,
        `Client ID: ${clientId || '— (legacy mode)'}`,
        `Auth mode: ${wsMode}`,
        `Token: ${tok ? (tokType.toUpperCase()+' ✓') : '⚠️ not set'}`,
        `Token type: ${tokType}`,
        `Token expires: ${expStr}`,
        `Account: ${acct || '—'}`,
        `WS state: ${wsStatus}`,
        `Public WS: ${_cfg('ws_public') || _DEFAULTS.ws_public}`,
        `REST base: ${_cfg('rest_base') || _DEFAULTS.rest_base}`,
    ].map(l=>`<div>${l}</div>`).join('');
}

function admTestWs(key){
    const url = document.getElementById('adm-'+key).value.trim() || _DEFAULTS[key];
    const dot = document.getElementById('adm-dot-'+key);
    dot.className = 'adm-test-dot testing';
    try{
        const ws = new WebSocket(url);
        const t = setTimeout(()=>{ ws.close(); dot.className='adm-test-dot err'; }, 5000);
        ws.onopen = ()=>{ clearTimeout(t); dot.className='adm-test-dot ok'; setTimeout(()=>ws.close(),500); };
        ws.onerror = ()=>{ clearTimeout(t); dot.className='adm-test-dot err'; };
    } catch(e){ dot.className='adm-test-dot err'; }
}

// Escape key closes admin panel
document.addEventListener('keydown', function(e){
    if(e.key==='Escape' && _admOpen) closeAdminPanel();
});

document.addEventListener('keydown',e=>{

// ── FEATURE SHOWCASE ──
var _showcaseDone = false;
window._startFeatureShowcase = function(){
  if(_showcaseDone) return;
  _showcaseDone = true;
  var features = [
    { icon:'📊', name:'Chart',          color:'#1565c0', desc:'Live candlestick chart with VFPI indicator overlaid in real time.' },
    { icon:'🧠', name:'Smart Analysis', color:'#00897b', desc:'AI confluence engine reading momentum, patterns and volatility every tick.' },
    { icon:'🚀', name:'Signal Engine',  color:'#651fff', desc:'Signals, Patterns & live Stats across all 3 contract types simultaneously.' },
    { icon:'🎲', name:'Contracts',      color:'#8e24aa', desc:'Rise/Fall, Over/Under, Even/Odd & Differs — choose your edge.' },
    { icon:'🛠️', name:'Tools',          color:'#546e7a', desc:'Risk guide, live Calculator & Trade Report — all in one tap.' }
  ];
  var TICK = 3000;
  var box  = document.getElementById('feat-showcase');
  var iconEl = document.getElementById('feat-icon');
  var nameEl = document.getElementById('feat-name');
  var descEl = document.getElementById('feat-desc');
  var barEl  = document.getElementById('feat-bar');
  var dotsEl = document.getElementById('feat-dots');
  if(!box){ console.warn('feat-showcase not found'); return; }

  // Build dots
  dotsEl.innerHTML = '';
  features.forEach(function(_, i){
    var d = document.createElement('span');
    d.style.cssText = 'width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.25);display:inline-block;margin:0 3px;transition:all .3s;';
    dotsEl.appendChild(d);
  });

  function setDot(i){
    Array.from(dotsEl.children).forEach(function(d,j){
      d.style.background = j===i ? '#fff' : 'rgba(255,255,255,0.25)';
      d.style.transform  = j===i ? 'scale(1.4)' : 'scale(1)';
    });
  }

  function show(i){
    var f = features[i];
    iconEl.textContent      = f.icon;
    iconEl.style.background = f.color;
    nameEl.textContent      = f.name;
    descEl.textContent      = f.desc;
    barEl.style.background  = f.color;
    barEl.style.transition  = 'none';
    barEl.style.width       = '0%';
    setDot(i);
    setTimeout(function(){
      barEl.style.transition = 'width ' + TICK + 'ms linear';
      barEl.style.width = '100%';
    }, 40);
  }

  box.style.display = 'block';
  show(0);
  var cur = 0;
  var stepper = setInterval(function(){
    cur++;
    if(cur >= features.length){
      clearInterval(stepper);
      box.style.display = 'none';
      return;
    }
    show(cur);
  }, TICK);
};

    if(e.key==='Escape'){ closeEngine(); closeSmartAnalysis(); closeRiskCalc(); closeTools && closeTools(); }
});

// ── Symbol sync: receive symbol changes from Signal Engine iframe ──
window.addEventListener('message', function(e){
    if(!e.data || e.data.type !== 'ceoskit_setSymbol') return;
    const newSym = e.data.symbol;
    if(!newSym) return;
    // Update SA select if open
    const saSel = document.getElementById('sa-market-select');
    if(saSel && saSel.value !== newSym){
        const opt = saSel.querySelector('option[value="'+newSym+'"]');
        if(opt){
            saSel.value = newSym;
            saHistory = [];
            if(saSocket && saSocket.readyState === 1){
                saSocket.send(JSON.stringify({forget_all:'ticks'}));
                saSocket.send(JSON.stringify({ticks_history:newSym,count:1000,end:'latest',style:'ticks'}));
                saSocket.send(JSON.stringify({ticks:newSym,subscribe:1}));
            }
        }
    }
    // Update outer CEOSkit market select too (market-select at line 520)
    const outerSel = document.getElementById('market-select');
    if(outerSel && outerSel.value !== newSym){
        const opt2 = outerSel.querySelector('option[value="'+newSym+'"]');
        if(opt2){ outerSel.value = newSym; outerSel.dispatchEvent(new Event('change')); }
    }
});


/* ═══════════════════════════════════════════════════════════
 *  CEOSkit Signal Engine — Enhancement Pack v1.0
 *  Toast · Sound · Signal Log · Trade Logger · Win Rate
 *  Tick Countdown · Offline Watchdog
 * ═══════════════════════════════════════════════════════════ */

/* ── TOAST ── */
function toast(msg, type, ms){
  type=type||'info'; ms=ms||4000;
  var r=document.getElementById('_toast_r');
  if(!r){r=document.createElement('div');r.id='_toast_r';r.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:6px;pointer-events:none;width:min(92vw,340px)';document.body.appendChild(r);}
  var p={info:{b:'rgba(63,81,181,.95)',e:'#5c6bc0',i:'ℹ'},win:{b:'rgba(0,180,60,.95)',e:'#00c853',i:'✓'},loss:{b:'rgba(220,48,48,.95)',e:'#ff5252',i:'✗'},strong:{b:'rgba(0,200,83,.95)',e:'#00e676',i:'🏆'},warn:{b:'rgba(255,145,0,.93)',e:'#ff9800',i:'⚠'},offline:{b:'rgba(180,0,0,.95)',e:'#ff1744',i:'📡'}};
  var s=p[type]||p.info, t=document.createElement('div');
  t.style.cssText='background:'+s.b+';border:1px solid '+s.e+';border-radius:12px;padding:11px 15px;pointer-events:all;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px';
  t.innerHTML='<span style="font-size:1rem;flex-shrink:0">'+s.i+'</span><span style="font-size:12px;font-weight:700;color:#fff;line-height:1.4">'+msg+'</span>';
  t.onclick=function(){t.remove();}; r.appendChild(t);
  setTimeout(function(){t.remove();},ms);
}

/* ── SOUND ── */
var _aC=null;
function _au(){if(!_aC)try{_aC=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}return _aC;}
function _bp(f,d,tp,v){try{var c=_au();if(!c)return;var o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.type=tp||'sine';o.frequency.value=f;g.gain.setValueAtTime(v||.2,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);o.start();o.stop(c.currentTime+d);}catch(e){}}
function sndStrong(){_bp(523,.07,'sine',.28);setTimeout(function(){_bp(659,.07,'sine',.28);},80);setTimeout(function(){_bp(784,.2,'sine',.28);},160);}
function sndWin(){_bp(600,.07,'sine',.22);setTimeout(function(){_bp(800,.14,'sine',.22);},75);}
function sndLoss(){_bp(220,.12,'sawtooth',.18);setTimeout(function(){_bp(160,.22,'sawtooth',.15);},130);}
function sndTick(){_bp(440,.035,'sine',.07);}
function _sndOk(){var b=document.getElementById('sound-btn');return!b||b.getAttribute('data-on')!=='0';}

/* ── SIGNAL LOG ── */
var SIG_LOG=[], _lastSigKey=null;
var TRADE_LOG=JSON.parse(localStorage.getItem('se_trades')||'[]');

function _recSig(signal,conf,type,price,digit){
  var k=signal+'|'+conf+'|'+type; if(k===_lastSigKey)return; _lastSigKey=k;
  SIG_LOG.unshift({id:Date.now(),time:new Date().toTimeString().slice(0,8),signal:signal,conf:conf,type:type,price:price,digit:digit,result:null});
  if(SIG_LOG.length>60)SIG_LOG.pop();
  _renderSig();
  if(conf==='STRONG'){if(_sndOk())sndStrong();toast('🏆 STRONG: '+signal+' — '+type,'strong',5500);}
}

function _renderSig(){
  var el=document.getElementById('sig-entries'); if(!el)return;
  if(!SIG_LOG.length){el.innerHTML='<div style="text-align:center;color:var(--muted);font-size:11px;padding:28px">No signals yet</div>';return;}
  el.innerHTML=SIG_LOG.map(function(s,i){
    var up=/RISE|EVEN|OVER|MATCH/i.test(s.signal),col=up?'#00c853':'#ef4444';
    var cc=s.conf==='STRONG'?'#00c853':s.conf==='MODERATE'?'#f59e0b':'#94a3b8';
    var rp=s.result
      ?'<span style="font-size:9px;font-weight:900;padding:2px 8px;border-radius:6px;color:'+(s.result==='win'?'#00c853':'#ef4444')+';background:'+(s.result==='win'?'#00c85322':'#ef444422')+';border:1px solid '+(s.result==='win'?'#00c853':'#ef4444')+'">'+s.result.toUpperCase()+'</span>'
      :'<span onclick="asgSig('+i+','win')" style="cursor:pointer;font-size:9px;font-weight:900;padding:2px 8px;border-radius:6px;color:#00c853;background:#00c85318;border:1px solid #00c853;margin-right:4px">W</span><span onclick="asgSig('+i+','loss')" style="cursor:pointer;font-size:9px;font-weight:900;padding:2px 8px;border-radius:6px;color:#ef4444;background:#ef444418;border:1px solid #ef4444">L</span>';
    return '<div style="padding:9px 0;border-bottom:1px solid #e2e8f018;display:flex;align-items:flex-start;gap:8px"><div style="width:7px;height:7px;border-radius:50%;background:'+col+';flex-shrink:0;margin-top:5px"></div><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span style="font-size:13px;font-weight:900;color:'+col+'">'+s.signal+'</span><span style="font-size:7px;font-weight:700;padding:1px 6px;border-radius:8px;color:'+cc+';background:'+cc+'18;border:1px solid '+cc+'">'+s.conf+'</span></div><div style="font-size:9px;color:var(--muted);margin-top:2px">'+s.time+' · '+s.type+(s.price?' · '+Number(s.price).toFixed(4):'')+'</div></div>'+rp+'</div>';
  }).join('');
}

function asgSig(i,r){
  if(SIG_LOG[i]){SIG_LOG[i].result=r;TRADE_LOG.unshift({time:SIG_LOG[i].time,signal:SIG_LOG[i].signal,conf:SIG_LOG[i].conf,type:SIG_LOG[i].type,result:r});if(TRADE_LOG.length>200)TRADE_LOG.pop();localStorage.setItem('se_trades',JSON.stringify(TRADE_LOG.slice(0,200)));_updWR();_renderSig();}
}

function openSigDrawer(){var el=document.getElementById('sig-drawer');if(el)el.style.display='flex';_renderSig();_updWR();}
function closeSigDrawer(){var el=document.getElementById('sig-drawer');if(el)el.style.display='none';}

/* ── TRADE LOGGER ── */
function logTrade(r){
  var last=SIG_LOG[0];
  TRADE_LOG.unshift({time:new Date().toTimeString().slice(0,8),signal:last?last.signal:'manual',conf:last?last.conf:'—',type:last?last.type:'—',result:r});
  if(TRADE_LOG.length>200)TRADE_LOG.pop();
  localStorage.setItem('se_trades',JSON.stringify(TRADE_LOG.slice(0,200)));
  if(SIG_LOG[0]&&!SIG_LOG[0].result)SIG_LOG[0].result=r;
  _updWR();_renderSig();
  if(r==='win'){if(_sndOk())sndWin();toast('✓ WIN logged','win',3000);}
  else{if(_sndOk())sndLoss();toast('✗ LOSS logged','loss',3000);}
}
function clearTrades(){TRADE_LOG.length=0;localStorage.setItem('se_trades','[]');_updWR();toast('Trade log cleared','info',2500);}

/* ── WIN RATE ── */
function _updWR(){
  var card=document.getElementById('wr-card');if(!card)return;
  if(!TRADE_LOG.length){card.style.display='none';return;}
  card.style.display='block';
  var w=TRADE_LOG.filter(function(t){return t.result==='win';}).length,tot=TRADE_LOG.length,pct=w/tot*100;
  var col=pct>=55?'#00c853':pct>=45?'#f59e0b':'#ef4444';
  var pEl=document.getElementById('wr-pct'),bEl=document.getElementById('wr-bar');
  if(pEl){pEl.textContent=pct.toFixed(1)+'%';pEl.style.color=col;}
  if(bEl){bEl.style.width=pct+'%';bEl.style.background=col;}
  var wE=document.getElementById('wr-w'),lE=document.getElementById('wr-l'),tE=document.getElementById('wr-t');
  if(wE)wE.textContent=w+' wins';if(lE)lE.textContent=(tot-w)+' losses';if(tE)tE.textContent=tot+' trades';
}

/* ── TICK COUNTDOWN ── */
var _ltTs=Date.now(),_tGaps=[],_avgMs=1000,_cntI=null;
function _onTick(){
  var now=Date.now(),g=now-_ltTs;_ltTs=now;
  if(g>180&&g<12000){_tGaps.push(g);if(_tGaps.length>20)_tGaps.shift();_avgMs=_tGaps.reduce(function(a,b){return a+b;},0)/_tGaps.length;}
  if(_sndOk())sndTick();
}
function _startCnt(){
  if(_cntI)clearInterval(_cntI);
  var strip=document.getElementById('tick-countdown');if(strip)strip.style.display='flex';
  _cntI=setInterval(function(){
    var el=Date.now()-_ltTs,rem=Math.max(0,_avgMs-el),pct=(rem/_avgMs)*100;
    var col=pct>50?'#00c853':pct>20?'#f59e0b':'#ef4444';
    var b=document.getElementById('tcd-bar'),s=document.getElementById('tcd-secs'),p=document.getElementById('tcd-price-mini');
    if(b){b.style.width=pct+'%';b.style.background=col;}
    if(s){s.textContent=(rem/1000).toFixed(1)+'s';s.style.color=col;}
    if(p&&typeof fullHistory!=='undefined'&&fullHistory.length){var l=fullHistory[fullHistory.length-1];p.textContent=l.price.toFixed(typeof pipSize!=='undefined'?pipSize:4);p.style.color=l.diff>=0?'#00c853':'#ef4444';}
  },80);
}

/* ── OFFLINE WATCHDOG ── */
var _ofBan=null,_ofSt=false;
setInterval(function(){
  var g=Date.now()-_ltTs;
  if(g>9000&&!_ofSt){_ofSt=true;if(!_ofBan){_ofBan=document.createElement('div');_ofBan.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99998;background:#d32f2f;color:#fff;text-align:center;font-size:11px;font-weight:900;padding:7px;letter-spacing:.4px';_ofBan.textContent='📡 Feed offline — reconnecting…';document.body.appendChild(_ofBan);}toast('📡 No ticks received — check connection','offline',7000);}
  if(g<3000&&_ofSt){_ofSt=false;if(_ofBan){_ofBan.remove();_ofBan=null;}toast('✓ Feed restored','win',3000);}
},2500);

/* ── HOOK INTO renderAll ── */
var _oRA=typeof renderAll==='function'?renderAll:null;
renderAll=function(){
  if(_oRA)_oRA();
  setTimeout(function(){
    var sEl=document.querySelector('.sig'),bEl=document.querySelector('.sigbadge');
    if(!sEl)return;
    var sig=sEl.textContent.trim();if(!sig||sig==='—'||sig==='LOADING')return;
    var badge=bEl?bEl.textContent.trim():'';
    var conf=badge.indexOf('STRONG')>=0?'STRONG':badge.indexOf('MODERATE')>=0?'MODERATE':'WEAK';
    var aEl=document.querySelector('.bnav.on .bnav-txt');
    var type=aEl?aEl.textContent.trim():'—';
    var price=typeof fullHistory!=='undefined'&&fullHistory.length?fullHistory[fullHistory.length-1].price:null;
    var digit=typeof fullHistory!=='undefined'&&fullHistory.length?fullHistory[fullHistory.length-1].digit:null;
    _recSig(sig,conf,type,price,digit);
    _onTick();
  },40);
};

/* ── BOOT ── */
_updWR();
_startCnt();
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(e.code==='Space'){e.preventDefault();logTrade('win');}
  if(e.code==='Backspace'){e.preventDefault();logTrade('loss');}
  if(e.key.toLowerCase()==='h')openSigDrawer();
});
if(!localStorage.getItem('se_v2')){localStorage.setItem('se_v2','1');setTimeout(function(){toast('👋 Signals log automatically. Tap 📋 Log to track results. Space=WIN, Backspace=LOSS','info',7000);},4000);}
