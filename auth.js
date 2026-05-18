/* CEOSkit — Authentication, PKCE OAuth, account switcher */

// ── Auth UI helpers ───────────────────────────────────────────────────────────
function loShowError(msg){
    const el=document.getElementById('lo-error');
    if(el){ el.textContent=msg; el.style.display='block'; }
    const btn=document.getElementById('lo-login-btn');
    if(btn){ btn.disabled=false; btn.innerHTML='<span style="font-size:20px;">→</span> Login with Deriv'; }
}

function loBootApp(){
    document.getElementById('login-overlay').style.display='none';
    document.getElementById('login-callback').style.display='none';
    document.getElementById('splash-screen').style.display='none';
    const mc = document.getElementById('main-content');
    if(mc) mc.classList.add('visible');
    setTimeout(()=>{ if(typeof connect==='function') connect(); }, 300);
}

function loParseTokens(params){
    const accounts=[]; let i=1;
    while(params.get('token'+i)){
        accounts.push({token:params.get('token'+i),account:params.get('acct'+i)||'',currency:(params.get('cur'+i)||'USD').toUpperCase(),isReal:(params.get('acct'+i)||'').toUpperCase().startsWith('CR')});
        i++;
    }
    return accounts.length ? accounts : null;
}

function loCommitAndEnter(accounts, chosen){
    localStorage.setItem('deriv_token1', chosen.token);
    localStorage.setItem('deriv_active_acct', chosen.account);
    localStorage.setItem('deriv_accounts', JSON.stringify(accounts));
    history.replaceState(null,'',window.location.pathname);
    loBootApp();
}

function loShowAccountChooser(accounts){
    document.getElementById('login-callback').style.display='none';
    document.getElementById('login-overlay').style.display='flex';
    const grid=document.getElementById('lo-acct-grid');
    grid.style.display='flex';
    document.getElementById('lo-login-btn').style.display='none';
    const sorted=[...accounts.filter(a=>a.isReal),...accounts.filter(a=>!a.isReal)];
    sorted.forEach(acct=>{
        const pill=document.createElement('div');
        pill.className='lo-acct-pill '+(acct.isReal?'real':'demo');
        pill.innerHTML='<div><div class="lo-acct-id">'+acct.account+'</div><div class="lo-acct-cur">'+acct.currency+'</div></div>'+
            '<span class="lo-acct-badge '+(acct.isReal?'real':'demo')+'">'+(acct.isReal?'Real':'Demo')+'</span>';
        pill.onclick=()=>loCommitAndEnter(sorted,acct);
        grid.appendChild(pill);
    });
}

// ── PKCE helpers (new Deriv OAuth2) ──────────────────────────────────────
function _genVerifier(){
    const array = crypto.getRandomValues(new Uint8Array(64));
    return Array.from(array).map(v=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v%66]).join('');
}
async function _genChallenge(v){
    const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function loHandleLogin(e){
    if(e) e.preventDefault();
    const clientId = _cfg('client_id');
    const btn = document.getElementById('lo-login-btn');
    if(!clientId){ openAdminPanel(); return; }
    if(btn){ btn.style.opacity='0.7'; btn.innerHTML='<span class="lo-spinner" style="width:20px;height:20px;border-width:3px;display:inline-block;"></span> Connecting to Deriv…'; }
    _startPKCE(clientId, false);
}

async function loHandleSignup(e){
    if(e) e.preventDefault();
    const clientId = _cfg('client_id');
    if(!clientId){ openAdminPanel(); return; }
    _startPKCE(clientId, true);
}

async function _startPKCE(clientId, isSignup){
    try{
        const verifier  = _genVerifier();
        const challenge = await _genChallenge(verifier);
        const state     = crypto.getRandomValues(new Uint8Array(16)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');
        sessionStorage.setItem('pkce_code_verifier', verifier);
        sessionStorage.setItem('oauth_state', state);

        const redirectUri = _cfg('redirect_uri') || (window.location.origin+window.location.pathname);
        const url = new URL('https://auth.deriv.com/oauth2/auth');
        url.searchParams.set('response_type','code');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('scope','trade account_manage');
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method','S256');
        if(isSignup){
            url.searchParams.set('prompt','registration');
            const aff = _cfg('affiliate_token');
            if(aff) url.searchParams.set('t', aff);
            url.searchParams.set('utm_medium','affiliate');
        }
        window.location.replace(url.toString());
    }catch(e){ console.error('PKCE failed',e); }
}

async function _handlePKCECallback(params){
    const code  = params.get('code');
    const state = params.get('state');
    if(!code) return false;
    if(state !== sessionStorage.getItem('oauth_state')){ console.warn('State mismatch'); return false; }
    const verifier   = sessionStorage.getItem('pkce_code_verifier');
    const clientId   = _cfg('client_id');
    const redirectUri= _cfg('redirect_uri') || (window.location.origin+window.location.pathname);
    try{
        const res = await fetch('https://auth.deriv.com/oauth2/token',{
            method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body: new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirectUri,code_verifier:verifier})
        });
        const data = await res.json();
        if(data.access_token){
            localStorage.setItem('deriv_token1', data.access_token);
            localStorage.setItem('deriv_token_type','jwt');
            if(data.expires_in) localStorage.setItem('deriv_token_exp', Date.now()+data.expires_in*1000);
            sessionStorage.removeItem('pkce_code_verifier');
            sessionStorage.removeItem('oauth_state');
            // Fetch accounts from REST API
            try{
                const accounts = await restGetAccounts();
                if(accounts && accounts.length){
                    const chosen = accounts.find(a=>a.account_type==='demo')||accounts[0];
                    localStorage.setItem('deriv_active_acct', chosen.account_id);
                    localStorage.setItem('deriv_accounts', JSON.stringify(accounts.map(a=>({
                        account:a.account_id, account_id:a.account_id,
                        currency:a.currency, balance:a.balance,
                        isReal:a.account_type==='real', account_type:a.account_type,
                        token:data.access_token
                    }))));
                }
            }catch(e){ console.warn('restGetAccounts after PKCE failed',e); }
            return true;
        }
    }catch(e){ console.error('Token exchange failed',e); }
    return false;
}

// ── Page load auth check ──────────────────────────────────────────────────
var _skipSplash = false;
(function initAuth(){
    const params  = new URLSearchParams(window.location.search);
    const code    = params.get('code');
    const oauthErr= params.get('error');

    // PKCE callback
    if(code){
        _skipSplash=true;
        document.getElementById('splash-screen').style.display='none';
        document.getElementById('login-callback').style.display='flex';
        history.replaceState(null,'',window.location.pathname);
        _handlePKCECallback(params).then(ok=>{
            if(ok){ loBootApp(); }
            else {
                document.getElementById('login-callback').style.display='none';
                document.getElementById('login-overlay').style.display='flex';
                loShowError('Authorization failed. Please try again.');
            }
        });
        return;
    }

    // OAuth error
    if(oauthErr){
        _skipSplash=true;
        document.getElementById('splash-screen').style.display='none';
        document.getElementById('login-overlay').style.display='flex';
        history.replaceState(null,'',window.location.pathname);
        loShowError('Deriv error: '+(params.get('error_description')||oauthErr));
        return;
    }

    // Already have token — boot normally (skip login screen)
    if(getAuthToken()){
        document.getElementById('splash-screen').style.display='none';
        const mc=document.getElementById('main-content');
        if(mc) mc.classList.add('visible');
        setTimeout(()=>{ if(typeof connect==='function') connect(); },300);
        return;
    }

    // No token — show login overlay
    _skipSplash=true;
    document.getElementById('splash-screen').style.display='none';
    document.getElementById('login-overlay').style.display='flex';
})();

// ── Account Switcher ──────────────────────────────────────────────────────
function getWalletIcon(acc){
    const cur=(acc.currency||'USD').toUpperCase();
    const isDemo=acc.is_virtual||acc.account_type==='demo'||acc.account_type==='virtual'||(acc.loginid||acc.account_id||'').startsWith('DOT9');
    if(isDemo) return `<div style="width:26px;height:26px;border-radius:50%;background:#3b82f6;color:#fff;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;">D</div>`;
    const flagMap={USD:'us',EUR:'eu',GBP:'gb',AUD:'au',CAD:'ca',KES:'ke',NGN:'ng'};
    const flag=flagMap[cur]||'us';
    return `<div style="width:26px;height:26px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="https://flagcdn.com/w40/${flag}.png" style="width:100%;height:100%;object-fit:cover;"></div>`;
}

function buildAccountSwitcher(accounts){
    accounts = accounts.map(a=>Object.assign({
        loginid:     a.loginid     ||a.account_id||a.account||'',
        account_id:  a.account_id  ||a.loginid   ||a.account||'',
        currency:    a.currency    ||'USD',
        balance:     a.balance     !=null?a.balance:null,
        is_virtual:  a.is_virtual  ||a.account_type==='demo'||a.account_type==='virtual',
        account_type:a.account_type||(a.is_virtual?'demo':'real'),
    },a));
    const listEl=document.getElementById('menu-accounts-list');
    const loginIdEl=document.getElementById('menu-loginid');
    const active=getActiveAccount();
    if(loginIdEl) loginIdEl.textContent=active||'—';
    if(!listEl) return;
    listEl.innerHTML='';
    accounts.forEach(acc=>{
        const isDemo=acc.is_virtual||acc.account_type==='demo';
        const isActive=acc.loginid===active||acc.account_id===active;
        const cur=(acc.currency||'USD').toUpperCase();
        const bal=acc.balance!=null?`${parseFloat(acc.balance).toFixed(2)} ${cur}`:`— ${cur}`;
        const item=document.createElement('div');
        item.style.cssText=`display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;margin-bottom:4px;background:${isActive?'var(--accent)':'var(--panel-bg)'};border:1px solid ${isActive?'var(--accent)':'var(--border)'};`;
        item.innerHTML=`${getWalletIcon(acc)}<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:800;color:${isActive?'#fff':'var(--text-main)'};">${acc.loginid||acc.account_id}</div><div style="font-size:9px;color:${isActive?'rgba(255,255,255,.75)':'var(--dark-gray)'};">${bal}</div></div><span style="font-size:8px;font-weight:700;padding:2px 7px;border-radius:20px;background:${isDemo?'#dbeafe':'#dcfce7'};color:${isDemo?'#1d4ed8':'#16a34a'};">${isDemo?'Demo':'Real'}</span>`;
        if(!isActive) item.onclick=()=>{ _switchToAccount(acc); };
        listEl.appendChild(item);
    });
    const switchBtn=document.getElementById('menu-switch-acct');
    if(switchBtn) switchBtn.style.display=accounts.length>1?'flex':'none';
}

async function _switchToAccount(acc){
    const id = acc.account_id || acc.loginid;
    localStorage.setItem('deriv_active_acct', id);
    buildAccountSwitcher(getAuthAccounts().map(a=>({...a,loginid:a.account||a.account_id,account_id:a.account_id||a.account})));
    closeMenu();
    // Get new OTP for switched account
    if(socket){ try{ socket.close(); }catch(e){} }
    _reconnects=0; _wsConnecting=false;
    await connect();
}

function populateMenuAccount(){
    const accounts = getAuthAccounts();
    if(accounts.length){
        buildAccountSwitcher(accounts.map(a=>({
            loginid:a.account||a.account_id, account_id:a.account_id||a.account,
            currency:a.currency, balance:a.balance||null,
            is_virtual:!a.isReal||a.account_type==='demo', account_type:a.account_type||(a.isReal?'real':'demo')
        })));
    } else {
        const el=document.getElementById('menu-loginid');
        if(el) el.textContent=getActiveAccount()||'—';
    }
    _updateMenuActions();
}

function _updateMenuActions(){
    const accounts=getAuthAccounts();
    const active=getActiveAccount();
    const activeAcc=accounts.find(a=>(a.account||a.account_id)===active);
    const isDemo=activeAcc?(activeAcc.account_type==='demo'||!activeAcc.isReal):false;
    const hasToken=!!getAuthToken();
    const resetEl=document.getElementById('menu-reset-demo');
    const cdemoEl=document.getElementById('menu-create-demo');
    const crealEl=document.getElementById('menu-create-real');
    const hasDemoAcc=accounts.some(a=>a.account_type==='demo'||!a.isReal);
    const hasRealAcc=accounts.some(a=>a.account_type==='real'||a.isReal);
    if(resetEl) resetEl.style.display=(isDemo&&hasToken)?'flex':'none';
    if(cdemoEl) cdemoEl.style.display=(!hasDemoAcc&&hasToken)?'flex':'none';
    if(crealEl) crealEl.style.display=(!hasRealAcc&&hasToken)?'flex':'none';
}

async function menuResetDemo(){
    closeMenu();
    const active=getActiveAccount();
    if(!active||active==='—'){ alert('No active demo account.'); return; }
    try{
        const r=await restResetDemoBalance(active);
        if(r) onBalanceUpdate({balance:r.balance,currency:r.currency,loginid:r.account_id||active});
        alert('✅ Balance reset to '+(r?r.balance+' '+r.currency:'done'));
    }catch(e){ alert('Reset failed: '+e.message); }
}

async function menuCreateAccount(type){
    closeMenu();
    try{
        const r=await restCreateAccount(type,'USD','row');
        if(r) alert('✅ '+type+' account created: '+r.account_id);
        const accounts=await restGetAccounts();
        if(accounts.length){
            const tok=getAuthToken();
            localStorage.setItem('deriv_accounts',JSON.stringify(accounts.map(a=>({
                account:a.account_id,account_id:a.account_id,currency:a.currency,
                balance:a.balance,isReal:a.account_type==='real',account_type:a.account_type,token:tok
            }))));
            populateMenuAccount();
        }
    }catch(e){ alert('Create failed: '+e.message); }
}

function logout(){
    if(socket&&socket.readyState===1) socket.close();
    clearAuth();
    document.getElementById('login-overlay').style.display='flex';
    document.getElementById('main-content').classList.remove('visible');
    document.getElementById('lo-acct-grid').style.display='none';
    document.getElementById('lo-acct-grid').innerHTML='';
    document.getElementById('lo-login-btn').style.display='flex';
    document.getElementById('lo-error').style.display='none';
    closeMenu();
}

function switchAccount(){ openMenu(); }

populateMenuAccount();

setupDigitGrid();
if(typeof _bootFlags !== 'undefined') _bootFlags[0] = true; // step 0: WS dialling
connect();
initTheme();