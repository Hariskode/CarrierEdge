export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Auth routes (always public) ──────────────────────────────
    if (path === '/login')                return handleLoginPage(request, env);
    if (path === '/api/auth/login')       return handleAuthLogin(request, env);
    if (path === '/api/auth/logout')      return handleAuthLogout(request);
    if (path === '/api/auth/check')       return handleAuthCheck(request, env);
    if (path === '/admin')                return handleAdminPage(request, env);
    if (path === '/api/admin/users' && request.method === 'GET')    return handleAdminListUsers(request, env);
    if (path === '/api/admin/users' && request.method === 'POST')   return handleAdminCreateUser(request, env);
    if (path === '/api/admin/users' && request.method === 'DELETE') return handleAdminDeleteUser(request, env);

    if (path === '/api/webhooks/lemonsqueezy' && request.method === 'POST') return handleLemonWebhook(request, env);
    if (path === '/activate')              return handleActivatePage(request, env);
    if (path === '/api/auth/activate' && request.method === 'POST') return handleActivate(request, env);
    if (path === '/set-password')          return handleSetPasswordPage(request, env);
    if (path === '/api/auth/set-password' && request.method === 'POST') return handleSetPassword(request, env);

    // ── Marketing root is public; signed-in members go straight to the app ──
    if (path === '/') {
      const session = await getSession(request, env);
      if (session) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': `${url.origin}/app`, 'Cache-Control': 'no-store, private' },
        });
      }
      // Public landing (index.html via assets / _redirects)
      return env.ASSETS.fetch(request);
    }

    // ── Gate app behind auth (served with no-cache to prevent CDN bypass) ──
    if (path === '/app.html' || path === '/app') {
      const session = await getSession(request, env);
      if (!session) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': `${url.origin}/login`, 'Cache-Control': 'no-store, private' },
        });
      }
      // Normalize /app → app.html so ASSETS always finds the suite
      const appReq = path === '/app'
        ? new Request(new URL('/app.html', url.origin), request)
        : request;
      const asset = await env.ASSETS.fetch(appReq);
      return new Response(asset.body, {
        status: asset.status,
        headers: { ...Object.fromEntries(asset.headers), 'Cache-Control': 'private, no-store' },
      });
    }

    // ── Gate API routes behind auth ───────────────────────────────
    if (path.startsWith('/api/')) {
      const session = await getSession(request, env);
      if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
    }

    // ── Standard routes ──────────────────────────────────────────
    if (path === '/api/fmcsa')  return handleFMCSA(url, env);
    if (path === '/api/credit') return handleCredit(url, env);
    if (path === '/api/news')   return handleNews(request);
    return env.ASSETS.fetch(request);
  }
};

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const ok   = (data)         => new Response(JSON.stringify(data), { headers: CORS });
const err  = (msg, status)  => new Response(JSON.stringify({ error: msg }), { status, headers: CORS });

// ── Auth helpers (JWT — zero KV writes for sessions) ──────────────────────────
const SESSION_TTL = 60 * 60 * 24 * 30;   // 30 days in seconds
const SESSION_MS  = SESSION_TTL * 1000;

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match  = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(token, maxAge) {
  return `ce_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// JWT helpers using Web Crypto (HMAC-SHA256, no libraries needed)
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const toB64url = str => b64url(new TextEncoder().encode(str));
const fromB64url = s => atob(s.replace(/-/g,'+').replace(/_/g,'/'));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
}

async function signJWT(payload, secret) {
  const h   = toB64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const p   = toB64url(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

async function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, sig] = parts;
    const key     = await hmacKey(secret);
    const sigBytes = Uint8Array.from(fromB64url(sig), c => c.charCodeAt(0));
    const valid   = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(fromB64url(p));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

async function pbkdf2Hash(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name:'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt:enc.encode(salt), iterations:100000, hash:'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyOwner(email, password, env) {
  return email.toLowerCase() === (env.OWNER_EMAIL||'').toLowerCase() && password === (env.OWNER_PASS||'');
}

async function createSession(env, email, role) {
  return signJWT({ email, role, exp: Date.now() + SESSION_MS }, env.SESSION_SECRET);
}

async function getSession(request, env) {
  const token = getCookie(request, 'ce_session');
  if (!token || !env.SESSION_SECRET) return null;
  return verifyJWT(decodeURIComponent(token), env.SESSION_SECRET);
}

async function requireOwner(request, env) {
  const session = await getSession(request, env);
  if (!session || session.role !== 'owner') return null;
  return session;
}

// ── /login ─────────────────────────────────────────────────────────────────────
async function handleLoginPage(request, env) {
  // If already logged in, send to app
  const session = await getSession(request, env);
  if (session) return Response.redirect(new URL(request.url).origin + '/app.html', 302);

  const error = new URL(request.url).searchParams.get('error') || '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CarrierEdge — Sign In</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c14;color:#c8d4e8;font-family:'Space Grotesk',system-ui,sans-serif;
       min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{width:100%;max-width:400px;background:#0d1424;border:1px solid #1a2a42;border-radius:16px;padding:40px 36px}
  .logo{display:flex;align-items:center;gap:12px;margin-bottom:32px}
  .chevrons{display:flex;gap:2px}
  .c1{width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:11px solid #1e3f63}
  .c2{width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:11px solid #1e4878}
  .c3{width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:11px solid #22d47a}
  .logo-text{font-size:20px;font-weight:300;color:#c8d4e8;letter-spacing:-.3px}
  .logo-text strong{font-weight:700;color:#22d47a}
  h1{font-size:15px;font-weight:600;color:#c8d4e8;margin-bottom:6px}
  .sub{font-size:12px;color:#44506e;margin-bottom:28px}
  label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6b7fa3;margin-bottom:6px}
  .fg{margin-bottom:18px}
  input{width:100%;background:#080c14;border:1px solid #1a2a42;border-radius:9px;padding:11px 14px;
        font-size:14px;color:#c8d4e8;outline:none;transition:border-color .15s;font-family:inherit}
  input:focus{border-color:#22d47a}
  .btn{width:100%;background:#22d47a;color:#080c14;border:none;border-radius:9px;padding:13px;
       font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;margin-top:4px}
  .btn:hover{opacity:.88}
  .error{background:rgba(240,84,84,.1);border:1px solid rgba(240,84,84,.2);border-radius:8px;
         padding:10px 14px;font-size:12px;color:#f05454;margin-bottom:20px}
  .footer{font-size:11px;color:#44506e;text-align:center;margin-top:24px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="chevrons"><div class="c1"></div><div class="c2"></div><div class="c3"></div></div>
    <div class="logo-text">Carrier<strong>Edge</strong></div>
  </div>
  <h1>Sign in to your account</h1>
  <p class="sub">Owner-operator tools, built for the road.</p>
  ${error ? `<div class="error">${error === 'invalid' ? 'Invalid email or password.' : error === 'expired' ? 'Your subscription has expired. Please renew to continue.' : 'Please sign in to continue.'}</div>` : ''}
  <form method="POST" action="/api/auth/login">
    <div class="fg"><label>Email</label><input type="email" name="email" required autofocus placeholder="you@example.com"></div>
    <div class="fg"><label>Password</label><input type="password" name="password" required placeholder="••••••••"></div>
    <button class="btn" type="submit">Sign In</button>
  </form>
  <div class="footer">CarrierEdge is a subscription service.<br>Paid but no login yet? <a href="/activate" style="color:#22d47a">Activate your license</a></div>
</div>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ── /api/auth/login ────────────────────────────────────────────────────────────
async function handleAuthLogin(request, env) {
  const origin = new URL(request.url).origin;
  let email, password;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const body = await request.json();
    email = (body.email || '').toLowerCase().trim();
    password = body.password || '';
  } else {
    const form = await request.formData();
    email    = (form.get('email')    || '').toLowerCase().trim();
    password =  form.get('password') || '';
  }

  if (!email || !password) return Response.redirect(`${origin}/login?error=invalid`, 302);

  // Owner check (plaintext secret — no KV needed)
  if (await verifyOwner(email, password, env)) {
    const token = await createSession(env, email, 'owner');
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/app.html`, 'Set-Cookie': sessionCookie(token, SESSION_TTL) },
    });
  }

  // Subscriber check
  const raw = await env.CE_AUTH.get('user:' + email);
  if (!raw) return Response.redirect(`${origin}/login?error=invalid`, 302);
  const user = JSON.parse(raw);
  if (!user.passwordHash || !user.salt) {
    return Response.redirect(`${origin}/activate`, 302);
  }

  const hash = await pbkdf2Hash(password, user.salt);
  if (hash !== user.passwordHash) return Response.redirect(`${origin}/login?error=invalid`, 302);

  // Check subscription expiry
  if (user.subExpiry && Date.now() > new Date(user.subExpiry).getTime()) {
    return Response.redirect(`${origin}/login?error=expired`, 302);
  }

  const token = await createSession(env, email, 'subscriber');
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/app.html`, 'Set-Cookie': sessionCookie(token, SESSION_TTL) },
  });
}

// ── /api/auth/logout ───────────────────────────────────────────────────────────
async function handleAuthLogout(request) {
  const origin = new URL(request.url).origin;
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/login`, 'Set-Cookie': sessionCookie('', 0) },
  });
}

// ── /api/auth/check ────────────────────────────────────────────────────────────
async function handleAuthCheck(request, env) {
  const session = await getSession(request, env);
  if (!session) return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: CORS });
  return ok({ authenticated: true, email: session.email, role: session.role });
}

// ── /admin ─────────────────────────────────────────────────────────────────────
async function handleAdminPage(request, env) {
  const owner = await requireOwner(request, env);
  const origin = new URL(request.url).origin;
  if (!owner) return Response.redirect(`${origin}/login`, 302);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CarrierEdge — Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c14;color:#c8d4e8;font-family:'Space Grotesk',system-ui,sans-serif;padding:32px 24px}
  h1{font-size:18px;font-weight:700;margin-bottom:4px}
  .sub{font-size:12px;color:#44506e;margin-bottom:32px}
  .card{background:#0d1424;border:1px solid #1a2a42;border-radius:13px;padding:24px;margin-bottom:24px}
  .card-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6b7fa3;margin-bottom:16px}
  label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7fa3;margin-bottom:5px}
  .fg{margin-bottom:14px}
  input{width:100%;max-width:340px;background:#080c14;border:1px solid #1a2a42;border-radius:8px;
        padding:9px 12px;font-size:13px;color:#c8d4e8;outline:none;font-family:inherit}
  input:focus{border-color:#22d47a}
  .btn{background:#22d47a;color:#080c14;border:none;border-radius:8px;padding:9px 18px;
       font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .btn-red{background:rgba(240,84,84,.15);color:#f05454;border:1px solid rgba(240,84,84,.2)}
  .btn-ghost{background:transparent;color:#44506e;border:1px solid #1a2a42}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#44506e;border-bottom:1px solid #1a2a42}
  td{padding:10px;border-bottom:1px solid #0d1424;color:#c8d4e8}
  .badge{font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:10px;letter-spacing:.06em}
  .badge-owner{background:rgba(34,212,122,.12);color:#22d47a}
  .badge-sub{background:rgba(74,143,255,.12);color:#4a8fff}
  .badge-exp{background:rgba(240,84,84,.12);color:#f05454}
  .toast{position:fixed;top:20px;right:20px;background:#1a2a42;border:1px solid #22d47a;border-radius:9px;
         padding:10px 16px;font-size:13px;font-weight:600;display:none}
  a.back{font-size:12px;color:#4a8fff;text-decoration:none;display:inline-block;margin-bottom:24px}
  .logout{float:right;font-size:12px;color:#44506e;text-decoration:none}
</style>
</head>
<body>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
  <h1>CarrierEdge Admin</h1>
  <a class="logout" href="/api/auth/logout">Sign out</a>
</div>
<div class="sub">Subscriber management · Signed in as ${owner.email}</div>
<a class="back" href="/app.html">← Back to app</a>

<div class="card">
  <div class="card-title">Add Subscriber</div>
  <div class="fg"><label>Email</label><input type="email" id="new-email" placeholder="subscriber@example.com"></div>
  <div class="fg"><label>Password</label><input type="password" id="new-pass" placeholder="Set initial password"></div>
  <div class="fg"><label>Annual Expiry</label><input type="date" id="new-expiry"></div>
  <button class="btn" onclick="createUser()">Add Subscriber</button>
</div>

<div class="card">
  <div class="card-title">Active Subscribers</div>
  <table>
    <thead><tr><th>Email</th><th>Role</th><th>Expiry</th><th></th></tr></thead>
    <tbody id="user-list"><tr><td colspan="4" style="color:#44506e">Loading…</td></tr></tbody>
  </table>
</div>

<div class="toast" id="toast"></div>

<script>
function toast(msg, ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  t.style.borderColor=ok?'#22d47a':'#f05454';
  setTimeout(()=>t.style.display='none',3000);
}
async function loadUsers(){
  const r=await fetch('/api/admin/users');
  const d=await r.json();
  const tb=document.getElementById('user-list');
  if(!d.users||!d.users.length){tb.innerHTML='<tr><td colspan="4" style="color:#44506e">No subscribers yet.</td></tr>';return;}
  tb.innerHTML=d.users.map(u=>{
    const exp=u.subExpiry?new Date(u.subExpiry).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
    const expired=u.subExpiry&&Date.now()>new Date(u.subExpiry).getTime();
    const badge=u.role==='owner'?'<span class="badge badge-owner">Owner</span>':expired?'<span class="badge badge-exp">Expired</span>':'<span class="badge badge-sub">Active</span>';
    const del=u.role==='owner'?'':\`<button class="btn btn-red" style="padding:4px 10px;font-size:11px" onclick="deleteUser('\${u.email}')">Revoke</button>\`;
    return \`<tr><td>\${u.email}</td><td>\${badge}</td><td>\${exp}</td><td>\${del}</td></tr>\`;
  }).join('');
}
async function createUser(){
  const email=document.getElementById('new-email').value.trim();
  const pass=document.getElementById('new-pass').value;
  const expiry=document.getElementById('new-expiry').value;
  if(!email||!pass){toast('Email and password required.',false);return;}
  const r=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass,subExpiry:expiry||null})});
  const d=await r.json();
  if(d.error){toast(d.error,false);}else{toast('Subscriber added.');document.getElementById('new-email').value='';document.getElementById('new-pass').value='';loadUsers();}
}
async function deleteUser(email){
  if(!confirm('Revoke access for '+email+'?'))return;
  const r=await fetch('/api/admin/users',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  const d=await r.json();
  d.error?toast(d.error,false):toast('Access revoked.');
  loadUsers();
}
// Default expiry to 1 year from today
const d=new Date(); d.setFullYear(d.getFullYear()+1);
document.getElementById('new-expiry').value=d.toISOString().split('T')[0];
loadUsers();
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

// ── /api/admin/users GET ───────────────────────────────────────────────────────
async function handleAdminListUsers(request, env) {
  if (!await requireOwner(request, env)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  const list = await env.CE_AUTH.list({ prefix: 'user:' });
  const users = await Promise.all(list.keys.map(async k => {
    const raw = await env.CE_AUTH.get(k.name);
    const u   = JSON.parse(raw);
    return { email: u.email, role: u.role, subExpiry: u.subExpiry };
  }));
  return ok({ users });
}

// ── /api/admin/users POST ──────────────────────────────────────────────────────
async function handleAdminCreateUser(request, env) {
  if (!await requireOwner(request, env)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  const { email, password, subExpiry } = await request.json();
  if (!email || !password) return err('email and password required', 400);
  const norm = email.toLowerCase().trim();
  const salt = crypto.randomUUID();
  const passwordHash = await pbkdf2Hash(password, salt);
  await env.CE_AUTH.put('user:' + norm, JSON.stringify({
    email: norm, passwordHash, salt, role: 'subscriber',
    subExpiry: subExpiry || null, createdAt: new Date().toISOString(),
  }));
  return ok({ ok: true });
}

// ── /api/admin/users DELETE ────────────────────────────────────────────────────
async function handleAdminDeleteUser(request, env) {
  if (!await requireOwner(request, env)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: CORS });
  const { email } = await request.json();
  if (!email) return err('email required', 400);
  await env.CE_AUTH.delete('user:' + email.toLowerCase().trim());
  return ok({ ok: true });
}


// ── Lemon Squeezy webhook + self-serve activation ─────────────────────────────
// Secrets (Cloudflare dashboard only — never commit values):
//   LEMONSQUEEZY_WEBHOOK_SECRET  — signing secret from LS webhook settings
//   LEMONSQUEEZY_API_KEY         — optional; license validate often works with key alone
const SET_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

function authPageShell(title, bodyInner) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CarrierEdge — ${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#080c14;color:#c8d4e8;font-family:'Space Grotesk',system-ui,sans-serif;
       min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{width:100%;max-width:420px;background:#0d1424;border:1px solid #1a2a42;border-radius:16px;padding:40px 36px}
  h1{font-size:15px;font-weight:600;margin-bottom:6px}
  .sub{font-size:12px;color:#44506e;margin-bottom:28px}
  label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#6b7fa3;margin-bottom:6px}
  .fg{margin-bottom:18px}
  input{width:100%;background:#080c14;border:1px solid #1a2a42;border-radius:9px;padding:11px 14px;
        font-size:14px;color:#c8d4e8;outline:none;font-family:inherit}
  input:focus{border-color:#22d47a}
  .btn{width:100%;background:#22d47a;color:#080c14;border:none;border-radius:9px;padding:13px;
       font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px}
  .error{background:rgba(240,84,84,.1);border:1px solid rgba(240,84,84,.2);border-radius:8px;
         padding:10px 14px;font-size:12px;color:#f05454;margin-bottom:20px}
  .ok{background:rgba(34,212,122,.1);border:1px solid rgba(34,212,122,.25);border-radius:8px;
      padding:10px 14px;font-size:12px;color:#22d47a;margin-bottom:20px}
  a{color:#22d47a}
  .footer{font-size:11px;color:#44506e;text-align:center;margin-top:24px}
</style></head><body><div class="card">${bodyInner}</div></body></html>`;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyLemonSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const digest = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (digest.length !== signature.length) return false;
  let okv = 0;
  for (let i = 0; i < digest.length; i++) okv |= digest.charCodeAt(i) ^ signature.charCodeAt(i);
  return okv === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function upsertSubscriberFromLemon(env, { email, subExpiry, lsCustomerId, lsSubscriptionId, lsLicenseKey, issueSetPassword }) {
  const norm = (email || '').toLowerCase().trim();
  if (!norm || !norm.includes('@')) return null;
  const existingRaw = await env.CE_AUTH.get('user:' + norm);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  let setPasswordToken = null;
  let setPasswordTokenHash = existing?.setPasswordTokenHash || null;
  let setPasswordExpires = existing?.setPasswordExpires || null;
  const needsPassword = !existing?.passwordHash;
  if (issueSetPassword && needsPassword) {
    setPasswordToken = randomToken();
    setPasswordTokenHash = await sha256Hex(setPasswordToken);
    setPasswordExpires = new Date(Date.now() + SET_PASSWORD_TTL_MS).toISOString();
  }
  const user = {
    email: norm,
    passwordHash: existing?.passwordHash || null,
    salt: existing?.salt || null,
    role: 'subscriber',
    subExpiry: subExpiry || existing?.subExpiry || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    lsCustomerId: lsCustomerId || existing?.lsCustomerId || null,
    lsSubscriptionId: lsSubscriptionId || existing?.lsSubscriptionId || null,
    lsLicenseKey: lsLicenseKey || existing?.lsLicenseKey || null,
    setPasswordTokenHash: needsPassword ? setPasswordTokenHash : null,
    setPasswordExpires: needsPassword ? setPasswordExpires : null,
  };
  await env.CE_AUTH.put('user:' + norm, JSON.stringify(user));
  return { email: norm, setPasswordToken, needsPassword: !!needsPassword && !existing?.passwordHash };
}

function extractLemonEmail(data) {
  const attrs = data?.attributes || {};
  return (
    attrs.user_email ||
    attrs.customer_email ||
    attrs.email ||
    data?.meta?.custom_data?.email ||
    ''
  );
}

function extractLemonExpiry(data) {
  const attrs = data?.attributes || {};
  return attrs.renews_at || attrs.ends_at || attrs.trial_ends_at || attrs.created_at || null;
}

async function handleLemonWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('X-Signature') || '';
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
  if (!(await verifyLemonSignature(rawBody, signature, secret))) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: CORS });
  }
  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400, headers: CORS });
  }
  const eventName = request.headers.get('X-Event-Name') || payload?.meta?.event_name || '';
  const data = payload?.data || {};
  const email = extractLemonEmail(data).toLowerCase().trim();
  const attrs = data?.attributes || {};

  if (['subscription_created', 'order_created'].includes(eventName)) {
    const result = await upsertSubscriberFromLemon(env, {
      email,
      subExpiry: extractLemonExpiry(data),
      lsCustomerId: String(attrs.customer_id || attrs.user_id || ''),
      lsSubscriptionId: data?.id ? String(data.id) : '',
      lsLicenseKey: attrs.license_key || null,
      issueSetPassword: true,
    });
    return ok({ ok: true, event: eventName, email: result?.email || null, needsPassword: !!result?.setPasswordToken });
  }

  if (['subscription_payment_success', 'subscription_updated'].includes(eventName)) {
    if (email) {
      await upsertSubscriberFromLemon(env, {
        email,
        subExpiry: extractLemonExpiry(data),
        lsCustomerId: String(attrs.customer_id || ''),
        lsSubscriptionId: data?.id ? String(data.id) : '',
        issueSetPassword: false,
      });
    }
    return ok({ ok: true, event: eventName });
  }

  if (['subscription_cancelled', 'subscription_expired', 'subscription_payment_failed'].includes(eventName)) {
    if (email) {
      const raw = await env.CE_AUTH.get('user:' + email);
      if (raw) {
        const user = JSON.parse(raw);
        if (eventName !== 'subscription_payment_failed') {
          user.subExpiry = new Date().toISOString();
        }
        user.lsStatus = eventName;
        await env.CE_AUTH.put('user:' + email, JSON.stringify(user));
      }
    }
    return ok({ ok: true, event: eventName });
  }

  if (eventName === 'license_key_created' || eventName.includes('license')) {
    if (email) {
      await upsertSubscriberFromLemon(env, {
        email,
        lsLicenseKey: attrs.key || attrs.license_key || null,
        issueSetPassword: false,
      });
    }
    return ok({ ok: true, event: eventName });
  }

  return ok({ ok: true, event: eventName, ignored: true });
}

async function handleActivatePage(request, env) {
  const session = await getSession(request, env);
  if (session) return Response.redirect(new URL(request.url).origin + '/app.html', 302);
  const errQ = new URL(request.url).searchParams.get('error') || '';
  const body = `
  <h1>Activate your membership</h1>
  <p class="sub">Paid on Lemon Squeezy? Enter the email on your receipt and your license key. No founder action needed.</p>
  ${errQ ? `<div class="error">${errQ === 'invalid' ? 'Could not validate that license for this email.' : errQ === 'missing' ? 'Email and license key are required.' : 'Activation failed. Try again or contact support.'}</div>` : ''}
  <form method="POST" action="/api/auth/activate">
    <div class="fg"><label>Email (on your Lemon Squeezy receipt)</label><input type="email" name="email" required autofocus placeholder="you@example.com"></div>
    <div class="fg"><label>License key</label><input type="text" name="license_key" required placeholder="XXXXX-XXXXX-XXXXX-XXXXX"></div>
    <button class="btn" type="submit">Activate →</button>
  </form>
  <div class="footer"><a href="/login">Already have a password? Sign in</a> · <a href="/pricing">Buy membership</a></div>`;
  return new Response(authPageShell('Activate', body), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

async function validateLicenseKeyServer(licenseKey, env) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (env.LEMONSQUEEZY_API_KEY) headers['Authorization'] = 'Bearer ' + env.LEMONSQUEEZY_API_KEY;
  const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ license_key: licenseKey }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: data?.valid === true, data };
}

async function handleActivate(request, env) {
  const origin = new URL(request.url).origin;
  let email, licenseKey;
  const ct = request.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    const body = await request.json();
    email = (body.email || '').toLowerCase().trim();
    licenseKey = (body.license_key || body.licenseKey || '').trim();
  } else {
    const form = await request.formData();
    email = (form.get('email') || '').toLowerCase().trim();
    licenseKey = (form.get('license_key') || '').trim();
  }
  if (!email || !licenseKey) return Response.redirect(`${origin}/activate?error=missing`, 302);

  let licenseOk = false;
  try {
    const v = await validateLicenseKeyServer(licenseKey, env);
    licenseOk = v.ok;
  } catch (_) {
    licenseOk = false;
  }
  if (!licenseOk) return Response.redirect(`${origin}/activate?error=invalid`, 302);

  const result = await upsertSubscriberFromLemon(env, {
    email,
    lsLicenseKey: licenseKey,
    subExpiry: new Date(Date.now() + 30 * 86400000).toISOString(),
    issueSetPassword: true,
  });

  if (result?.setPasswordToken) {
    return Response.redirect(`${origin}/set-password?token=${encodeURIComponent(result.setPasswordToken)}&email=${encodeURIComponent(email)}`, 302);
  }
  return Response.redirect(`${origin}/login`, 302);
}

async function handleSetPasswordPage(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();
  const error = url.searchParams.get('error') || '';
  const safeToken = token.replace(/[^a-zA-Z0-9]/g, '');
  const safeEmail = email.replace(/[^a-zA-Z0-9@._+-]/g, '');
  const body = `
  <h1>Set your password</h1>
  <p class="sub">Create a password to sign in to CarrierEdge. This link expires in 24 hours.</p>
  ${error === 'invalid' ? `<div class="error">Invalid or expired link. <a href="/activate">Activate again</a>.</div>` : ''}
  ${error === 'weak' ? `<div class="error">Password must be at least 8 characters.</div>` : ''}
  <form method="POST" action="/api/auth/set-password">
    <input type="hidden" name="token" value="${safeToken}">
    <div class="fg"><label>Email</label><input type="email" name="email" required value="${safeEmail}" placeholder="you@example.com"></div>
    <div class="fg"><label>New password</label><input type="password" name="password" required minlength="8" placeholder="At least 8 characters" autofocus></div>
    <button class="btn" type="submit">Save & enter CarrierEdge →</button>
  </form>
  <div class="footer"><a href="/login">Back to sign in</a></div>`;
  return new Response(authPageShell('Set password', body), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

async function handleSetPassword(request, env) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const email = (form.get('email') || '').toLowerCase().trim();
  const password = form.get('password') || '';
  const token = form.get('token') || '';
  if (!email || !token) return Response.redirect(`${origin}/set-password?error=invalid`, 302);
  if (password.length < 8) {
    return Response.redirect(`${origin}/set-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=weak`, 302);
  }

  const raw = await env.CE_AUTH.get('user:' + email);
  if (!raw) return Response.redirect(`${origin}/set-password?error=invalid`, 302);
  const user = JSON.parse(raw);
  const tokenHash = await sha256Hex(token);
  if (!user.setPasswordTokenHash || user.setPasswordTokenHash !== tokenHash) {
    return Response.redirect(`${origin}/set-password?error=invalid`, 302);
  }
  if (user.setPasswordExpires && Date.now() > new Date(user.setPasswordExpires).getTime()) {
    return Response.redirect(`${origin}/set-password?error=invalid`, 302);
  }

  const salt = crypto.randomUUID();
  const passwordHash = await pbkdf2Hash(password, salt);
  user.passwordHash = passwordHash;
  user.salt = salt;
  user.setPasswordTokenHash = null;
  user.setPasswordExpires = null;
  await env.CE_AUTH.put('user:' + email, JSON.stringify(user));

  const sessionToken = await createSession(env, email, 'subscriber');
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/app`, 'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL) },
  });
}


// ── /api/news — server-side RSS proxy (no CORS, no rate limits) ───────────────
const NEWS_FEEDS = [
  { url: 'https://www.freightwaves.com/news/feed',  name: 'FreightWaves', key: 'fw', cls: 'news-src-fw', tags: ['market','freight'] },
  { url: 'https://www.overdriveonline.com/feed/',   name: 'Overdrive',    key: 'od', cls: 'news-src-od', tags: ['ops','owner-operator'] },
  { url: 'https://landline.media/feed/',            name: 'Land Line',    key: 'll', cls: 'news-src-ll', tags: ['reg','safety'] },
  { url: 'https://www.truckersnews.com/feed/',      name: 'Truckers News',key: 'tn', cls: 'news-src-tn', tags: ['ops','market'] },
];

async function handleNews() {
  const results = await Promise.allSettled(NEWS_FEEDS.map(src => fetchFeed(src)));
  const articles = [];
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
  }
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  return ok({ articles, fetchedAt: Date.now() });
}

async function fetchFeed(src) {
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'CarrierEdge/1.0 RSS Reader', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    cf: { cacheTtl: 1800, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
  return parseRSS(await res.text(), src);
}

function parseRSS(xml, src) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block   = m[1];
    const title   = extractRSSTag(block, 'title');
    const link    = extractRSSTag(block, 'link') || extractRSSTag(block, 'guid');
    const desc    = extractRSSTag(block, 'description');
    const pubDate = extractRSSTag(block, 'pubDate');
    const guid    = extractRSSTag(block, 'guid') || link;
    if (!title || !link) continue;
    items.push({
      id:      guid,
      source:  src.name,
      srcId:   src.key,
      srcCls:  src.cls,
      tags:    src.tags,
      title:   stripRSS(title).slice(0, 200),
      excerpt: stripRSS(desc).slice(0, 220),
      link:    link.startsWith('http') ? link : `https://${link}`,
      date:    pubDate,
    });
  }
  return items;
}

function extractRSSTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function stripRSS(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,"'").replace(/&quot;/g,'"')
    .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,'')
    .replace(/\s+/g,' ').trim();
}

// ── /api/fmcsa — FMCSA Rating page (DOT) + credit check fallback ──────────────
async function handleFMCSA(url, env) {
  const mc     = (url.searchParams.get('mc')   || '').replace(/\D/g, '');
  const name   = url.searchParams.get('name')  || '';
  const dot    = (url.searchParams.get('dot')  || '').replace(/\D/g, '');
  const webKey = env.FMCSA_KEY;

  if (!webKey) return err('FMCSA_KEY not configured', 500);

  // DOT lookup for the FMCSA Rating page
  if (dot) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return err('FMCSA returned ' + res.status, res.status);
      return new Response(await res.text(), { headers: CORS });
    } catch (e) { return err(e.message, 502); }
  }

  // MC + name lookup for credit check
  let primary = null, alternatives = [];
  if (mc) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/${mc}?webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const j = await res.json();
        const c = j?.content?.carrier || j?.content;
        if (c && (c.dotNumber || c.legalName)) primary = c;
      }
    } catch (_) {}
  }
  if (name) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers?name=${encodeURIComponent(name)}&start=0&size=6&webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const j = await res.json();
        const list = j?.content?.Carrier || j?.content || [];
        alternatives = (Array.isArray(list) ? list : [list]).filter(Boolean);
        if (!primary && alternatives.length) primary = alternatives[0];
      }
    } catch (_) {}
  }

  return ok({ primary, alternatives });
}

// ── /api/credit — unified credit check: all bureaus in one server-side call ───
async function handleCredit(url, env) {
  const mc   = (url.searchParams.get('mc')   || '').replace(/\D/g, '');
  const name = url.searchParams.get('name')  || '';
  if (!name && !mc) return err('name or mc required', 400);

  const [fmcsa, ansonia, dnb, experian, c411, openCorp] = await Promise.allSettled([
    callFMCSA(mc, name, env),
    callAnsonia(name, mc, env),
    callDnB(name, env),
    callExperian(name, env),
    callCarrier411(mc, env),
    callOpenCorporates(name, env),
  ]);

  return ok({
    fmcsa:    fmcsa.status    === 'fulfilled' ? fmcsa.value    : null,
    ansonia:  ansonia.status  === 'fulfilled' ? ansonia.value  : null,
    dnb:      dnb.status      === 'fulfilled' ? dnb.value      : null,
    experian: experian.status === 'fulfilled' ? experian.value : null,
    c411:     c411.status     === 'fulfilled' ? c411.value     : null,
    openCorp: openCorp.status === 'fulfilled' ? openCorp.value : null,
  });
}

// ── Bureau functions ───────────────────────────────────────────────────────────
async function callFMCSA(mc, name, env) {
  const webKey = env.FMCSA_KEY;
  if (!webKey) return null;
  let primary = null, alternatives = [];

  if (mc) {
    const res = await fetch(
      `https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/${mc}?webKey=${webKey}`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const j = await res.json();
      const c = j?.content?.carrier || j?.content;
      if (c && (c.dotNumber || c.legalName)) primary = c;
    }
  }
  if (name) {
    const res = await fetch(
      `https://mobile.fmcsa.dot.gov/qc/services/carriers?name=${encodeURIComponent(name)}&start=0&size=6&webKey=${webKey}`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const j = await res.json();
      const list = j?.content?.Carrier || j?.content || [];
      alternatives = (Array.isArray(list) ? list : [list]).filter(Boolean);
      if (!primary && alternatives.length) primary = alternatives[0];
    }
  }
  if (!primary && !alternatives.length) return null;
  return { primary, alternatives };
}

async function callAnsonia(companyName, mcNumber, env) {
  const key = env.ANSONIA_KEY;
  if (!key) return null;
  const res = await fetch('https://api.ansoniabd.com/v1/credit/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName, mcNumber, industry: 'FREIGHT' }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return {
    score:      j?.data?.creditScore        || null,
    avgDaysPay: j?.data?.avgDaysBeyondTerms || null,
    riskClass:  j?.data?.riskClass          || null,
    tradeLines: j?.data?.tradeLineCount     || null,
  };
}

async function callDnB(companyName, env) {
  const clientId     = env.DNB_CLIENT_ID;
  const clientSecret = env.DNB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokenRes = await fetch('https://plus.dnb.com/v2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(clientId + ':' + clientSecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  if (!tokenRes.ok) return null;
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(
    `https://plus.dnb.com/v1/search/companyList?searchTerm=${encodeURIComponent(companyName)}&countryISOAlpha2Code=US&pageSize=1`,
    { headers: { Authorization: 'Bearer ' + access_token } }
  );
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const duns = searchData?.searchCandidates?.[0]?.organization?.duns;
  if (!duns) return null;

  const creditRes = await fetch(
    `https://plus.dnb.com/v1/data/duns/${duns}?productId=cmpelk&versionId=v2`,
    { headers: { Authorization: 'Bearer ' + access_token } }
  );
  if (!creditRes.ok) return null;
  const creditData = await creditRes.json();
  return {
    duns,
    paydex:       creditData?.organization?.businessTrading?.paydex?.score || null,
    failureScore: creditData?.organization?.businessTrading?.delinquencyScore?.nationalPercentile || null,
    companyName:  searchData?.searchCandidates?.[0]?.organization?.primaryName || companyName,
    yearsInBiz:   creditData?.organization?.startDate
      ? (2026 - parseInt(creditData.organization.startDate.split('-')[0])) : null,
  };
}

async function callExperian(companyName, env) {
  const key = env.EXPERIAN_KEY;
  if (!key) return null;
  const searchRes = await fetch(
    `https://us-api.experian.com/businessinformation/businesses/v1/search?name=${encodeURIComponent(companyName)}&geo=true`,
    { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } }
  );
  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const bin = data?.results?.[0]?.bin;
  if (!bin) return null;

  const creditRes = await fetch(
    `https://us-api.experian.com/businessinformation/businesses/v1/creditreport?bin=${bin}`,
    { headers: { Authorization: 'Bearer ' + key } }
  );
  if (!creditRes.ok) return null;
  const cd = await creditRes.json();
  const startDate = cd?.businessProfile?.businessStartDate || null;
  return {
    bin,
    intelliScore: cd?.intelliScore?.score         || null,
    fsrScore:     cd?.fsrScore?.score             || null,
    paymentIndex: cd?.paymentTrends?.paymentIndex || null,
    bankruptcy:   (cd?.publicRecords?.bankruptcy?.filingCount || 0) > 0,
    liens:        (cd?.publicRecords?.taxLien?.filingCount    || 0) > 0,
    yearsInBiz:   cd?.businessProfile?.yearsInBusiness
               || (startDate ? (2026 - parseInt(startDate.split('-')[0])) : null),
  };
}

async function callOpenCorporates(companyName, env) {
  const key = env.OPENCORPORATES_KEY;
  const params = new URLSearchParams({ q: companyName, jurisdiction_code: 'us', per_page: '1', order: 'score' });
  if (key) params.set('api_token', key);
  const res = await fetch(`https://api.opencorporates.com/v0.4/companies/search?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'CarrierEdge/1.0' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const co = data?.results?.companies?.[0]?.company;
  if (!co) return null;
  const incDate = co.incorporation_date || null;
  const incYear = incDate ? parseInt(incDate.split('-')[0]) : null;
  return {
    incorporationYear: incYear,
    incorporationDate: incDate,
    jurisdiction:      co.jurisdiction_code  || null,
    companyType:       co.company_type       || null,
    active:            !co.dissolution_date,
  };
}

async function callCarrier411(mcNumber, env) {
  const key = env.CARRIER411_KEY;
  if (!key || !mcNumber) return null;
  const res = await fetch(`https://www.carrier411.com/api/v2/carrier?mc=${mcNumber}&key=${key}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    grade:           data?.safetyRating    || null,
    authorityStatus: data?.authorityStatus || null,
    bondStatus:      data?.bondStatus      || null,
    watchlisted:     data?.watchlisted     || false,
    alerts:          data?.alerts          || [],
  };
}
