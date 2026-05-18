/* CEOSkit — Boot sequence, admin panel, UI panels */

// ── BOOT SEQUENCE ─────────────────────────────────────────────────────────────
// Problem: connect() fires at page load, WS events arrive during splash.
// By the time the boot-loader shows (~3-4s), all steps may already be done.
// Solution: record completed steps as boolean flags, replay them with
// animated delays when the loader becomes visible. Works in any browser.
const _bootSteps = [
    'Connecting to market feed…',
    'Loading symbol directory…',
    'Fetching price history…',
    'Starting live tick stream…',
];
var _bootFlags = [false, false, false, false]; // set true as each step fires
var _bootLoaderVisible = false;

function _renderBootStep(step){
    const bar = document.getElementById('boot-bar');
    const lbl = document.getElementById('boot-step');
    if(!bar || !lbl) return;
    bar.style.width = Math.round((step + 1) / _bootSteps.length * 100) + '%';
    lbl.textContent  = _bootSteps[step] || 'Ready';
    for(let i = 0; i < _bootSteps.length; i++){
        const dot = document.getElementById('bdot-' + i);
        if(!dot) continue;
        dot.className = 'boot-dot' +
            (i < step  ? ' done'   :
             i === step ? ' active' : '');
    }
}

function _finishBoot(){
    setTimeout(function(){
        const bl = document.getElementById('boot-loader');
        if(!bl) return;
        bl.style.transition = 'opacity .5s ease';
        bl.style.opacity    = '0';
        setTimeout(function(){
            bl.style.display = 'none';
            const mc = document.getElementById('main-content');
            if(mc) mc.classList.add('visible');
            // Start feature showcase now that live data is flowing
            setTimeout(function(){
                if(typeof window._startFeatureShowcase === 'function') window._startFeatureShowcase();
            }, 600);
        }, 520);
    }, 700);
}

// Called by WS handlers when each data milestone is hit
function advanceBoot(step){
    if(_bootFlags[step]) return;          // already recorded
    _bootFlags[step] = true;
    if(_bootLoaderVisible){
        // Loader is on screen — render immediately
        _renderBootStep(step);
        if(step >= _bootSteps.length - 1) _finishBoot();
    }
    // else: loader not visible yet — flag stored, startBootSequence will replay
}

// Called once boot-loader becomes visible (after splash fades)
function startBootSequence(){
    _bootLoaderVisible = true;
    // Replay any steps that already completed during the splash, with staggered
    // animation so the user sees the progress sequence even if it was instant.
    const done = _bootFlags.reduce(function(a,v){ return a + (v?1:0); }, 0);
    let delay  = 0;
    const GAP  = done >= _bootSteps.length ? 180 : 280; // fast-replay if all done
    for(let i = 0; i < _bootSteps.length; i++){
        if(_bootFlags[i]){
            (function(step, d){
                setTimeout(function(){
                    _renderBootStep(step);
                    if(step >= _bootSteps.length - 1) _finishBoot();
                }, d);
            })(i, delay);
            delay += GAP;
        }
    }
    // If nothing received yet (very slow network), show step 0 immediately
    if(!_bootFlags[0]){
        _bootFlags[0] = true;
        _renderBootStep(0);
    }
}

//  LIVE DATA ENGINE  — all derived from fullHistory (1000 ticks)
// Digit percentages from last N ticks
function dPcts(n){
    const sample=fullHistory.slice(-Math.min(n,fullHistory.length));
    const total=sample.length||1,counts=Array(10).fill(0);
    sample.forEach(t=>counts[t.digit]++);
    return counts.map((c,d)=>({digit:d,count:c,pct:(c/total)*100}));
}

// Is a digit stable? (percentage barely changing — "frozen")
function isStable(d,windowA=50,windowB=20){
    const p1=dPcts(windowA)[d].pct, p2=dPcts(windowB)[d].pct;
    return Math.abs(p1-p2)<0.5;
}

// Drift: recent vs historical (positive = heating, negative = cooling)
function driftOf(d){return dPcts(50)[d].pct-dPcts(1000)[d].pct;}

// Ranked digits: "green bar" = top-2 freq, "red bar" = bottom-1 freq
function barStatus(){
    const s=dPcts(1000),sorted=[...s].sort((a,b)=>b.pct-a.pct);
    const status=Array(10).fill('normal');
    status[sorted[0].digit]='green-bar';
    status[sorted[1].digit]='green-bar';
    status[sorted[9].digit]='red-bar';
    return status;
}

// Last digit (cursor position)
function cursor(){return fullHistory.length?fullHistory[fullHistory.length-1].digit:0;}

// Has cursor been stable on a digit? Check last N appearances of that digit
function cursorFrozenOn(digit,times=5){
    const recent=fullHistory.slice(-30).filter(t=>t.digit===digit);
    if(recent.length<times)return false;
    const pcts=recent.map((_,i)=>{const snap=fullHistory.slice(0,fullHistory.indexOf(recent[i])+1);const tot=snap.length;const cnt=snap.filter(t=>t.digit===digit).length;return cnt/tot*100;});
    const range=Math.max(...pcts)-Math.min(...pcts);
    return range<0.5;
}

// Count consecutive even/odd in last ticks
function consecutiveEOStreak(){
    const isEven=(d)=>d%2===0;
    let eCnt=0,oCnt=0;
    for(let i=fullHistory.length-1;i>=0;i--){
        if(isEven(fullHistory[i].digit)){eCnt++;if(oCnt>0)break;}else{if(eCnt>0)break;oCnt++;}
    }
    return{evenStreak:eCnt,oddStreak:oCnt};
}

// Consecutive same-direction ticks (for 3-candle rise/fall)
function consecDir(){
    let rCnt=0,fCnt=0;
    for(let i=fullHistory.length-1;i>=0;i--){
        if(fullHistory[i].diff>=0){rCnt++;if(fCnt>0)break;}else{if(rCnt>0)break;fCnt++;}
    }
    return{rise:rCnt,fall:fCnt};
}

// EMA + RSI
function ema(prices,p){if(prices.length<p)return null;const k=2/(p+1);let e=prices.slice(0,p).reduce((a,b)=>a+b,0)/p;for(let i=p;i<prices.length;i++)e=prices[i]*k+e*(1-k);return e;}
function rsi(prices,p=14){if(prices.length<p+1)return null;const sl=prices.slice(-p-1);let g=0,l=0;for(let i=1;i<sl.length;i++){const d=sl[i]-sl[i-1];d>0?g+=d:l-=d;}const ag=g/p,al=l/p;return al===0?100:100-(100/(1+ag/al));}

// Volatility
function calcVol(){const d=fullHistory.slice(-100).map(t=>Math.abs(t.diff));const atr=d.reduce((a,b)=>a+b,0)/d.length;const m=atr,std=Math.sqrt(d.reduce((a,b)=>a+Math.pow(b-m,2),0)/d.length);return{atr,std,level:std>0.5?'HIGH':std>0.2?'MEDIUM':'LOW'};}

// Kelly safe stake
function kellySafe(winP){const q=1-winP,b=0.95;return Math.max(0,Math.min((b*winP-q)/b,0.2))*100;}

// Support/Resistance
function suppRes(){const w=fullHistory.slice(-50).map(t=>t.price);return{support:Math.min(...w),resistance:Math.max(...w)};}

// Current streak
function curStreak(){if(!fullHistory.length)return{type:'N/A',len:0};const last=fullHistory[fullHistory.length-1];let type=last.diff>=0?'RISE':'FALL',len=1;for(let i=fullHistory.length-2;i>=0;i--){if((fullHistory[i].diff>=0?'RISE':'FALL')===type)len++;else break;}return{type,len};}

// Price bars HTML
function pBarsHTML(){
    const last=fullHistory.slice(-20);if(last.length<2)return'';
    const prices=last.map(t=>t.price);const mn=Math.min(...prices),mx=Math.max(...prices),range=mx-mn||0.001;
    return`<div class="pstrip">${last.map(t=>{const h=Math.max(3,((t.price-mn)/range)*26);const col=t.diff>=0?'var(--green)':'var(--red)';return`<div class="pbar" style="height:${h}px;background:${col}"></div>`;}).join('')}</div>`;
}

// Worm HTML
function wormHTML(n=25){const w=fullHistory.slice(-n);return`<div class="wrow">${w.map(t=>`<div class="wdot" style="background:${t.diff>=0?'var(--green)':'var(--red)'}">${t.diff>=0?'R':'F'}</div>`).join('')}</div>`;}

// Dual bar
function dualBar(risePct){const r=Math.min(Math.max(risePct,0),100),f=100-r;return`<div class="dualbar"><div class="db-g" style="width:${r}%"></div><div class="db-r" style="width:${f}%"></div></div><div class="dlr"><span style="color:var(--green)">▲ RISE ${r.toFixed(0)}%</span><span style="color:var(--red)">FALL ${f.toFixed(0)}% ▼</span></div>`;}

// Simple bar
function sBar(val,color,label=''){const v=Math.min(Math.max(val,0),100);return`<div class="bw"><div class="bf" style="width:${v}%;background:${color}"></div></div>${label?`<div class="blr"><span>${label}</span><span style="color:var(--text-main);font-weight:900">${v.toFixed(1)}%</span></div>`:''}`;}

// Heatmap color
function heatColor(pct){if(pct>=13)return'#EF4444';if(pct>=11)return'#F97316';if(pct>=10)return'#EAB308';if(pct>=9)return'#6366F1';if(pct>=7)return'#14B8A6';return'#3B82F6';}

// Entropy (chaos score)
function chaosScore(){const s=dPcts(1000);const H=s.reduce((a,t)=>{const p=t.pct/100;return p>0?a-p*Math.log2(p):a;},0);return H/Math.log2(10);}

//  PANEL BUILDERS
// ─── ⚡ BEST SIGNAL ───
function build_signal(){
    const p1000=dPcts(1000),p50=dPcts(50),p20=dPcts(20);
    const bars=barStatus();
    const cur=cursor();
    const prices=fullHistory.map(t=>t.price);
    const ema20=ema(prices,20),rsi14=rsi(prices,14),curP=prices[prices.length-1]||0;
    const sr=suppRes(),streak=curStreak(),vol=calcVol();
    const consDir=consecDir();
    const consEO=consecutiveEOStreak();
    const rises50=fullHistory.slice(-50).filter(t=>t.diff>=0).length;

    // Even/Odd signal check
    const evenD=[0,2,4,6,8],oddD=[1,3,5,7,9];
    const evenAbove10=evenD.filter(d=>p1000[d].pct>=10).length;
    const oddAbove10=oddD.filter(d=>p1000[d].pct>=10).length;
    const noOddAbove107=!oddD.some(d=>p1000[d].pct>=9.7);
    const noEvenAbove107=!evenD.some(d=>p1000[d].pct>=9.7);
    const evenSig=evenAbove10>=3&&noOddAbove107;
    const oddSig=oddAbove10>=3&&noEvenAbove107;

    // Rise/Fall 3-candle
    const rfSig3=consDir.rise>=3?'RISE':consDir.fall>=3?'FALL':null;

    // Over/Under: OVER 5 quick check (simple)
    const oSum=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    const ouSig=oSum>uSum?'OVER':'UNDER';
    const ouConf=Math.abs(oSum-uSum);

    // Determine best
    let bestSig,bestType,confLvl,tipMsg;
    if(rfSig3&&consDir.rise>=4||consDir.fall>=4){bestSig=rfSig3||ouSig;bestType='3-Candle Momentum';confLvl='STRONG';tipMsg=`${consDir.rise>=4?consDir.rise:consDir.fall} ${bestSig} candles in a row — enter NOW on the next tick`;}
    else if(evenSig&&consEO.evenStreak>=3){bestSig='EVEN';bestType='Even/Odd Strategy';confLvl='STRONG';tipMsg='3+ even digits hit in a row AND percentages are strong — enter EVEN now';}
    else if(oddSig&&consEO.oddStreak>=3){bestSig='ODD';bestType='Even/Odd Strategy';confLvl='STRONG';tipMsg='3+ odd digits hit in a row AND percentages are strong — enter ODD now';}
    else if(rfSig3){bestSig=rfSig3;bestType='3-Candle Momentum';confLvl='MODERATE';tipMsg=`${rfSig3==='RISE'?consDir.rise:consDir.fall} ${rfSig3} candles in a row — wait for one more candle then enter`;}
    else if(ouConf>12){bestSig=ouSig;bestType='Number Size Bias';confLvl='MODERATE';tipMsg=`The ${ouSig==='OVER'?'high':'low'} digits are dominating — favour ${ouSig} trades`;}
    else{bestSig=rises50>25?'RISE':'FALL';bestType='Basic Trend';confLvl='WEAK';tipMsg='No strong pattern yet — wait for a clearer setup before entering';}

    const sigCol=bestSig.match(/RISE|EVEN|OVER/)?'var(--green)':'var(--red)';

    return`
    <div class="card ${confLvl==='STRONG'?'green':confLvl==='MODERATE'?'orange':'red'}">
        <div class="stag ${confLvl==='STRONG'?'green':confLvl==='MODERATE'?'orange':'red'}">By CEOskit</div>
        <div class="card-title">🏆 Best Trade Right Now</div>
        <div class="big-sig">
            <div class="sig-text" style="color:${sigCol}">${bestSig}</div>
            <span class="sig-badge ${confLvl==='STRONG'?'sb-high':confLvl==='MODERATE'?'sb-med':'sb-low'}">${confLvl} SIGNAL</span>
            <div style="font-size:9px;color:var(--dark-gray);margin-top:4px">via ${bestType}</div>
        </div>
    </div>
    <div class="entry-box ${confLvl==='STRONG'?'':confLvl==='MODERATE'?'wait':'stop'}">
        <div class="entry-title">${confLvl==='STRONG'?'✅ Ready to Enter':'⏳ What to do next'}</div>
        <div class="entry-txt">${tipMsg}</div>
    </div>
    <div class="card">
        <div class="card-title">📊 Live Price Direction (Last 20 ticks)</div>
        ${pBarsHTML()}
        ${dualBar(rises50/50*100)}
    </div>
    <div class="card">
        <div class="card-title">📋 All Strategy Checks</div>
        <div class="cr"><div class="cd ${consDir.rise>=3||consDir.fall>=3?'cd-y':'cd-n'}">${consDir.rise>=3?'R':consDir.fall>=3?'F':'—'}</div><div><div>3-Candle: ${consDir.rise>=3?`${consDir.rise} RISE in a row`:consDir.fall>=3?`${consDir.fall} FALL in a row`:'Not yet — watching'}</div></div></div>
        <div class="cr"><div class="cd ${evenSig?'cd-y':oddSig?'cd-y':'cd-n'}">E/O</div><div><div>Even/Odd: ${evenSig?`${evenAbove10}/5 Even digits strong — EVEN`:oddSig?`${oddAbove10}/5 Odd digits strong — ODD`:'Not enough digits hitting 10%+'}</div></div></div>
        <div class="cr"><div class="cd ${ouConf>12?'cd-y':'cd-n'}">O/U</div><div><div>Over/Under: ${ouSig} (difference: ${ouConf.toFixed(1)}%)</div></div></div>
        <div class="cr"><div class="cd ${streak.len>=5?'cd-n':streak.len>=3?'cd-w':'cd-y'}">${streak.len}</div><div><div>Streak: ${streak.type} has run ${streak.len} times | ${streak.len>=5?'Wait — reversal likely':streak.len>=3?'Caution — streak active':'Safe to trade'}</div></div></div>
        <div class="cr"><div class="cd ${vol.level==='LOW'?'cd-y':vol.level==='MEDIUM'?'cd-w':'cd-n'}">${vol.level[0]}</div><div><div>Volatility: ${vol.level} | ${vol.level==='LOW'?'Price is calm — good for entry':vol.level==='MEDIUM'?'Moderate movement — trade carefully':'Price jumping a lot — reduce risk'}</div></div></div>
    </div>
    <div class="card teal">
        <div class="card-title">💰 Suggested Risk Per Trade</div>
        ${sBar(kellySafe(confLvl==='STRONG'?.65:confLvl==='MODERATE'?.58:.52),'var(--seq-2)','safe risk %')}
        <div style="font-size:9px;color:var(--dark-gray);margin-top:3px">Never risk more than 5% of your account per trade</div>
    </div>`;
}

// ─── 📈 RISE/FALL ───
//  OUTER PRO SIGNAL ENGINE — runs in outer page context
//  Powers all 4 contract panels with 7-run recommendations
function outerProSignal(){
    if(fullHistory.length<100) return null;
    const p1000=dPcts(1000),p200=dPcts(200),p50=dPcts(50);
    const prices=fullHistory.map(t=>t.price);
    const evenD=[0,2,4,6,8],oddD=[1,3,5,7,9];
    const n=fullHistory.length;
    const cd=consecDir(),eoS=consecutiveEOStreak();
    const riseStreak=cd.rise,fallStreak=cd.fall;
    const evenStreak=eoS.even||0,oddStreak=eoS.odd||0;

    function gEdge(dArr){
        const lo=dArr.reduce((a,d)=>a+p1000[d].pct,0);
        const me=dArr.reduce((a,d)=>a+p200[d].pct,0);
        const sh=dArr.reduce((a,d)=>a+p50[d].pct,0);
        const mag=Math.abs(sh-lo),trending=(sh>me&&me>lo)||(sh<me&&me<lo);
        return{long:lo,med:me,short:sh,mag,trending};
    }
    function driftSc(dArr){
        const up=dArr.filter(d=>driftOf(d)>0.5).length;
        const dn=dArr.filter(d=>driftOf(d)<-0.5).length;
        return{up,dn};
    }

    const ee=gEdge(evenD),oe=gEdge(oddD);
    const edE=driftSc(evenD),edO=driftSc(oddD);
    const oSum1k=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum1k=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    const oSum50=[5,6,7,8,9].reduce((a,d)=>a+p50[d].pct,0);
    const uSum50=[0,1,2,3,4].reduce((a,d)=>a+p50[d].pct,0);
    const edOver=driftSc([5,6,7,8,9]),edUnder=driftSc([0,1,2,3,4]);
    const exp=n/10;
    const overdue=p1000.map(s=>({digit:s.digit,deficit:exp-s.count,pct:s.pct}));
    const evenOvr=overdue.filter(d=>evenD.includes(d.digit)&&d.deficit>Math.sqrt(n)*0.8).length;
    const oddOvr =overdue.filter(d=>oddD.includes(d.digit) &&d.deficit>Math.sqrt(n)*0.8).length;
    const over5t9=overdue.filter(d=>d.digit>=5&&d.deficit>Math.sqrt(n)*0.6).length;
    const und0t4 =overdue.filter(d=>d.digit<=4&&d.deficit>Math.sqrt(n)*0.6).length;

    // Stability via variance of last 100 pcts
    const allPcts=p1000.map(s=>s.pct);
    const avgP=allPcts.reduce((a,b)=>a+b,0)/10;
    const variance=allPcts.reduce((a,p)=>a+Math.pow(p-avgP,2),0)/10;
    const stable=variance<1.8;

    const rises50=fullHistory.slice(-50).filter(t=>t.diff>=0).length;
    const rises50p=rises50/50;
    const diffs=fullHistory.slice(-100).map(t=>t.diff);
    const vol=Math.sqrt(diffs.reduce((a,b)=>a+b*b,0)/diffs.length);
    const volP=vol>0.5?0.72:vol>0.2?0.88:1.0;

    const ema20v=ema(prices,20),rsi14v=rsi(prices,14);
    const priceAboveEma=ema20v!==null&&prices[prices.length-1]>ema20v;
    const rsiBull=rsi14v!==null&&rsi14v>55;
    const rsiBear=rsi14v!==null&&rsi14v<45;

    // ── RISE/FALL ──
    const rfDir=riseStreak>=fallStreak?'RISE':'FALL';
    const rfStrk=rfDir==='RISE'?riseStreak:fallStreak;
    let rfScore=0;
    rfScore+=Math.min(34,rfStrk*8);
    if(rfDir==='RISE'&&rises50p>0.55) rfScore+=Math.min(26,(rises50p-0.5)*200);
    if(rfDir==='FALL'&&rises50p<0.45) rfScore+=Math.min(26,(0.5-rises50p)*200);
    if(rfDir==='RISE'&&priceAboveEma) rfScore+=14;
    if(rfDir==='FALL'&&!priceAboveEma) rfScore+=14;
    if(rfDir==='RISE'&&rsiBull) rfScore+=16;
    if(rfDir==='FALL'&&rsiBear) rfScore+=16;
    if(stable) rfScore+=10;
    rfScore=Math.round(Math.min(100,rfScore*volP));
    const rfRuns=rfScore>=90?7:rfScore>=80?6:rfScore>=68?5:rfScore>=54?4:rfScore>=40?3:rfScore>=26?2:rfScore>=15?1:0;

    // ── EVEN/ODD ──
    const ea11=evenD.filter(d=>p1000[d].pct>=10).length;
    const oa11=oddD.filter(d=>p1000[d].pct>=10).length;
    const eoDir=(oa11>ea11||(oe.mag>ee.mag&&oe.short>oe.long))?'ODD':'EVEN';
    const eoStrk=eoDir==='EVEN'?evenStreak:oddStreak;
    const eoEdge=eoDir==='EVEN'?ee:oe;
    const eoD=eoDir==='EVEN'?edE:edO;
    const eoOvr=eoDir==='EVEN'?evenOvr:oddOvr;
    let eoScore=0;
    eoScore+=Math.min(32,eoStrk*11);
    eoScore+=Math.min(28,eoEdge.mag*4.8);
    if(eoEdge.trending) eoScore+=10;
    eoScore+=Math.min(18,eoD.up*7);
    eoScore+=Math.min(12,eoOvr*6);
    if(stable) eoScore+=10;
    eoScore=Math.round(Math.min(100,eoScore));
    const eoRuns=eoScore>=90?7:eoScore>=80?6:eoScore>=68?5:eoScore>=54?4:eoScore>=40?3:eoScore>=26?2:eoScore>=15?1:0;

    // ── OVER/UNDER ──
    const ouDir=oSum1k>uSum1k?'OVER':'UNDER';
    const ouGap=Math.abs(oSum1k-uSum1k);
    const ouGap50=Math.abs(oSum50-uSum50);
    const ouEdD=ouDir==='OVER'?edOver:edUnder;
    const ouOvr=ouDir==='OVER'?over5t9:und0t4;
    let ouScore=0;
    ouScore+=Math.min(34,ouGap*3.5);
    if((ouDir==='OVER'&&oSum50>uSum50)||(ouDir==='UNDER'&&uSum50>oSum50)) ouScore+=Math.min(28,ouGap50*3.5);
    ouScore+=Math.min(20,ouEdD.up*6);
    ouScore+=Math.min(14,ouOvr*5);
    if(stable) ouScore+=10;
    ouScore=Math.round(Math.min(100,ouScore*volP));
    const ouRuns=ouScore>=90?7:ouScore>=80?6:ouScore>=68?5:ouScore>=54?4:ouScore>=40?3:ouScore>=26?2:ouScore>=15?1:0;

    // ── DIFFERS (coldest digit) ──
    const coldest=overdue.slice().sort((a,b)=>b.deficit-a.deficit)[0];
    let diffScore=0;
    diffScore+=Math.min(42,(10-coldest.pct)*4.8);
    diffScore+=Math.min(30,coldest.deficit*0.6);
    if(driftOf(coldest.digit)<-0.5) diffScore+=20;
    if(stable) diffScore+=12;
    diffScore=Math.round(Math.min(100,diffScore));
    const diffRuns=diffScore>=90?7:diffScore>=80?6:diffScore>=68?5:diffScore>=54?4:diffScore>=40?3:diffScore>=26?2:diffScore>=15?1:0;

    // ── MATCHES (hottest digit) ──
    const hottest=p1000.slice().sort((a,b)=>b.pct-a.pct)[0];
    let matchScore=0;
    matchScore+=Math.min(40,(hottest.pct-10)*5.8);
    if(driftOf(hottest.digit)>0.5) matchScore+=28;
    if(stable) matchScore+=12;
    matchScore+=Math.min(20,(hottest.pct-10)*3);
    matchScore=Math.round(Math.min(100,matchScore));
    const matchRuns=matchScore>=90?7:matchScore>=80?6:matchScore>=68?5:matchScore>=54?4:matchScore>=40?3:matchScore>=26?2:matchScore>=15?1:0;

    return{
        rf:{dir:rfDir,score:rfScore,runs:rfRuns,streak:rfStrk,rsi:rsi14v?rsi14v.toFixed(0):'—'},
        eo:{dir:eoDir,score:eoScore,runs:eoRuns,streak:eoStrk},
        ou:{dir:ouDir,score:ouScore,runs:ouRuns,gap:ouGap.toFixed(1)},
        diff:{digit:coldest.digit,score:diffScore,runs:diffRuns,pct:coldest.pct.toFixed(2)},
        mtch:{digit:hottest.digit,score:matchScore,runs:matchRuns,pct:hottest.pct.toFixed(2)},
        stable,vol:vol.toFixed(3),
    };
}

function outerRunMeter(runs,score,col){
    let dots='';
    for(let i=1;i<=7;i++){
        const a=i<=runs;
        const bg=a?(i<=5?col:'#ff6d00'):'rgba(0,0,0,.06)';
        const bc=a?(i<=5?col:'#ff6d00'):'var(--border)';
        const fc=a?'white':'var(--dark-gray)';
        const sz=a?'28px':'22px';
        dots+=`<div style="width:${sz};height:${sz};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;background:${bg};border:2px solid ${bc};color:${fc};transition:all .3s ease;flex-shrink:0;">${i}</div>`;
    }
    const label=runs===0?'WAIT':runs<=2?'WEAK':runs<=4?'MODERATE':runs<=5?'STRONG':runs===6?'VERY STRONG':'MAX POWER 🔥';
    const barCol=score>=80?col:score>=55?'var(--orange)':'var(--border)';
    return`<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin:8px 0;">${dots}</div>
<div style="display:flex;justify-content:space-between;font-size:10px;font-weight:900;margin-bottom:4px;">
<span style="color:${col};">${runs} Run${runs!==1?'s':''} — ${label}</span>
<span style="color:var(--dark-gray);">Score: ${score}/100</span></div>
<div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden;">
<div style="height:100%;width:${score}%;background:${barCol};border-radius:3px;transition:width .5s ease;"></div></div>`;
}

function build_rise_fall(){
    const ps=outerProSignal();
    const prices=fullHistory.map(t=>t.price);
    const ema20v=ema(prices,20),rsi14v=rsi(prices,14),curP=prices[prices.length-1]||0;
    const cd=consecDir();
    const rises50=fullHistory.slice(-50).filter(t=>t.diff>=0).length;
    if(!ps) return`<div class="card"><div class="card-title">⏳ Loading... need 100+ ticks</div></div>`;

    const isR=ps.rf.dir==='RISE';
    const col=isR?'var(--green)':'var(--red)';
    const canEnter=ps.rf.runs>=3;

    const rCh=[
        {pass:cd.rise>=3,yes:`${cd.rise} green candles in a row ✅`,no:`Only ${cd.rise}/3 green candles`,detail:'Need 3 consecutive green candles'},
        {pass:ema20v!==null&&curP>ema20v,yes:`Price above average line`,no:`Price below average line`,detail:`EMA20: ${ema20v?.toFixed(pipSize)??'N/A'}`},
        {pass:rsi14v!==null&&rsi14v>55,yes:`RSI ${rsi14v?.toFixed(0)} — buyers in control`,no:`RSI ${rsi14v?.toFixed(0)} — sellers lead`,detail:'RSI above 55 favours RISE'},
        {pass:rises50>27,yes:`${rises50}/50 recent ticks went UP`,no:`Only ${rises50}/50 recent ticks UP`,detail:'Need 28+ of 50 rising'},
    ];
    const fCh=[
        {pass:cd.fall>=3,yes:`${cd.fall} red candles in a row ✅`,no:`Only ${cd.fall}/3 red candles`,detail:'Need 3 consecutive red candles'},
        {pass:ema20v!==null&&curP<ema20v,yes:`Price below average line`,no:`Price above average line`,detail:`EMA20: ${ema20v?.toFixed(pipSize)??'N/A'}`},
        {pass:rsi14v!==null&&rsi14v<45,yes:`RSI ${rsi14v?.toFixed(0)} — sellers in control`,no:`RSI ${rsi14v?.toFixed(0)}`,detail:'RSI below 45 favours FALL'},
        {pass:rises50<23,yes:`Only ${rises50}/50 ticks UP — falling`,no:`${rises50}/50 ticks UP — not enough selling`,detail:'Need fewer than 23 of 50 rising'},
    ];
    const chs=isR?rCh:fCh;
    const met=chs.filter(c=>c.pass).length;

    return`
    <div class="card ${isR?'green':'red'}">
        <div class="stag ${isR?'green':'red'}">ProSignal Engine</div>
        <div class="card-title">📈 Rise/Fall Signal</div>
        <div class="big-sig">
            <div class="sig-text" style="color:${col}">${ps.rf.dir}</div>
            <span class="sig-badge ${ps.rf.score>=80?'sb-high':ps.rf.score>=55?'sb-med':'sb-low'}">${ps.rf.score>=80?'STRONG':ps.rf.score>=55?'MODERATE':'WEAK'} — ${ps.rf.score}/100</span>
        </div>
        <div style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:var(--dark-gray);margin-bottom:2px;">RUN METER</div>
            ${outerRunMeter(ps.rf.runs,ps.rf.score,isR?'var(--green)':'var(--red)')}
        </div>
    </div>
    <div class="${canEnter?'entry-box':'entry-box wait'}">
        <div class="entry-title">${canEnter?'✅ ENTER '+ps.rf.dir+' NOW — '+ps.rf.runs+' Runs':'⏳ Building Confluence...'}</div>
        <div class="entry-txt">${canEnter?
            `${ps.rf.streak}+ ${ps.rf.dir} candles confirmed. Confluence score: ${ps.rf.score}/100. Run ${ps.rf.runs} trades on the next ${ps.rf.dir} signal.`:
            `Need stronger confluence. Current score: ${ps.rf.score}/100. Wait for ${ps.rf.dir} streak to build.`}</div>
    </div>
    <div class="card">
        <div class="card-title">✅ ${ps.rf.dir} Evidence (${met}/${chs.length} pass)</div>
        ${chs.map(c=>`<div class="cr"><div class="cd ${c.pass?'cd-y':'cd-n'}">${c.pass?'✓':'✗'}</div><div><div>${c.pass?c.yes:c.no}</div><div class="cd-sub">${c.detail}</div></div></div>`).join('')}
        <div class="cr"><div class="cd ${ps.stable?'cd-y':'cd-w'}">${ps.stable?'✓':'~'}</div><div><div>Market stability: ${ps.stable?'✅ Predictable':'⚠ Noisy'}</div><div class="cd-sub">Lower volatility = more reliable signals</div></div></div>
    </div>
    <div class="card">
        <div class="card-title">📊 Live Price Movement</div>
        ${pBarsHTML()}
        ${dualBar(rises50/50*100)}
        ${wormHTML(25)}
    </div>`;
}

// ─── 🔼 OVER/UNDER ───
function build_over_under(){
    const ps=outerProSignal();
    const p1000=dPcts(1000),p50=dPcts(50);
    const bars=barStatus();
    const cur=cursor();
    if(!ps) return`<div class="card"><div class="card-title">⏳ Loading... need 100+ ticks</div></div>`;

    const goOver=ps.ou.dir==='OVER';
    const oSum=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    const sigColor=goOver?'var(--green)':'var(--accent)';
    const canEnter=ps.ou.runs>=3;

    // Find best barrier dynamically
    let bestBarrier=4;
    let bestScore=-1;
    for(let b=0;b<=7;b++){
        const above=[];for(let d=b+1;d<=9;d++)above.push(d);
        const aboveSum=above.reduce((a,d)=>a+p1000[d].pct,0);
        const belowAllWeak=p1000.slice(0,b+1).every(s=>s.pct<=10);
        const sc=(belowAllWeak?4:0)+(aboveSum>50?3:0);
        if(goOver&&sc>bestScore){bestScore=sc;bestBarrier=b;}
        if(!goOver){if(b>=2&&aboveSum<48&&sc>bestScore){bestScore=sc;bestBarrier=b;}}
    }
    const recommended=goOver?`OVER ${bestBarrier}`:`UNDER ${bestBarrier+1}`;

    const checks=[
        {pass:goOver?(oSum>uSum):(uSum>oSum),txt:goOver?`High digits (5-9) total ${oSum.toFixed(1)}% — above low side`:`Low digits (0-4) total ${uSum.toFixed(1)}% — above high side`,detail:'Statistical dominance confirms direction'},
        {pass:ps.ou.score>=40,txt:`Confluence score ${ps.ou.score}/100 — ${ps.ou.score>=60?'strong':'building'}`,detail:'Higher score = more layers agree'},
        {pass:Math.abs(oSum-uSum)>3,txt:`Gap: ${Math.abs(oSum-uSum).toFixed(1)}% — ${Math.abs(oSum-uSum)>5?'strong':'moderate'} edge`,detail:'Bigger gap = better chance of winning'},
        {pass:isStable(bestBarrier),txt:`Barrier digit ${bestBarrier} is ${isStable(bestBarrier)?'stable ✅':'still moving'}`,detail:'Wait for percentage to freeze before entering'},
        {pass:ps.stable,txt:`Market stability: ${ps.stable?'✅ Predictable':'⚠ Noisy'}`,detail:'Stable market = more reliable signals'},
    ];
    const met=checks.filter(c=>c.pass).length;

    return`
    <div class="card ${goOver?'green':'purple'}">
        <div class="stag ${goOver?'green':''}">ProSignal Engine</div>
        <div class="card-title">🔼 Over/Under Signal</div>
        <div class="big-sig">
            <div class="sig-text" style="color:${sigColor}">${recommended}</div>
            <span class="sig-badge ${ps.ou.score>=80?'sb-high':ps.ou.score>=55?'sb-med':'sb-low'}">${ps.ou.score>=80?'STRONG':ps.ou.score>=55?'MODERATE':'WEAK'} — ${ps.ou.score}/100</span>
        </div>
        <div style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:var(--dark-gray);margin-bottom:2px;">RUN METER</div>
            ${outerRunMeter(ps.ou.runs,ps.ou.score,goOver?'var(--green)':'var(--accent)')}
        </div>
    </div>
    <div class="${canEnter?'entry-box':'entry-box wait'}">
        <div class="entry-title">${canEnter?'✅ ENTER '+recommended+' — '+ps.ou.runs+' Runs':'⏳ Building Confluence...'}</div>
        <div class="entry-txt">${canEnter?`Score: ${ps.ou.score}/100. Gap: ${ps.ou.gap}%. Run ${ps.ou.runs} trades on ${recommended}.`:
            `Current score ${ps.ou.score}/100. Need more confluence — gap is ${ps.ou.gap}%. Watch for the gap to widen.`}</div>
    </div>
    <div class="card">
        <div class="card-title">🌡️ Digit Strength Map</div>
        <div class="drow">${p1000.map(s=>{const dr=driftOf(s.digit);const arrow=dr>0.5?'▲':dr<-0.5?'▼':'–';const arrowCol=dr>0.5?'#00ffaa':dr<-0.5?'#ff8080':'#ffffff99';return`<div class="dcell" style="background:${heatColor(s.pct)}"><span class="dn">${s.digit}</span><span class="dp">${s.pct.toFixed(1)}%</span><span class="darr" style="color:${arrowCol}">${arrow}</span></div>`;}).join('')}</div>
    </div>
    <div class="card">
        <div class="card-title">✅ ${recommended} Checklist (${met}/${checks.length} pass)</div>
        ${checks.map(c=>`<div class="cr"><div class="cd ${c.pass?'cd-y':'cd-n'}">${c.pass?'✓':'✗'}</div><div><div>${c.txt}</div><div class="cd-sub">${c.detail}</div></div></div>`).join('')}
    </div>
    <div class="card orange">
        <div class="card-title">📊 Over vs Under Strength</div>
        ${dualBar(oSum/(oSum+uSum)*100)}
        <div class="sr"><span class="sl">Over side (5-9)</span><span class="sv" style="color:var(--green)">${oSum.toFixed(1)}%</span></div>
        <div class="sr"><span class="sl">Under side (0-4)</span><span class="sv" style="color:var(--accent)">${uSum.toFixed(1)}%</span></div>
        <div class="sr"><span class="sl">Gap</span><span class="sv">${Math.abs(oSum-uSum).toFixed(1)}%</span></div>
        <div class="sr"><span class="sl">Cursor</span><span class="sv">Digit ${cur} — ${cur>4?'High zone':'Low zone'}</span></div>
    </div>`;
}

// ─── 🔢 EVEN/ODD ───
function build_even_odd(){
    const ps=outerProSignal();
    const p1000=dPcts(1000),p50=dPcts(50);
    const bars=barStatus();
    const cur=cursor();
    const consEO=consecutiveEOStreak();
    const evenD=[0,2,4,6,8],oddD=[1,3,5,7,9];
    if(!ps) return`<div class="card"><div class="card-title">⏳ Loading... need 100+ ticks</div></div>`;

    const isE=ps.eo.dir==='EVEN';
    const evenSum=evenD.reduce((a,d)=>a+p1000[d].pct,0);
    const oddSum=oddD.reduce((a,d)=>a+p1000[d].pct,0);
    const evenAbove10=evenD.filter(d=>p1000[d].pct>=10).length;
    const oddAbove10=oddD.filter(d=>p1000[d].pct>=10).length;
    const canEnter=ps.eo.runs>=3;
    const eoStreak=isE?(consEO.evenStreak||0):(consEO.oddStreak||0);

    const activeChecks=[
        {pass:isE?(evenAbove10>=3):(oddAbove10>=3),txt:`${isE?evenAbove10:oddAbove10}/5 ${isE?'even':'odd'} digits at 10%+`,detail:`Need 3+ digits above 10% on ${isE?'even':'odd'} side`},
        {pass:isE?(evenSum>oddSum+2):(oddSum>evenSum+2),txt:`${isE?'Even':'Odd'} total ${(isE?evenSum:oddSum).toFixed(1)}% — ${(isE?(evenSum-oddSum):(oddSum-evenSum)).toFixed(1)}% ahead`,detail:'Statistical dominance of your side'},
        {pass:eoStreak>=3,txt:`${eoStreak} ${isE?'even':'odd'} digits in a row — ${eoStreak>=3?'✅ ready!':'need 3'}`,detail:'3 consecutive same-parity digits = entry signal'},
        {pass:ps.eo.score>=40,txt:`Confluence score ${ps.eo.score}/100`,detail:'ProSignal multi-layer confirmation'},
        {pass:ps.stable,txt:`Market: ${ps.stable?'✅ Stable':'⚠ Noisy'}`,detail:'Stable market = more reliable parity signals'},
    ];
    const met=activeChecks.filter(c=>c.pass).length;

    return`
    <div class="card ${isE?'green':'orange'}">
        <div class="stag ${isE?'green':'orange'}">ProSignal Engine</div>
        <div class="card-title">🔢 Even/Odd Signal</div>
        <div class="big-sig">
            <div class="sig-text" style="color:${isE?'var(--green)':'var(--orange)'}">${ps.eo.dir}</div>
            <span class="sig-badge ${ps.eo.score>=80?'sb-high':ps.eo.score>=55?'sb-med':'sb-low'}">${ps.eo.score>=80?'STRONG':ps.eo.score>=55?'MODERATE':'WEAK'} — ${ps.eo.score}/100</span>
        </div>
        <div style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:var(--dark-gray);margin-bottom:2px;">RUN METER</div>
            ${outerRunMeter(ps.eo.runs,ps.eo.score,isE?'var(--green)':'var(--orange)')}
        </div>
    </div>
    <div class="${canEnter?'entry-box':'entry-box wait'}">
        <div class="entry-title">${canEnter?'✅ ENTER '+ps.eo.dir+' — '+ps.eo.runs+' Runs':'⏳ Building Confluence...'}</div>
        <div class="entry-txt">${canEnter?`${eoStreak} ${isE?'even':'odd'} digits in a row. Score: ${ps.eo.score}/100. Run ${ps.eo.runs} ${ps.eo.dir} trades.`:`Streak: ${eoStreak}/3. Score: ${ps.eo.score}/100. Wait for stronger alignment.`}</div>
    </div>
    <div class="card">
        <div class="card-title">📊 Even vs Odd Live Strength</div>
        ${dualBar(evenSum/(evenSum+oddSum)*100)}
        <div style="margin:6px 0">
            <div style="font-size:9px;font-weight:900;color:var(--green);margin-bottom:3px">EVEN (0,2,4,6,8)</div>
            <div class="mgrid">${evenD.map(d=>{const p=p1000[d].pct;const dr=driftOf(d);const cl=p>=10?'hot':p>=9?'warm':'cold';return`<div class="mc ${cl}"><span class="mn">${d}</span><span class="mp">${p.toFixed(1)}%</span><span class="ms">${dr>0.3?'▲':dr<-0.3?'▼':'–'}</span></div>`;}).join('')}</div>
            <div style="font-size:9px;font-weight:900;color:var(--orange);margin:7px 0 3px">ODD (1,3,5,7,9)</div>
            <div class="mgrid">${oddD.map(d=>{const p=p1000[d].pct;const dr=driftOf(d);const cl=p>=10?'hot':p>=9?'warm':'cold';return`<div class="mc ${cl}"><span class="mn">${d}</span><span class="mp">${p.toFixed(1)}%</span><span class="ms">${dr>0.3?'▲':dr<-0.3?'▼':'–'}</span></div>`;}).join('')}</div>
        </div>
    </div>
    <div class="card">
        <div class="card-title">✅ ${ps.eo.dir} Checklist (${met}/${activeChecks.length})</div>
        ${activeChecks.map(c=>`<div class="cr"><div class="cd ${c.pass?'cd-y':'cd-n'}">${c.pass?'✓':'✗'}</div><div><div>${c.txt}</div><div class="cd-sub">${c.detail}</div></div></div>`).join('')}
    </div>`;
}

function build_differs(){
    const ps=outerProSignal();
    const p1000=dPcts(1000),p50=dPcts(50);
    const bars=barStatus();
    const cur=cursor();
    if(!ps) return`<div class="card"><div class="card-title">⏳ Loading... need 100+ ticks</div></div>`;

    const pctIncreasing=p50[cur].pct>p1000[cur].pct+0.4;
    const last30=fullHistory.slice(-30);
    const cursorCounts=Array(10).fill(0);last30.forEach(t=>cursorCounts[t.digit]++);
    const mostActive=cursorCounts.indexOf(Math.max(...cursorCounts));

    const diffChecks=[
        {pass:ps.diff.pct<9,txt:`Digit ${ps.diff.digit} at ${ps.diff.pct}% — well below 10%`,detail:'Lower % = less likely to appear = safer DIFFERS'},
        {pass:driftOf(ps.diff.digit)<0,txt:`Digit ${ps.diff.digit} is trending DOWN (drift: ${driftOf(ps.diff.digit).toFixed(2)})`,detail:'Falling drift = digit becoming rarer'},
        {pass:isStable(ps.diff.digit),txt:`Digit ${ps.diff.digit} percentage is stable`,detail:'Stable = not about to spike — safe entry'},
        {pass:bars[ps.diff.digit]==='normal',txt:`No active bar on Digit ${ps.diff.digit}`,detail:'Bars indicate hot/cold digits — avoid those'},
        {pass:ps.stable,txt:`Market: ${ps.stable?'✅ Predictable':'⚠ Noisy'}`,detail:'Stable market = digit patterns reliable'},
    ];
    const matchChecks=[
        {pass:ps.mtch.pct>11,txt:`Digit ${ps.mtch.digit} at ${ps.mtch.pct}% — above 10% baseline`,detail:'Higher % = more likely to appear next'},
        {pass:driftOf(ps.mtch.digit)>0,txt:`Digit ${ps.mtch.digit} trending UP (drift: ${driftOf(ps.mtch.digit).toFixed(2)})`,detail:'Rising drift = digit heating up'},
        {pass:isStable(ps.mtch.digit),txt:`Digit ${ps.mtch.digit} percentage is stable`,detail:'Stable = consistently appearing'},
        {pass:ps.stable,txt:`Market: ${ps.stable?'✅ Predictable':'⚠ Noisy'}`,detail:'Stable market = hot digits keep firing'},
    ];
    const dMet=diffChecks.filter(c=>c.pass).length;
    const mMet=matchChecks.filter(c=>c.pass).length;

    return`
    <div class="card ${ps.diff.score>=60?'green':'orange'}">
        <div class="stag">ProSignal Engine</div>
        <div class="card-title">🎯 Differs — Digit ${ps.diff.digit} (${ps.diff.pct}%)</div>
        <div class="big-sig">
            <div class="sig-text" style="color:var(--green)">DIFFERS ${ps.diff.digit}</div>
            <span class="sig-badge ${ps.diff.score>=80?'sb-high':ps.diff.score>=55?'sb-med':'sb-low'}">${ps.diff.score>=80?'STRONG':ps.diff.score>=55?'MODERATE':'WEAK'} — ${ps.diff.score}/100</span>
        </div>
        <div style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:var(--dark-gray);margin-bottom:2px;">RUN METER — DIFFERS</div>
            ${outerRunMeter(ps.diff.runs,ps.diff.score,'var(--green)')}
        </div>
    </div>
    <div class="${ps.diff.runs>=3?'entry-box':'entry-box wait'}">
        <div class="entry-title">${ps.diff.runs>=3?'✅ ENTER DIFFERS '+ps.diff.digit+' — '+ps.diff.runs+' Runs':'⏳ Building Confluence...'}</div>
        <div class="entry-txt">Digit ${ps.diff.digit} at ${ps.diff.pct}% — coldest digit in last 1000 ticks. ${ps.diff.runs>=3?`Run ${ps.diff.runs} DIFFERS trades on digit ${ps.diff.digit}.`:'Wait for score to rise above 54 before trading.'}</div>
    </div>
    <div class="card ${ps.mtch.score>=60?'orange':''}">
        <div class="card-title">🎰 Matches — Digit ${ps.mtch.digit} (${ps.mtch.pct}%)</div>
        <div class="big-sig">
            <div class="sig-text" style="color:var(--orange);font-size:2rem;">MATCHES ${ps.mtch.digit}</div>
            <span class="sig-badge ${ps.mtch.score>=80?'sb-high':ps.mtch.score>=55?'sb-med':'sb-low'}">${ps.mtch.score>=80?'STRONG':ps.mtch.score>=55?'MODERATE':'WEAK'} — ${ps.mtch.score}/100</span>
        </div>
        <div style="margin-top:6px;padding-top:10px;border-top:1px solid var(--border);">
            <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:var(--dark-gray);margin-bottom:2px;">RUN METER — MATCHES</div>
            ${outerRunMeter(ps.mtch.runs,ps.mtch.score,'var(--orange)')}
        </div>
    </div>
    <div class="card">
        <div class="card-title">🌡️ All Digits Status</div>
        <div class="drow">${p1000.map(s=>{const stable=isStable(s.digit);const noBar=bars[s.digit]==='normal';const dr=driftOf(s.digit);let bg=stable&&noBar&&s.pct<9?'#00c853':stable&&noBar?'#3f51b5':!noBar?'#e53935':'#ff9100';return`<div class="dcell" style="background:${bg}"><span class="dn">${s.digit}</span><span class="dp">${s.pct.toFixed(1)}%</span><span class="darr" style="color:#fff">${stable?'🔒':dr>0.3?'▲':dr<-0.3?'▼':'='}</span></div>`;}).join('')}</div>
    </div>
    <div class="card">
        <div class="card-title">✅ DIFFERS Checklist (${dMet}/${diffChecks.length})</div>
        ${diffChecks.map(c=>`<div class="cr"><div class="cd ${c.pass?'cd-y':'cd-n'}">${c.pass?'✓':'✗'}</div><div><div>${c.txt}</div><div class="cd-sub">${c.detail}</div></div></div>`).join('')}
    </div>
    <div class="card">
        <div class="card-title">✅ MATCHES Checklist (${mMet}/${matchChecks.length})</div>
        ${matchChecks.map(c=>`<div class="cr"><div class="cd ${c.pass?'cd-y':'cd-n'}">${c.pass?'✓':'✗'}</div><div><div>${c.txt}</div><div class="cd-sub">${c.detail}</div></div></div>`).join('')}
    </div>`;
}

// ─── 🛡️ RISK ───
function build_risk(){
    const p1000=dPcts(1000);const prices=fullHistory.map(t=>t.price);
    const vol=calcVol();const rsi14=rsi(prices,14);const streak=curStreak();const n=fullHistory.length;
    let score=0;const warnings=[];
    if(vol.std>0.5){score+=30;warnings.push({txt:'Price jumping a lot — reduce your risk amount',sev:'high'});}
    else if(vol.std>0.2){score+=15;warnings.push({txt:'Price has moderate movement — trade carefully',sev:'med'});}
    if(streak.len>=6){score+=30;warnings.push({txt:`${streak.type} has run ${streak.len} times in a row — a change is very likely`,sev:'high'});}
    else if(streak.len>=3){score+=12;warnings.push({txt:`Streak of ${streak.len} active — be cautious`,sev:'med'});}
    if(rsi14!==null&&(rsi14>80||rsi14<20)){score+=25;warnings.push({txt:`Strength meter at extreme (${rsi14.toFixed(0)}/100) — ${rsi14>80?'overbought':'oversold'}`,sev:'high'});}
    else if(rsi14!==null&&(rsi14>70||rsi14<30)){score+=12;warnings.push({txt:`Strength meter near extreme (${rsi14.toFixed(0)}/100)`,sev:'med'});}
    if(n<100){score+=15;warnings.push({txt:'Not enough ticks yet — analysis less reliable',sev:'med'});}
    if(warnings.length===0)warnings.push({txt:'No major risk factors — conditions look calm',sev:'low'});
    score=Math.min(score,95);
    const level=score>=70?'HIGH':score>=40?'MEDIUM':'LOW';
    const safe=score<55;
    const rc=level==='LOW'?'var(--green)':level==='MEDIUM'?'var(--orange)':'var(--red)';
    const winP=safe?.63:.53;const kelly=kellySafe(winP);

    return`
    <div class="card ${level==='LOW'?'green':level==='MEDIUM'?'orange':'red'}">
        <div class="stag">By CEOskit — Risk Guide</div>
        <div class="card-title">🛡️ Current Risk Level</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:5px">
            <div style="text-align:center;background:var(--card-bg);border:2px solid ${rc};border-radius:10px;padding:8px 14px;flex-shrink:0">
                <div style="font-size:1.8rem;font-weight:900;color:${rc};line-height:1">${score}</div>
                <div style="font-size:8px;font-weight:900;color:var(--dark-gray)">${level} RISK</div>
            </div>
            <div style="flex:1"><div style="font-size:9px;margin-bottom:2px;font-weight:700;color:var(--dark-gray)">Risk meter (0 = safe, 100 = danger)</div>${sBar(score,rc)}<span class="pill ${safe?'pg':'pr'}" style="margin-top:5px">${safe?'✓ OK to trade':'⚠ Trade with extra care'}</span></div>
        </div>
    </div>
    <div class="card">
        <div class="card-title">📊 Live Price Movement</div>
        ${pBarsHTML()}
        <div class="sr"><span class="sl">Price jumping level</span><span class="sv" style="color:${rc}">${vol.level}</span></div>
        <div class="sr"><span class="sl">Avg tick movement</span><span class="sv">${vol.atr.toFixed(5)}</span></div>
        <div class="sr"><span class="sl">Strength meter (RSI)</span><span class="sv" style="color:${rsi14>70?'var(--red)':rsi14<30?'var(--green)':'var(--text-main)'}">${rsi14?.toFixed(1)??'N/A'} / 100</span></div>
        <div class="sr"><span class="sl">Active streak</span><span class="sv">${streak.type} × ${streak.len}</span></div>
    </div>
    <div class="card orange">
        <div class="card-title">⚠ Risk Factors Right Now</div>
        ${warnings.map(w=>`<div class="cr"><div class="cd ${w.sev==='high'?'cd-n':w.sev==='med'?'cd-w':'cd-y'}">${w.sev==='high'?'!':w.sev==='med'?'~':'✓'}</div><div>${w.txt}</div></div>`).join('')}
    </div>
    <div class="card teal">
        <div class="card-title">💰 How Much to Risk Per Trade</div>
        <div style="font-size:9px;color:var(--dark-gray);margin-bottom:5px">Calculated from your signal strength and current risk level</div>
        ${sBar(kelly,'var(--seq-2)','recommended risk %')}
        <div style="font-size:13px;font-weight:900;color:var(--seq-2);margin-top:5px">Risk only <strong>${kelly.toFixed(1)}%</strong> of your account per trade</div>
        <div style="font-size:9px;color:var(--dark-gray);margin-top:3px">Safer option: <strong>${(kelly/2).toFixed(1)}%</strong> | Max loss per session: <strong>${(kelly*2).toFixed(1)}%</strong></div>
    </div>
    <div class="card red">
        <div class="card-title">📋 CEOskit Safety Rules (Always Follow)</div>
        <div class="cr"><div class="cd cd-n">1</div><div>NEVER risk more than 5% of your account per trade</div></div>
        <div class="cr"><div class="cd cd-n">2</div><div>Stop after 3 losses in a row — take a break, don't chase</div></div>
        <div class="cr"><div class="cd cd-n">3</div><div>Watch at least 4-5 patterns before entering real trades</div></div>
        <div class="cr"><div class="cd cd-w">!</div><div>Beginners: Start with UNDER 9 or 8 — these are safest</div></div>
        <div class="cr"><div class="cd cd-y">✓</div><div>Practice on demo for at least 1 week before real money</div></div>
        <div class="cr"><div class="cd cd-y">✓</div><div>Set a daily profit target and stop when you reach it</div></div>
    </div>`;
}

// ─── 📋 FULL REPORT ───
// ── WS data callbacks — called when socket receives portfolio/profit/statement ──
function onPortfolioUpdate(contracts){
    // Store for report building
    window._derivPortfolio = contracts;
    // Refresh tools report if open
    if(document.getElementById('tools-overlay') &&
       document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onProfitTableUpdate(pt){
    window._derivProfitTable = pt;
    if(document.getElementById('tools-overlay') &&
       document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onStatementUpdate(st){
    window._derivStatement = st;
    if(document.getElementById('tools-overlay') &&
       document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onTransactionUpdate(tx){
    // Flash the balance display on any buy/sell
    const balEl = document.getElementById('acct-balance-val');
    if(balEl){ balEl.style.transition='color .3s'; balEl.style.color=tx.action==='buy'?'var(--red)':'var(--green)';
        setTimeout(()=>{ balEl.style.color=''; },800); }
}

function build_report(){
    const p1000=dPcts(1000),p50=dPcts(50);
    const prices=fullHistory.map(t=>t.price);
    const ema20=ema(prices,20),rsi14=rsi(prices,14),curP=prices[prices.length-1]||0;
    const vol=calcVol(),streak=curStreak(),cur=cursor();
    const consDir=consecDir(),consEO=consecutiveEOStreak();
    const rises50=fullHistory.slice(-50).filter(t=>t.diff>=0).length;
    const sorted=[...p1000].sort((a,b)=>b.pct-a.pct);
    const bars=barStatus();
    const evenD=[0,2,4,6,8],oddD=[1,3,5,7,9];
    const evenAbove10=evenD.filter(d=>p1000[d].pct>=10).length;
    const oddAbove10=oddD.filter(d=>p1000[d].pct>=10).length;
    const oSum=[5,6,7,8,9].reduce((a,d)=>a+p1000[d].pct,0);
    const uSum=[0,1,2,3,4].reduce((a,d)=>a+p1000[d].pct,0);
    const chaos=chaosScore();
    const kelly=kellySafe(0.60);
    const n=fullHistory.length;

    const rfSig=consDir.rise>=3?'RISE':consDir.fall>=3?'FALL':rises50>27?'RISE':'FALL';
    const eoSig=evenAbove10>=3&&!oddD.some(d=>p1000[d].pct>=9.7)?'EVEN':oddAbove10>=3&&!evenD.some(d=>p1000[d].pct>=9.7)?'ODD':'NEUTRAL';
    const ouSig=oSum>uSum?'OVER':'UNDER';
    const diffTarget=p1000.filter(s=>s.pct<9&&bars[s.digit]==='normal').sort((a,b)=>a.pct-b.pct)[0];
    const predictable=chaos<0.93;

    return`
    <div class="card green">
        <div class="stag gold">By CEOskit — Full Briefing</div>
        <div class="card-title">📋 Market Snapshot — All Strategies</div>
        <div class="twocol">
            <div class="tcell"><div class="tv" style="font-size:1rem;color:${rfSig==='RISE'?'var(--green)':'var(--red)'}">${rfSig}</div><div class="tl">Rise/Fall</div></div>
            <div class="tcell"><div class="tv" style="font-size:1rem">${eoSig}</div><div class="tl">Even/Odd</div></div>
            <div class="tcell"><div class="tv" style="font-size:1rem">${ouSig}</div><div class="tl">Over/Under</div></div>
            <div class="tcell"><div class="tv" style="font-size:1rem;color:${vol.level==='LOW'?'var(--green)':vol.level==='MEDIUM'?'var(--orange)':'var(--red)'}">${vol.level}</div><div class="tl">Volatility</div></div>
        </div>
    </div>
    <div class="card">
        <div class="card-title">📊 Live Price Direction</div>
        ${pBarsHTML()}
        ${dualBar(rises50/50*100)}
        ${wormHTML(20)}
    </div>
    <div class="card">
        <div class="card-title">⚡ What's Active Right Now</div>
        <div class="sr"><span class="sl">3-Candle setup</span><span class="sv"><span class="pill ${consDir.rise>=3||consDir.fall>=3?'pg':'pr'}">${consDir.rise>=3?`${consDir.rise} RISE ready`:consDir.fall>=3?`${consDir.fall} FALL ready`:'Not ready yet'}</span></span></div>
        <div class="sr"><span class="sl">Even/Odd (3-in-a-row)</span><span class="sv"><span class="pill ${consEO.evenStreak>=3?'pg':consEO.oddStreak>=3?'po':'pa'}">${consEO.evenStreak>=3?`EVEN ×${consEO.evenStreak}`:consEO.oddStreak>=3?`ODD ×${consEO.oddStreak}`:'Waiting'}</span></span></div>
        <div class="sr"><span class="sl">Cursor position</span><span class="sv">Digit ${cur} (${p1000[cur].pct.toFixed(2)}%) — ${isStable(cur)?'FROZEN 🔒':'moving'}</span></div>
        <div class="sr"><span class="sl">Hottest digit</span><span class="sv" style="color:var(--green);font-weight:900">${sorted[0].digit} (${sorted[0].pct.toFixed(1)}%)</span></div>
        <div class="sr"><span class="sl">Best DIFFERS pick</span><span class="sv" style="color:var(--accent);font-weight:900">${diffTarget?`Digit ${diffTarget.digit} (${diffTarget.pct.toFixed(2)}%)`:'No clean target yet'}</span></div>
        <div class="sr"><span class="sl">Streak</span><span class="sv"><span class="pill ${streak.len>=5?'pr':streak.len>=3?'po':'pg'}">${streak.type} ×${streak.len}</span></span></div>
        <div class="sr"><span class="sl">Market predictability</span><span class="sv">${predictable?'HIGH — patterns visible':'LOW — close to random'}</span></div>
    </div>
    <div class="card orange">
        <div class="card-title">🎯 Best Trade Setup Right Now</div>
        <div class="cr"><div class="cd cd-y">1</div><div><div><strong>${consDir.rise>=3||consDir.fall>=3?`3-Candle ${rfSig} — enter on next tick`:eoSig!=='NEUTRAL'&&(consEO.evenStreak>=3||consEO.oddStreak>=3)?`Even/Odd ${eoSig} — 3 in a row`:diffTarget?`Differs on Digit ${diffTarget.digit} — ${diffTarget.pct.toFixed(2)}%`:`Watch for setup — no clear trigger yet`}</strong></div><div class="cd-sub">Tap the specific icon above for full entry checklist</div></div></div>
    </div>
    <div class="card teal">
        <div class="card-title">💰 Safe Risk Per Trade</div>
        ${sBar(kelly,'var(--seq-2)','recommended risk size')}
        <div style="font-size:12px;font-weight:900;color:var(--seq-2)">Risk <strong>${kelly.toFixed(1)}%</strong> of your account | RSI: ${rsi14?.toFixed(1)??'N/A'} | Ticks: ${n}</div>
    </div>
    <div class="card red">
        <div class="card-title">⛔ Avoid Right Now</div>
        <div style="font-size:10px;line-height:1.7">${streak.len>=5?`${streak.type} streak at ${streak.len} — wait for a break before entering`:vol.level==='HIGH'?'Price is very jumpy — wait for it to calm down before risking real money':!predictable?'Market is very random — no strong patterns visible yet. Wait for better setup.':'No major red flags. Follow your strategy rules and be patient.'}</div>
    </div>
    <div class="card purple">
        <div class="card-title">📈 Beginner Path (CEOskit Week-by-Week)</div>
        <div class="cr"><div class="cd cd-i">W1</div><div>Practice UNDER 9 only — safest for beginners</div></div>
        <div class="cr"><div class="cd cd-i">W2</div><div>Add UNDER 8 strategy</div></div>
        <div class="cr"><div class="cd cd-i">W3</div><div>Try 3-Candle Rise/Fall on demo</div></div>
        <div class="cr"><div class="cd cd-i">W4</div><div>Add Even/Odd strategy</div></div>
        <div class="cr"><div class="cd cd-i">M2+</div><div>Advanced: OVER/UNDER levels + Differs</div></div>
    </div>`;
}

// --- Panel Control ---
let activePanel=null;
const CFG={
    signal:   {icon:'⚡',title:'BEST SIGNAL RIGHT NOW',sub:'By CEOskit — What the market says'},
    rise_fall:{icon:'📈',title:'RISE / FALL (3-CANDLE)',sub:'By CEOskit — 3-Candle Momentum Strategy'},
    over_under:{icon:'🔼',title:'OVER / UNDER',sub:'By CEOskit — Super Safe Entry System'},
    even_odd: {icon:'🔢',title:'EVEN / ODD',sub:'By CEOskit — Sept 2025 Strategy'},
    differs:  {icon:'🎯',title:'DIFFERS',sub:'By CEOskit — Differs Strategy 2026'},
    risk:     {icon:'🛡️',title:'RISK & SAFE SIZING',sub:'By CEOskit — Stay Protected'},
    report:   {icon:'📋',title:'FULL TRADING REPORT',sub:'By CEOskit — Everything at a Glance'}
};

// ── CHROME MEASUREMENT — keeps every panel below the visible toolbar ──────
// Called once per open so the panel always starts exactly at the toolbar
// bottom regardless of font-scaling, safe-area-insets, or viewport size.
function measureChrome(){
    const chrome = document.getElementById('top-chrome');
    if(!chrome) return 0;
    return chrome.getBoundingClientRect().bottom;
}
function applyModalTop(modalId){
    const h = measureChrome();
    const el = document.getElementById(modalId);
    if(!el) return;
    el.style.top = h + 'px';
    // Shrink the sheet max-height so it never exceeds remaining space
    const sheet = el.querySelector('.ai-sheet, .sa-sheet, .rc-sheet, .engine-overlay');
    if(sheet) sheet.style.maxHeight = 'calc(100dvh - ' + h + 'px)';
}

function closeAll(){
    // Close every panel/overlay so only one is ever open at a time
    // Chart modal
    var cm = document.getElementById('chartModal');
    if(cm && cm.style.display === 'flex'){ closeChartModal && closeChartModal(); }
    // AI panel
    var am = document.getElementById('ai-modal');
    if(am && am.classList.contains('open')){ am.classList.remove('open'); activePanel=null; }
    // Smart Analysis
    var so = document.getElementById('smart-overlay');
    if(so && so.classList.contains('open')){ closeSmartAnalysis && closeSmartAnalysis(); }
    // Signal Engine
    var eo = document.getElementById('engine-overlay');
    if(eo && eo.style.display !== 'none'){ closeEngine && closeEngine(); }
    // Contracts dropdown
    if(typeof _cdd !== 'undefined' && _cdd.classList.contains('open')){
        _cdd.classList.remove('open');
        if(typeof _cbtn !== 'undefined') _cbtn.classList.remove('contracts-active');
    }
    // Tools overlay
    var to = document.getElementById('tools-overlay');
    if(to && to.classList.contains('open')){ closeTools && closeTools(); }
    // Remove all active-tool highlights
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active-tool'));
}
function openPanel(type){
    if(fullHistory.length<30){alert(`Loading data: ${fullHistory.length}/30 ticks. Please wait a moment.`);return;}
    activePanel=type;
    const cfg=CFG[type];
    document.getElementById('ai-icon-badge').textContent=cfg.icon;
    document.getElementById('ai-title').textContent=cfg.title;
    document.getElementById('ai-sub').textContent=cfg.sub;
    document.getElementById('ai-ticks').textContent=`${fullHistory.length} ticks`;
    applyModalTop('ai-modal');
    document.getElementById('ai-modal').classList.add('open');
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active-tool'));
    const btn=document.getElementById('btn-'+type);if(btn)btn.classList.add('active-tool');
    renderPanel();
}

function renderPanel(){
    if(!activePanel)return;
    let html='';
    try{
        if(activePanel==='signal')    html=build_signal();
        else if(activePanel==='rise_fall') html=build_rise_fall();
        else if(activePanel==='over_under')html=build_over_under();
        else if(activePanel==='even_odd')  html=build_even_odd();
        else if(activePanel==='differs')   html=build_differs();
        else if(activePanel==='risk')      html=build_risk();
        else if(activePanel==='report')    html=build_report();
    }catch(e){html=`<div class="card red"><div class="card-title">Error</div><div>${e.message}</div></div>`;}
    document.getElementById('ai-body').innerHTML=html;
}

function liveRefresh(){
    const body=document.getElementById('ai-body');
    if(!body)return;
    const st=body.scrollTop;
    document.getElementById('ai-ticks').textContent=`${fullHistory.length} ticks`;
    renderPanel();
    body.scrollTop=st;
    const fc=body.querySelector('.card');
    if(fc){fc.classList.remove('updated');void fc.offsetWidth;fc.classList.add('updated');}
}

function closeAI(){
    document.getElementById('ai-modal').classList.remove('open');
    activePanel=null;
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active-tool'));
}
document.getElementById('ai-modal').onclick=(e)=>{if(e.target===document.getElementById('ai-modal'))closeAI();};
document.querySelector('.ai-sheet').addEventListener('click',function(e){e.stopPropagation();});

// --- Contracts Dropdown ---
const _cdd=document.getElementById('contracts-dropdown');
const _cbtn=document.getElementById('btn-contracts');

function toggleContracts(e){
    e.stopPropagation();
    const isOpen=_cdd.classList.contains('open');
    if(isOpen){ _cdd.classList.remove('open'); _cbtn.classList.remove('contracts-active'); return; }
    // Position the dropdown below the button using fixed coords
    const r=_cbtn.getBoundingClientRect();
    _cdd.style.top=(r.bottom+6)+'px';
    _cdd.style.left=Math.min(r.left,window.innerWidth-256)+'px';
    closeAll();
    _cdd.classList.add('open');
    _cbtn.classList.add('contracts-active');
}
function pickContract(type,e){
    if(e) e.stopPropagation();
    _cdd.classList.remove('open');
    document.querySelectorAll('.cd-item').forEach(el=>el.classList.remove('csel'));
    const item=document.getElementById('btn-'+type);
    if(item) item.classList.add('csel');
    const labels={rise_fall:'📈 Rise/Fall ▾',even_odd:'🔢 Even/Odd ▾',over_under:'🔼 Over/Under ▾',differs:'🎯 Differs ▾'};
    _cbtn.textContent=labels[type]||'🎲 Contracts ▾';
    openPanel(type);
}
// Close dropdown on outside click
document.addEventListener('click',function(e){
    if(!_cdd.contains(e.target)&&e.target!==_cbtn){
        _cdd.classList.remove('open');
        if(!activePanel||!['rise_fall','even_odd','over_under','differs'].includes(activePanel)){
            _cbtn.classList.remove('contracts-active');
            _cbtn.textContent='🎲 Contracts ▾';
        }
    }
},true);

// --- Risk Calculator ---
function openRiskCalc(){
    applyModalTop('risk-calc-overlay');
    document.getElementById('risk-calc-overlay').classList.add('open');
    document.getElementById('btn-risk-calc').classList.add('active-tool');
    calcRisk();
}
function closeRiskCalc(){
    document.getElementById('risk-calc-overlay').classList.remove('open');
    document.getElementById('btn-risk-calc').classList.remove('active-tool');
}

function calcRisk(){
    const balance = parseFloat(document.getElementById('rc-balance').value)||100;
    const stake   = parseFloat(document.getElementById('rc-stake').value)||1;
    const stopN   = parseInt(document.getElementById('rc-stop').value)||3;
    const mult    = parseFloat(document.getElementById('rc-mult').value)/10;

    // Sync slider display values
    document.getElementById('rc-stop-disp').textContent = stopN;
    document.getElementById('rc-mult-disp').textContent = mult.toFixed(1)+'×';

    // Per-trade risk %
    const riskPct = (stake / balance) * 100;

    // Total max exposure after stop-loss streak (martingale ladder sum)
    let totalExposure = 0, s = stake;
    const ladder = [];
    for(let i=0;i<stopN;i++){ ladder.push(s); totalExposure += s; s = +(s*mult).toFixed(2); }
    const exposurePct = (totalExposure / balance) * 100;

    // Kelly-safe recommended stake (assuming ~58% win rate baseline)
    const winP = 0.58, q = 1-winP, b = 0.95;
    const kellySafe = Math.max(0, Math.min((b*winP-q)/b, 0.05)) * balance;

    // Safety assessment
    const isSafe   = riskPct <= 2 && exposurePct <= 15;
    const isWarn   = !isSafe && (riskPct <= 5 && exposurePct <= 30);
    const isDanger = !isSafe && !isWarn;
    const cls      = isSafe ? 'safe' : isWarn ? 'warn' : 'danger';
    const clsColor = isSafe ? 'var(--green)' : isWarn ? 'var(--orange)' : 'var(--red)';

    // Result cards
    document.getElementById('rc-result-grid').innerHTML = `
        <div class="rc-result-card ${riskPct<=2?'safe':riskPct<=5?'warn':'danger'}">
            <div class="rc-result-val" style="color:${riskPct<=2?'var(--green)':riskPct<=5?'var(--orange)':'var(--red)'}">${riskPct.toFixed(2)}%</div>
            <div class="rc-result-lbl">Risk Per Trade</div>
        </div>
        <div class="rc-result-card ${exposurePct<=15?'safe':exposurePct<=30?'warn':'danger'}">
            <div class="rc-result-val" style="color:${exposurePct<=15?'var(--green)':exposurePct<=30?'var(--orange)':'var(--red)'}">${exposurePct.toFixed(1)}%</div>
            <div class="rc-result-lbl">Max Streak Loss</div>
        </div>
        <div class="rc-result-card accent">
            <div class="rc-result-val" style="color:var(--accent)">$${kellySafe.toFixed(2)}</div>
            <div class="rc-result-lbl">Kelly Safe Stake</div>
        </div>
        <div class="rc-result-card ${totalExposure<=balance?'safe':'danger'}">
            <div class="rc-result-val" style="color:${totalExposure<=balance?'var(--green)':'var(--red)'}">$${totalExposure.toFixed(2)}</div>
            <div class="rc-result-lbl">Total Exposure</div>
        </div>
    `;

    // Bar
    const barPct = Math.min(exposurePct, 100);
    document.getElementById('rc-bar-section').innerHTML = `
        <div style="font-size:9px;font-weight:900;color:var(--dark-gray);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Account at Risk</div>
        <div class="rc-bar-wrap"><div class="rc-bar-fill" style="width:${barPct}%;background:${clsColor}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;color:var(--dark-gray);margin-top:2px;"><span>Safe 0%</span><span>Danger 30%+</span></div>
    `;

    // Verdict
    const verdictMsg = isSafe
        ? `✅ <strong>Safe setup.</strong> Your stake of $${stake} is ${riskPct.toFixed(2)}% of your balance — within safe limits. Even a ${stopN}-loss streak only exposes ${exposurePct.toFixed(1)}% of your account.`
        : isWarn
        ? `⚠️ <strong>Caution.</strong> A ${stopN}-loss streak at ${mult.toFixed(1)}× would cost $${totalExposure.toFixed(2)} (${exposurePct.toFixed(1)}% of balance). Consider reducing your stake or multiplier.`
        : `🚨 <strong>Danger zone.</strong> This setup could wipe ${exposurePct.toFixed(1)}% of your account in one bad streak. Reduce stake to $${kellySafe.toFixed(2)} or lower your multiplier immediately.`;

    document.getElementById('rc-verdict').innerHTML = `<div class="rc-verdict ${cls}">${verdictMsg}</div>`;

    // Loss ladder
    let ladderHTML = `<div style="display:flex;flex-direction:column;gap:6px;">`;
    let running = 0;
    ladder.forEach((sv,i)=>{
        running += sv;
        const lp = (running/balance*100).toFixed(1);
        const lc = parseFloat(lp)<=10?'var(--green)':parseFloat(lp)<=25?'var(--orange)':'var(--red)';
        ladderHTML += `
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:28px;height:28px;border-radius:50%;background:${lc};color:white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0;">L${i+1}</div>
                <div style="flex:1">
                    <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.min(parseFloat(lp),100)}%;background:${lc};border-radius:4px;"></div></div>
                </div>
                <div style="font-size:10px;font-weight:900;color:${lc};min-width:70px;text-align:right;">$${sv.toFixed(2)} (${lp}%)</div>
            </div>`;
    });
    ladderHTML += `</div>`;
    document.getElementById('rc-ladder').innerHTML = ladderHTML;
}