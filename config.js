/* CEOSkit — Config, API helpers, WebSocket connection */

// ── Config store ────────────────────────────────────────────────────────
const _DEFAULTS = {
    client_id:    '33iOLAXmv1IW6UAcxobdP',
    app_id:       '33iOLAXmv1IW6UAcxobdP',
    redirect_uri: 'https://ceoskit.vercel.app',
    rest_base:    'https://api.derivws.com',
    affiliate_token: '_uHE19OJCwZKFfUyb_9NCN2Nd7ZgqdRLk',
    utm_campaign: 'ceoskit',
};
function _cfg(k){ return localStorage.getItem('csk_cfg_'+k) || _DEFAULTS[k] || ''; }
function _setCfg(k,v){ if(v) localStorage.setItem('csk_cfg_'+k,v); else localStorage.removeItem('csk_cfg_'+k); }

// ── Token helpers ────────────────────────────────────────────────────────
function getAuthToken(){ return localStorage.getItem('deriv_token1') || null; }
function getAuthAccounts(){ try{ return JSON.parse(localStorage.getItem('deriv_accounts')||'[]'); }catch(e){ return []; } }
function getActiveAccount(){ return localStorage.getItem('deriv_active_acct') || '—'; }
function clearAuth(){
    ['deriv_token1','deriv_accounts','deriv_active_acct','deriv_token_type','deriv_token_exp',
     'sub_balance','sub_transaction'].forEach(k=>localStorage.removeItem(k));
}

// ── REST headers (schema: Deriv-App-ID + Authorization Bearer) ──────────
function _restHeaders(extra){
    const tok   = getAuthToken();
    const appId = _cfg('client_id');
    return Object.assign({
        'Authorization': 'Bearer ' + tok,
        'Deriv-App-ID':  appId,
    }, extra||{});
}
function _restBase(){ return _cfg('rest_base') || 'https://api.derivws.com'; }

// ── REST: GET /trading/v1/options/accounts ───────────────────────────────
// Schema: get_accounts_request — headers: Deriv-App-ID + Authorization
// Schema: get_accounts_response — data: array of accounts
async function restGetAccounts(){
    const res = await fetch(_restBase()+'/trading/v1/options/accounts', {
        method:'GET', headers:_restHeaders()
    });
    if(!res.ok) throw new Error('GET accounts '+res.status);
    const j = await res.json();
    return Array.isArray(j.data) ? j.data : [];
}

// ── REST: POST /trading/v1/options/accounts ──────────────────────────────
// Schema: create_account_request — body: {currency, group, account_type}
// Schema: create_account_response — 200: data object, 201: data array
async function restCreateAccount(account_type, currency, group){
    const res = await fetch(_restBase()+'/trading/v1/options/accounts', {
        method:'POST',
        headers:_restHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({ currency:currency||'USD', group:group||'row', account_type })
    });
    if(!res.ok) throw new Error('Create account '+res.status);
    const j = await res.json();
    return Array.isArray(j.data) ? j.data[0] : j.data;
}

// ── REST: POST /trading/v1/options/accounts/{account_id}/reset ───────────
// Schema: reset_demo_balance_request — path: account_id, headers: auth
// Schema: reset_demo_balance_response — data: {account_id, balance, currency, status}
async function restResetDemoBalance(account_id){
    const res = await fetch(_restBase()+'/trading/v1/options/accounts/'+account_id+'/reset', {
        method:'POST', headers:_restHeaders()
    });
    if(!res.ok) throw new Error('Reset balance '+res.status);
    const j = await res.json();
    return j.data || null;
}

// ── REST: POST /trading/v1/options/accounts/{accountId}/otp ─────────────
// Schema: websocket_request — path: accountId, headers: Deriv-App-ID + Authorization
// Schema: websocket_response — data: {url} — wss:// with embedded OTP
async function restGetOtpWsUrl(accountId){
    const tok   = getAuthToken();
    const appId = _cfg('client_id');
    if(!tok || !appId || !accountId) return null;
    const res = await fetch(_restBase()+'/trading/v1/options/accounts/'+accountId+'/otp', {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+tok, 'Deriv-App-ID':appId }
    });
    if(!res.ok) return null;
    const j = await res.json();
    return (j && j.data && j.data.url) ? j.data.url : null;
}

// ── WS: connect via OTP authenticated URL ───────────────────────────────
// After connect, send WS requests per schemas:
// balance:     {balance:1, subscribe:1}         → msg_type:'balance'
// transaction: {transaction:1, subscribe:1}     → msg_type:'transaction'
// portfolio:   {portfolio:1}                    → msg_type:'portfolio'
// profit_table:{profit_table:1, description:1}  → msg_type:'profit_table'
// statement:   {statement:1, description:1}     → msg_type:'statement'
let socket, _wsConnecting=false, _reconnects=0;

async function connect(){
    if(_wsConnecting) return;
    const tok   = getAuthToken();
    const acct  = getActiveAccount();
    const appId = _cfg('client_id');

    if(!tok || !appId){
        console.warn('CEOSkit: No token or client_id. Open ⚙️ Admin Panel.');
        return;
    }

    _wsConnecting = true;

    try{
        // Step 1: get OTP authenticated WS URL from REST
        const wsUrl = await restGetOtpWsUrl(acct);
        if(!wsUrl) throw new Error('OTP URL not returned — check token and account ID');

        // Step 2: connect to authenticated WS URL
        console.log('CEOSkit: Connecting to authenticated WS…');
        _connectWs(wsUrl);

    } catch(e){
        _wsConnecting = false;
        console.warn('CEOSkit WS connect failed:', e.message);
        // Retry with backoff (max 5)
        _reconnects++;
        if(_reconnects <= 5){
            setTimeout(()=>connect(), Math.min(3000*_reconnects, 15000));
        } else {
            const el = document.getElementById('acct-balance-label');
            if(el) el.textContent = 'Connection failed';
        }
    }
}

function _connectWs(wsUrl){
    if(socket){ try{ socket.close(); }catch(e){} }
    socket = new WebSocket(wsUrl);

    socket.onopen = function(){
        _wsConnecting = false;
        _reconnects   = 0;
        console.log('✅ CEOSkit WS authenticated and connected');
        window._derivOtpWsUrl = wsUrl; // Share with inner iframes

        // Subscribe per schemas
        socket.send(JSON.stringify({balance:1, subscribe:1, req_id:10}));
        socket.send(JSON.stringify({transaction:1, subscribe:1, req_id:11}));
        socket.send(JSON.stringify({portfolio:1, req_id:12}));
        socket.send(JSON.stringify({active_symbols:'brief', req_id:13}));
        socket.send(JSON.stringify({contracts_list:1, req_id:14}));
        socket.send(JSON.stringify({time:1, req_id:15}));
        socket.send(JSON.stringify({trading_times:'today', req_id:16}));
    };

    socket.onmessage = function(msg){
        const d = JSON.parse(msg.data);
        if(!d || !d.msg_type) return;

        // ping response schema: msg_type='ping', ping='pong'
        if(d.msg_type==='ping' || d.msg_type==='pong') return;

        // ── Trading messages (proposal, buy, sell, cancel, etc.) ──
        if(handleTradingMessage(d)) return;

        // ── time (server epoch) ──
        if(d.msg_type==='time'){
            window._serverTime = d.time;
            const el = document.getElementById('server-time');
            if(el) el.textContent = new Date(d.time*1000).toUTCString().slice(17,25)+' UTC';
            return;
        }

        // ── trading_times — market open/close schedule ──
        if(d.msg_type==='trading_times'){
            window._tradingTimes = d.trading_times;
            return;
        }

        // ── forget / forget_all — just silently acknowledge ──
        if(d.msg_type==='forget'||d.msg_type==='forget_all') return;

        // ── active_symbols (schema: underlying_symbol, underlying_symbol_name) ──
        if(d.msg_type==='active_symbols'){
            masterSymbols = d.active_symbols||[];
            renderList('volatility');
            if(typeof advanceBoot==='function') advanceBoot(1);
            return;
        }

        // ── contracts_list (schema: contract_category, contract_types[], display_name) ──
        if(d.msg_type==='contracts_list'){
            window._derivContractsList = d.contracts_list||[];
            if(typeof _updateContractsDropdown==='function') _updateContractsDropdown(d.contracts_list||[]);
            return;
        }

        // ── contracts_for (schema: contracts_for.available[].contract_type, barriers, durations) ──
        if(d.msg_type==='contracts_for'){
            window._derivContractsFor = d.contracts_for||{};
            if(typeof currentSymbolContracts!=='undefined') currentSymbolContracts=(d.contracts_for&&d.contracts_for.available)||[];
            return;
        }

        // ── ticks history + tick stream (schema: history.prices/times, tick.quote/pip_size/id) ──
        if(d.msg_type==='history'||d.msg_type==='tick'){
            const pips=d.tick?d.tick.pip_size:(d.history?d.pip_size:pipSize);if(pips)pipSize=pips;
            if(d.tick&&d.tick.id) window._subIdTick=d.tick.id;
            if(d.subscription&&d.subscription.id) window._subIdHistory=d.subscription.id;
            const prices=d.tick?[d.tick.quote]:d.history.prices;
            prices.forEach(p=>{const digit=parseInt(p.toFixed(pipSize).slice(-1));const prev=fullHistory.length>0?fullHistory[fullHistory.length-1].price:p;fullHistory.push({price:p,digit,diff:p-prev});});
            if(fullHistory.length>1000) fullHistory.splice(0,fullHistory.length-1000);
            if(d.msg_type==='history'&&fullHistory.length>=50) if(typeof advanceBoot==='function') advanceBoot(2);
            if(d.tick){
                const last=fullHistory[fullHistory.length-1];
                priceEl.innerHTML=`${last.price.toFixed(pipSize).slice(0,-1)}<span style="color:var(--accent)">${last.digit}</span>`;
                moveCursor(last.digit);
                if(typeof advanceBoot==='function') advanceBoot(3);
                if(activePanel&&document.getElementById('ai-modal').classList.contains('open')) liveRefresh();
                if(document.getElementById('tools-overlay').classList.contains('open')) liveRefreshTools();
            }
            updateStats();
            return;
        }

        // ── balance (schema: balance_response) ──
        // Required: balance.balance, balance.currency, balance.loginid
        if(d.msg_type==='balance' && d.balance){
            onBalanceUpdate(d.balance);
            if(d.balance.id) localStorage.setItem('sub_balance', d.balance.id);
            if(typeof advanceBoot==='function') advanceBoot(2);
            return;
        }

        // ── transaction stream (schema: transaction_response) ──
        // Fields: action, amount, balance, contract_id, currency, transaction_id
        if(d.msg_type==='transaction' && d.transaction){
            const tx = d.transaction;
            if(tx.balance!=null && tx.currency){
                onBalanceUpdate({balance:tx.balance, currency:tx.currency, loginid:getActiveAccount()});
            }
            if(d.transaction.id) localStorage.setItem('sub_transaction', d.transaction.id);
            window._lastTransaction = tx;
            if(typeof onTransactionUpdate==='function') onTransactionUpdate(tx);
            return;
        }

        // ── portfolio (schema: portfolio_response) ──
        // Fields: portfolio.contracts[] — buy_price, contract_id, contract_type, currency
        if(d.msg_type==='portfolio'){
            if(d.portfolio) window._derivPortfolio = d.portfolio.contracts||[];
            if(typeof onPortfolioUpdate==='function') onPortfolioUpdate(window._derivPortfolio);
            return;
        }

        // ── profit_table (schema: profit_table_response) ──
        // Fields: profit_table.transactions[] — buy_price, sell_price, contract_type, underlying_symbol
        if(d.msg_type==='profit_table'){
            if(d.profit_table) window._derivProfitTable = d.profit_table;
            if(typeof onProfitTableUpdate==='function') onProfitTableUpdate(d.profit_table);
            return;
        }

        // ── statement (schema: statement_response) ──
        // Fields: statement.transactions[] — action_type, amount, balance_after, contract_id
        if(d.msg_type==='statement'){
            if(d.statement) window._derivStatement = d.statement;
            if(typeof onStatementUpdate==='function') onStatementUpdate(d.statement);
            return;
        }

        // tick/history handled above

        // ── authorize (legacy fallback, some WS endpoints still use it) ──
        if(d.msg_type==='authorize'){
            if(d.error){ clearAuth(); location.reload(); return; }
            const acct=d.authorize;
            localStorage.setItem('deriv_active_acct', acct.loginid||acct.account_id||acct.id||'');
            onBalanceUpdate({currency:acct.currency, balance:acct.balance, loginid:acct.loginid});
            socket.send(JSON.stringify({active_symbols:'brief'}));
            socket.send(JSON.stringify({balance:1, subscribe:1}));
            socket.send(JSON.stringify({transaction:1, subscribe:1}));
            socket.send(JSON.stringify({portfolio:1}));
            return;
        }

        // ── account_list ──
        if(d.msg_type==='account_list' && d.account_list){
            buildAccountSwitcher(d.account_list);
            return;
        }

        // ── InvalidToken ──
        if(d.error && d.error.code==='InvalidToken'){
            clearAuth();
            document.getElementById('login-overlay').style.display='flex';
            document.getElementById('main-content').classList.remove('visible');
            loShowError('Session expired. Please log in again.');
            return;
        }
    };

    socket.onclose = function(){
        _wsConnecting = false;
        if(currentSymbol) _pendingResubSymbol = currentSymbol;
        _reconnects++;
        if(_reconnects<=5) setTimeout(()=>connect(), Math.min(3000*_reconnects,15000));
        else { const el=document.getElementById('acct-balance-label'); if(el) el.textContent='Disconnected'; }
    };

    socket.onerror = function(){ try{ socket.close(); }catch(e){} };

    // Heartbeat
    setInterval(()=>{ if(socket&&socket.readyState===1) socket.send(JSON.stringify({ping:1})); }, 25000);
}

let _pendingResubSymbol = '';

// --- Trading Core ---

let masterSymbols=[],fullHistory=[],activeCat='volatility',activeType='rise_fall',activeBarrier=null,pipSize=2,currentSymbol='';
let currentSymbolContracts=[];  // contracts_for.available[] for current symbol