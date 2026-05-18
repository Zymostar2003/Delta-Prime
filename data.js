/* CEOSkit — Market data, contracts, balance, WS callbacks */

// ── renderList — build market select from active_symbols ────────────────
function renderList(cat){
    activeCat = cat;
    const labels={volatility:'Volatility Indices',crash_boom:'Crash & Boom',step:'Step Indices',jump:'Jump Indices'};
    const shieldTitle=document.getElementById('shield-title');
    if(shieldTitle) shieldTitle.textContent=labels[cat]||cat;
    const isDM=(cat==='volatility'||cat==='jump');
    analysisTools.classList.toggle('hidden',!isDM);
    contractNav.classList.toggle('hidden',!isDM);
    // New API schema: underlying_symbol + underlying_symbol_name
    const filtered=masterSymbols.filter(m=>{
        const sym=(m.underlying_symbol||m.symbol||'').toUpperCase();
        const name=(m.underlying_symbol_name||m.display_name||'').toUpperCase();
        if(cat==='volatility') return sym.startsWith('R_')||sym.startsWith('1HZ')||name.includes('VOLATILITY');
        if(cat==='crash_boom') return name.includes('CRASH')||name.includes('BOOM');
        if(cat==='step')       return name.includes('STEP');
        if(cat==='jump')       return name.includes('JUMP');
        return false;
    });
    const sel=document.getElementById('market-select');
    sel.innerHTML=filtered.map(m=>{
        const sym=m.underlying_symbol||m.symbol||'';
        const name=m.underlying_symbol_name||m.display_name||sym;
        return `<option value="${sym}">${name}</option>`;
    }).join('');
    sel.onchange=(e)=>{
        fullHistory=[]; currentSymbol=e.target.value;
        if(socket&&socket.readyState===1){
            cleanupSubscriptions();
            socket.send(JSON.stringify({ticks_history:e.target.value,count:1000,end:'latest',style:'ticks'}));
            socket.send(JSON.stringify({ticks:e.target.value,subscribe:1}));
            requestContractsFor(e.target.value);
        }
        // Sync to SA and Signal Engine
        const saSel=document.getElementById('sa-market-select');
        if(saSel){const opt=saSel.querySelector('option[value="'+e.target.value+'"]');if(opt){saSel.value=e.target.value;saSel.dispatchEvent(new Event('change'));}}
        const seIf=document.getElementById('engine-iframe');
        if(seIf&&seIf._blobLoaded&&seIf.contentWindow){try{seIf.contentWindow.postMessage({type:'ceoskit_setSymbol',symbol:e.target.value},'*');}catch(err){}}
    };
    if(filtered.length>0){ currentSymbol=filtered[0].underlying_symbol||filtered[0].symbol||''; sel.dispatchEvent(new Event('change')); }
}

// ── Request contracts for a symbol (called on symbol change) ─────────────
function requestContractsFor(symbol){
    if(!symbol || !socket || socket.readyState!==1) return;
    socket.send(JSON.stringify({contracts_for: symbol, req_id:15}));
}

// ── Update contracts dropdown from contracts_list response ───────────────
function _updateContractsDropdown(contractsList){
    // contractsList: [{contract_category, contract_types[], display_name}]
    // Map to our existing dropdown items
    const categoryMap = {
        'callput':    'btn-rise_fall',
        'digits':     ['btn-even_odd','btn-over_under','btn-differs'],
        'multiplier': null, // not in our UI currently
    };
    contractsList.forEach(cat=>{
        const btnId = categoryMap[cat.contract_category];
        if(!btnId) return;
        const ids = Array.isArray(btnId) ? btnId : [btnId];
        ids.forEach(id=>{
            const btn = document.getElementById(id);
            if(btn){ btn.style.opacity='1'; btn.title=cat.display_name; }
        });
    });
}
const priceEl=document.getElementById('live-price'),rollEl=document.getElementById('rolling-window'),
      digitPanel=document.getElementById('digit-panel'),barrierPanel=document.getElementById('barrier-panel'),
      analysisTools=document.getElementById('analysis-tools'),contractNav=document.getElementById('contract-nav');

function setupDigitGrid(){
    digitPanel.innerHTML='<div id="digit-cursor" class="hidden"></div>';barrierPanel.innerHTML='';
    for(let i=0;i<=9;i++){
        const g=document.createElement('div');g.className='digit-group';g.id=`group-${i}`;
        g.innerHTML=`<div class="digit-circle">${i}</div><span class="pct-label" style="font-weight:900">0%</span>`;digitPanel.appendChild(g);
        const b=document.createElement('div');b.className='barrier-btn';b.innerText=i;
        b.onclick=()=>{document.querySelectorAll('.barrier-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeBarrier=i;updateStats();};barrierPanel.appendChild(b);
    }
    const r=document.createElement('div');r.className='barrier-btn btn-reset';r.innerText='X';
    r.onclick=()=>{document.querySelectorAll('.barrier-btn').forEach(x=>x.classList.remove('active'));activeBarrier=null;updateStats();};barrierPanel.appendChild(r);
}

function moveCursor(digit){
    const tg=document.getElementById(`group-${digit}`),cur=document.getElementById('digit-cursor');
    if(!tg||!cur||analysisTools.classList.contains('hidden'))return;
    cur.classList.remove('hidden');cur.style.left=(tg.offsetLeft+(tg.offsetWidth/2)-10)+"px";cur.style.top=(tg.offsetTop-15)+"px";
}

// ── Balance & Header Update ───────────────────────────────────────────────
function updateStats(){
    // Update digit statistics display from fullHistory
    if(!fullHistory.length) return;
    const window_size = parseInt(document.getElementById('rolling-window')&&document.getElementById('rolling-window').value||300);
    const slice = fullHistory.slice(-window_size);
    const counts = Array(10).fill(0);
    slice.forEach(t=>{ if(t.digit>=0&&t.digit<=9) counts[t.digit]++; });
    const total = slice.length || 1;
    for(let i=0;i<=9;i++){
        const pct = (counts[i]/total*100).toFixed(1);
        const g = document.getElementById('group-'+i);
        if(g){
            const lbl = g.querySelector('.pct-label');
            if(lbl) lbl.textContent = pct+'%';
            const isActive = activeBarrier===i;
            g.style.background = isActive ? 'var(--accent)' : '';
        }
    }
}

function onBalanceUpdate(b){
    const balEl=document.getElementById('acct-balance-val');
    const lblEl=document.getElementById('acct-balance-label');
    if(balEl && b.balance!=null) balEl.textContent=`${parseFloat(b.balance).toFixed(2)} ${b.currency||''}`;
    if(lblEl && b.loginid)       lblEl.textContent=b.loginid;
}

// ── WS data callbacks ─────────────────────────────────────────────────────
function onPortfolioUpdate(contracts){
    window._derivPortfolio = contracts;
    if(document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onProfitTableUpdate(pt){
    window._derivProfitTable = pt;
    if(document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onStatementUpdate(st){
    window._derivStatement = st;
    if(document.getElementById('tools-overlay').classList.contains('open')){
        try{ document.getElementById('tools-panel-report').innerHTML = build_report(); }catch(e){}
    }
}
function onTransactionUpdate(tx){
    const balEl = document.getElementById('acct-balance-val');
    if(balEl){ balEl.style.color=tx.action==='buy'?'var(--red)':'var(--green)';
        setTimeout(()=>{ balEl.style.color=''; },800); }
}

// ════════════════════════════════════════════════════════════════════
//  TRADING LAYER — proposal, buy, sell, cancel, contract_update
// ════════════════════════════════════════════════════════════════════

function handleTradingMessage(d){
    if(!d || !d.msg_type) return false;
    if(d.msg_type==='proposal'){
        if(d.error){ onProposalError(d.error); return true; }
        window._lastProposal = d.proposal;
        window._lastProposalId = d.proposal.id;
        onProposalUpdate(d.proposal);
        return true;
    }
    if(d.msg_type==='buy'){
        setTradeBtnLoading(false);
        if(d.error){ onBuyError(d.error); return true; }
        onBuySuccess(d.buy);
        return true;
    }
    if(d.msg_type==='sell'){
        if(d.error){ showTradeToast('Sell failed: '+d.error.message,'error'); return true; }
        onSellSuccess(d.sell);
        return true;
    }
    if(d.msg_type==='cancel'){
        if(d.error){ showTradeToast('Cancel failed: '+d.error.message,'error'); return true; }
        onBalanceUpdate({balance:d.cancel.balance_after,currency:localStorage.getItem('deriv_currency')||'USD',loginid:getActiveAccount()});
        showTradeToast('Contract cancelled. Refund: '+d.cancel.sold_for,'success');
        return true;
    }
    if(d.msg_type==='proposal_open_contract'){
        if(d.proposal_open_contract){ window._openContracts=window._openContracts||{}; window._openContracts[d.proposal_open_contract.contract_id]=d.proposal_open_contract; }
        return true;
    }
    if(d.msg_type==='contract_update'){
        if(d.error){ showTradeToast('Update failed: '+d.error.message,'error'); return true; }
        showTradeToast('Contract updated','success');
        return true;
    }
    if(d.msg_type==='contract_update_history'){
        window._contractUpdateHistory=d.contract_update_history||[];
        return true;
    }
    return false;
}

function requestProposal(params){
    if(!socket||socket.readyState!==1) return;
    if(window._lastProposalId){ socket.send(JSON.stringify({forget:window._lastProposalId})); window._lastProposalId=null; }
    const currency=localStorage.getItem('deriv_currency')||'USD';
    socket.send(JSON.stringify(Object.assign({proposal:1,subscribe:1,contract_type:'CALL',currency,underlying_symbol:currentSymbol,duration:5,duration_unit:'t',basis:'stake',amount:1},params)));
}

function buyContract(proposalId,maxPrice,parameters){
    if(!socket||socket.readyState!==1){showTradeToast('Not connected','error');return;}
    const req={buy:proposalId||'1',price:maxPrice||0};
    if(!proposalId&&parameters) req.parameters=parameters;
    socket.send(JSON.stringify(req));
}

function sellContract(contractId,price){
    if(!socket||socket.readyState!==1){showTradeToast('Not connected','error');return;}
    socket.send(JSON.stringify({sell:contractId,price:price||0}));
}

function cancelContract(contractId){
    if(!socket||socket.readyState!==1){showTradeToast('Not connected','error');return;}
    socket.send(JSON.stringify({cancel:contractId}));
}

function subscribeOpenContract(contractId){
    if(!socket||socket.readyState!==1) return;
    const req={proposal_open_contract:1,subscribe:1};
    if(contractId) req.contract_id=contractId;
    socket.send(JSON.stringify(req));
}

function updateContract(contractId,stopLoss,takeProfit){
    if(!socket||socket.readyState!==1) return;
    socket.send(JSON.stringify({contract_update:1,contract_id:contractId,limit_order:{stop_loss:stopLoss!==undefined?stopLoss:null,take_profit:takeProfit!==undefined?takeProfit:null}}));
}

function placeTrade(contractType,stake,durationTicks){
    if(!socket||socket.readyState!==1){showTradeToast('Not connected','error');return;}
    if(!currentSymbol){showTradeToast('Select a market first','error');return;}
    const currency=localStorage.getItem('deriv_currency')||'USD';
    setTradeBtnLoading(true);
    if(window._lastProposal&&window._lastProposal.id){
        buyContract(window._lastProposal.id,window._lastProposal.ask_price);
    } else {
        buyContract('1',stake,{contract_type:contractType,currency,underlying_symbol:currentSymbol,duration:durationTicks||5,duration_unit:'t',basis:'stake',amount:stake});
    }
}

function setTradeBtnLoading(loading){
    document.querySelectorAll('.trade-btn,.rise-btn,.fall-btn,.enter-btn').forEach(b=>{b.disabled=loading;b.style.opacity=loading?'0.6':'';});
}

function onProposalUpdate(p){
    const payoutEl=document.getElementById('proposal-payout'); if(payoutEl) payoutEl.textContent=p.payout?p.payout.toFixed(2):'—';
    const askEl=document.getElementById('proposal-ask'); if(askEl) askEl.textContent=p.ask_price?p.ask_price.toFixed(2):'—';
}
function onProposalError(err){ showTradeToast('Proposal: '+(err.message||err.code),'error'); }
function onBuySuccess(buy){
    onBalanceUpdate({balance:buy.balance_after,currency:localStorage.getItem('deriv_currency')||'USD',loginid:getActiveAccount()});
    showTradeToast('✅ Bought! Contract #'+buy.contract_id+' | Payout: '+buy.payout.toFixed(2),'success');
    subscribeOpenContract(buy.contract_id);
    if(socket&&socket.readyState===1) socket.send(JSON.stringify({portfolio:1}));
}
function onBuyError(err){ showTradeToast('Buy failed: '+(err.message||err.code),'error'); }
function onSellSuccess(sell){
    onBalanceUpdate({balance:sell.balance_after,currency:localStorage.getItem('deriv_currency')||'USD',loginid:getActiveAccount()});
    showTradeToast('✅ Sold for '+sell.sold_for.toFixed(2),'success');
    if(socket&&socket.readyState===1) socket.send(JSON.stringify({portfolio:1}));
}

// ── Utility API helpers (ping, time, forget, trading_times) ─────────────
function sendPing(){ if(socket&&socket.readyState===1) socket.send(JSON.stringify({ping:1})); }

function getServerTime(){ if(socket&&socket.readyState===1) socket.send(JSON.stringify({time:1})); }

function getTradingTimes(date){
    if(socket&&socket.readyState===1)
        socket.send(JSON.stringify({trading_times: date||'today'}));
}

// forget schema: id must match pattern ^[\w-]{32,128}$
function forgetStream(id){
    if(!id||!socket||socket.readyState!==1) return;
    socket.send(JSON.stringify({forget:id}));
}

// forget_all schema: type = 'ticks'|'candles'|'proposal'|'proposal_open_contract'|'balance'|'transaction'
function forgetAllStreams(type){
    if(!socket||socket.readyState!==1) return;
    socket.send(JSON.stringify({forget_all: type||'ticks'}));
}

// Clean up all subscriptions before switching symbol
function cleanupSubscriptions(){
    if(!socket||socket.readyState!==1) return;
    ['ticks','candles','proposal','proposal_open_contract'].forEach(t=>{
        socket.send(JSON.stringify({forget_all:t}));
    });
    window._lastProposalId = null;
    window._lastProposal   = null;
}

function showTradeToast(msg,type){
    let t=document.getElementById('trade-toast');
    if(!t){t=document.createElement('div');t.id='trade-toast';t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:99999;transition:opacity .3s;max-width:90vw;text-align:center;pointer-events:none;';document.body.appendChild(t);}
    t.textContent=msg;t.style.background=type==='success'?'#00c853':type==='error'?'#ff5252':'#333';t.style.color='#fff';t.style.opacity='1';
    clearTimeout(t._t);t._t=setTimeout(()=>{t.style.opacity='0';},4000);
}