const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(n||0));
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function showToast(message){
  let el=document.getElementById('app-showToast');
  if(!el){
    el=document.createElement('div');
    el.id='app-showToast';
    el.style.cssText='position:fixed;right:20px;bottom:20px;z-index:99999;max-width:min(420px,calc(100vw - 40px));padding:12px 16px;background:#172033;color:#fff;border:1px solid #c6a75e;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.25);font-size:14px;';
    document.body.appendChild(el);
  }
  el.textContent=String(message??'');
  el.style.display='block';
  if(el._hideTimer) clearTimeout(el._hideTimer);
  el._hideTimer=setTimeout(()=>{el.style.display='none';},3500);
}
let currentUser=null, customers=[], companies=[], orders=[];
const ADMIN_ROLE='Administrator';
const ENTRY_ROLE='Auftragserfassung';
function isAdmin(){return currentUser?.rolle===ADMIN_ROLE;}
function isEntryUser(){return currentUser?.rolle===ENTRY_ROLE;}
function canPage(page){return isAdmin() || (isEntryUser() && page==='order-entry');}
function applyRoleUI(){
  document.querySelectorAll('.admin-only').forEach(b=>b.classList.toggle('hidden',!isAdmin()));
  document.querySelectorAll('.nav').forEach(b=>{
    const allowed=(isAdmin() && b.dataset.page!=='reports') || (isEntryUser() && b.dataset.page==='order-entry');
    b.classList.toggle('hidden',!allowed);
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  $('#loginForm').addEventListener('submit', login);
  $('#logoutBtn').addEventListener('click', logout);
  // Provisionen und Monats-/Jahresabrechnung werden in einem Bereich zusammengeführt.
  const commissionNav=document.querySelector('.nav[data-page="commissions"]');
  const reportsNav=document.querySelector('.nav[data-page="reports"]');
  if(commissionNav){commissionNav.dataset.page='finance';commissionNav.textContent='Firmen & Abrechnung';}
  if(reportsNav)reportsNav.classList.add('hidden');
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>navigate(b.dataset.page));

  // Beim Laden ausschließlich eine echte Supabase-Sitzung wiederherstellen.
  const {data:{session},error}=await db.auth.getSession();
  if(error) console.error('Supabase-Sitzung konnte nicht gelesen werden:',error.message);
  if(session?.user) await loadCurrentUser();
  else { currentUser=null; renderAuth(); }

  // Wenn die Sitzung endet, geschützte Ansicht schließen.
  db.auth.onAuthStateChange((event, sessionNow)=>{
    if(event==='SIGNED_OUT' || !sessionNow){
      currentUser=null;
      renderAuth();
    }
  });
});

async function loadCurrentUser(){
  const {data:{user:authUser},error:authError}=await db.auth.getUser();
  if(authError || !authUser){
    currentUser=null;
    renderAuth();
    return false;
  }
  const {data,error}=await db.rpc('vermittlung_current_user');
  if(error){
    console.error('Benutzerprofil konnte nicht geladen werden:',error.message);
    currentUser=null;
    renderAuth();
    return false;
  }
  const profile=Array.isArray(data)?data[0]:data;
  if(!profile || !profile.id || !profile.rolle){
    await db.auth.signOut();
    currentUser=null;
    renderAuth();
    $('#loginMsg').textContent='Für dieses Konto ist kein aktiver App-Benutzer hinterlegt. Bitte Administrator kontaktieren.';
    return false;
  }
  currentUser={id:profile.id,name:profile.name,email:profile.email,rolle:profile.rolle,authUserId:authUser.id};
  renderAuth();
  return true;
}

async function login(e){
  e.preventDefault();
  $('#loginMsg').textContent='';
  const email=$('#email').value.trim();
  const password=$('#password').value;
  if(!email||!password){
    $('#loginMsg').textContent='Bitte E-Mail und Passwort eingeben.';
    return;
  }
  const submit=$('#loginForm').querySelector('button[type="submit"]');
  if(submit) submit.disabled=true;
  try{
    const {error}=await db.auth.signInWithPassword({email,password});
    if(error){
      $('#loginMsg').textContent='Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.';
      console.error('Supabase-Anmeldung fehlgeschlagen:',error.message);
      return;
    }
    const ok=await loadCurrentUser();
    if(!ok) await db.auth.signOut();
  }catch(err){
    $('#loginMsg').textContent='Anmeldung derzeit nicht möglich. Bitte Verbindung prüfen.';
    console.error(err);
  }finally{
    if(submit) submit.disabled=false;
  }
}

async function logout(){
  const {error}=await db.auth.signOut();
  if(error){
    alert('Abmeldung fehlgeschlagen: '+error.message);
    return;
  }
  currentUser=null;
  renderAuth();
}

function renderAuth(){
  if(currentUser){
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userName').textContent=(currentUser.name||currentUser.email||'') + (currentUser.rolle ? ' · '+currentUser.rolle : '');
    applyRoleUI();
    const savedPage=localStorage.getItem('vermittlung_current_page')||'dashboard';
    navigate(isEntryUser() ? 'order-entry' : (canPage(savedPage)?savedPage:'dashboard'));
  }else{
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }
}

let periodAccounts=[];
async function loadBase(){const [c,f,o,a]=await Promise.all([db.from('vermittlung_kunden').select('*').order('nachname'),db.from('vermittlung_firmen').select('*').order('firmenname'),db.from('vermittlung_auftraege').select('*').order('erstellt_am',{ascending:false}),db.from('vermittlung_auftragsabrechnungen').select('*').order('abrechnungsmonat',{ascending:false})]);customers=c.data||[];companies=f.data||[];orders=o.data||[];periodAccounts=a.error?[]:(a.data||[]);if(a.error&& !String(a.error.message||'').includes('does not exist'))console.warn('Abrechnungsperioden konnten nicht geladen werden:',a.error.message);}
const GOOGLE_SYNC_URL_KEY='vermittlung_google_sync_url';
const GOOGLE_SYNC_TOKEN_KEY='vermittlung_google_sync_token';
function googleSyncUrl(){return localStorage.getItem(GOOGLE_SYNC_URL_KEY)||''}
function googleSyncToken(){return localStorage.getItem(GOOGLE_SYNC_TOKEN_KEY)||''}
function renderGoogle(){
  const url=googleSyncUrl(), token=googleSyncToken();
  $('#main').innerHTML=page('Google Drive / Sheets',`
    <div class="panel">
      <h3>Google-Verbindung</h3>
      <p class="muted">Die Daten bleiben in Supabase zentral gespeichert. Über den Google-Apps-Script-Anschluss werden Aufträge, Kunden, Firmen, Provisionen und Dokumentationsdaten in Google Sheets synchronisiert und die Auftragsordner in Google Drive angelegt.</p>
      <form id="googleForm" class="form-grid">
        <label class="full">Apps-Script-Web-App-URL
          <input name="url" type="url" required placeholder="https://script.google.com/macros/s/.../exec" value="${esc(url)}">
        </label>
        <label class="full">Sicherheitsschlüssel
          <input name="token" type="password" required placeholder="Dein eigener Schlüssel" value="${esc(token)}">
        </label>
        <div class="full actions">
          <button class="primary">Verbindung speichern</button>
          <button type="button" class="secondary" onclick="openGoogleSetup()">Google-Ersteinrichtung öffnen</button>
          <button type="button" class="secondary" onclick="syncGoogle()">Jetzt synchronisieren</button>
        </div>
      </form>
      <div id="googleStatus" class="message"></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <h3>Was wird synchronisiert?</h3>
      <ul>
        <li>Übersicht und alle fünf Vermittlungsbereiche</li>
        <li>Provisionen mit 10 %, abgerechnet, bezahlt und offen</li>
        <li>Monats- und Jahresabrechnung</li>
        <li>Kunden und Firmen / Subunternehmer</li>
        <li>Dokumentation und Drive-Verknüpfungen</li>
        <li>Google-Drive-Ordner je Auftrag nach Jahr und Auftragsnummer</li>
      </ul>
    </div>`);
  $('#googleForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);localStorage.setItem(GOOGLE_SYNC_URL_KEY,fd.get('url').trim());localStorage.setItem(GOOGLE_SYNC_TOKEN_KEY,fd.get('token').trim());showToast('Google-Verbindung gespeichert');};
}
function openGoogleSetup(){const u=googleSyncUrl(),t=googleSyncToken();if(!u||!t){alert('Bitte zuerst URL und Sicherheitsschlüssel speichern.');return}window.open(u+'?action=setup&token='+encodeURIComponent(t),'_blank','noopener');}
async function syncGoogle(){
  const u=googleSyncUrl(),t=googleSyncToken();
  if(!u||!t){alert('Bitte zuerst die Google-Verbindung speichern.');navigate('google');return}
  await loadBase();
  const payload={action:'syncAll',token:t,user:currentUser?.email||'',generatedAt:new Date().toISOString(),orders,customers,companies};
  try{
    await fetch(u,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
    const s=$('#googleStatus'); if(s)s.textContent='Synchronisierung wurde an Google übergeben. Bitte kurz warten, bis die Tabellen aktualisiert sind.';
    showToast('Synchronisierung gestartet');
  }catch(e){alert('Google-Synchronisierung konnte nicht gestartet werden: '+e.message)}
}

async function navigate(page){
  if(page==='commissions'||page==='reports') page='finance';
  if(isEntryUser()) page='order-entry';
  if(!isAdmin() && page!=='order-entry') page='order-entry';
  localStorage.setItem('vermittlung_current_page',page);
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(isEntryUser()){renderOrderEntry();return;}
  await loadBase();
  ({dashboard:renderDashboard,orders:renderOrders,customers:renderCustomers,companies:renderCompanies,finance:renderCompanyFinance,commissions:renderCompanyFinance,reports:renderCompanyFinance,google:renderGoogle,settings:renderSettings}[page]||renderDashboard)();
}
function page(title,body,actions=''){return `<div class="page"><div class="page-head"><h2>${title}</h2><div>${actions}</div></div>${body}</div>`}
function renderDashboard(){
const active=orders.filter(o=>o.status!=='Storniert'),open=orders.filter(o=>!['Abgeschlossen','Abgerechnet','Storniert'].includes(o.status));
const vol=active.reduce((s,o)=>s+Number(o.auftragswert_netto||0),0),prov=active.reduce((s,o)=>s+Number(o.provision||0),0);
const paid=active.filter(o=>o.provision_bezahlt).reduce((s,o)=>s+Number(o.provision||0),0),urgent=open.filter(o=>o.prioritaet==='Dringend').length;
const neu=orders.filter(o=>o.status==='Neue Anfrage').length,kv=orders.filter(o=>['Kostenvoranschlag angefordert','Kostenvoranschlag erhalten'].includes(o.status)).length;
$('#main').innerHTML=page('Dashboard',`<div class="hero-dashboard"><div><span class="eyebrow">VERMITTLUNGSSYSTEM</span><h1>Übersicht</h1><p>Alle wichtigen Kennzahlen und Vorgänge auf einen Blick.</p></div><button class="primary big-action" onclick="newOrder()">＋ Neuer Auftrag</button></div>
<div class="dashboard-cards">
<button class="dash-card dark" onclick="navigate('orders')"><b>↗</b><span>Auftragsvolumen</span><strong>${money(vol)}</strong><small>${active.length} aktive Aufträge</small></button>
<button class="dash-card blue" onclick="navigate('commissions')"><b>€</b><span>Provision gesamt</span><strong>${money(prov)}</strong><small>10 % Vermittlungsprovision</small></button>
<button class="dash-card green" onclick="navigate('commissions')"><b>✓</b><span>Provision bezahlt</span><strong>${money(paid)}</strong><small>bereits eingegangen</small></button>
<button class="dash-card orange" onclick="navigate('commissions')"><b>!</b><span>Provision offen</span><strong>${money(prov-paid)}</strong><small>noch nicht bezahlt</small></button></div>
<div class="quick-grid"><button onclick="navigate('orders')"><b>${open.length}</b><span>Offene Aufträge</span></button><button onclick="navigate('orders')"><b>${neu}</b><span>Neue Anfragen</span></button><button onclick="navigate('orders')"><b>${kv}</b><span>Kostenvoranschläge</span></button><button onclick="navigate('orders')"><b>${urgent}</b><span>Dringende Aufträge</span></button><button onclick="navigate('customers')"><b>${customers.length}</b><span>Kunden</span></button><button onclick="navigate('companies')"><b>${companies.length}</b><span>Firmen / Subunternehmer</span></button></div>
<div class="dashboard-panels"><div class="panel"><div class="panel-title-row"><div><span class="eyebrow">AKTUELL</span><h3>Letzte Aufträge</h3></div><button class="secondary" onclick="navigate('orders')">Alle anzeigen →</button></div>${orderTable(orders.slice(0,6))}</div><div class="panel dashboard-side"><span class="eyebrow">SCHNELLZUGRIFF</span><h3>Bereiche</h3><button onclick="navigate('orders')">📋 Aufträge <span>→</span></button><button onclick="navigate('customers')">👤 Kunden <span>→</span></button><button onclick="navigate('companies')">🏢 Firmen <span>→</span></button><button onclick="navigate('reports')">📊 Monats- / Jahresabrechnung <span>→</span></button></div></div>`)}

function customerNameForOrder(o){const c=customers.find(x=>String(x.id)===String(o?.kunde_id));return c?([c.vorname,c.nachname].filter(Boolean).join(' ')||c.firma||'Kunde ohne Namen')+(c.firma&&c.vorname?' · '+c.firma:''):(o?.objekt_kontakt||'Nicht zugeordnet')}
function companyNameForOrder(o){return companies.find(c=>String(c.id)===String(o?.ausfuehrende_firma_id))?.firmenname||'Noch nicht zugeordnet'}
function orderTable(list){if(!list.length)return '<p class="muted">Keine Aufträge vorhanden.</p>';return `<div class="table-wrap"><table class="table"><thead><tr><th>Nr.</th><th>Kunde</th><th>Bereich</th><th>Ausführende Firma</th><th>Status</th><th>Auftrag</th><th>Wert</th><th>Provision</th><th></th></tr></thead><tbody>${list.map(o=>`<tr><td><button class="secondary" onclick="showOrder('${o.id}')">${esc(o.auftragsnummer||'—')}</button></td><td>${esc(customerNameForOrder(o))}</td><td>${esc(o.bereich)}</td><td>${esc(companyNameForOrder(o))}</td><td><span class="badge status">${esc(o.status)}</span></td><td>${esc(o.beschreibung||'—')}</td><td>${money(o.auftragswert_netto)}</td><td>${money(o.provision)}</td><td><button class="delete-btn" onclick="deleteOrder('${o.id}');event.stopPropagation()">Löschen</button></td></tr>`).join('')}</tbody></table></div>`}
function renderOrders(){const body=`<div class="toolbar"><input id="orderSearch" placeholder="Aufträge suchen…" oninput="filterOrders()"><button class="primary" onclick="newOrder()">+ Neuer Auftrag</button></div><div id="ordersTable">${orderTable(orders)}</div>`;$('#main').innerHTML=page('Aufträge',body)}
function filterOrders(){const q=$('#orderSearch').value.toLowerCase();$('#ordersTable').innerHTML=orderTable(orders.filter(o=>JSON.stringify(o).toLowerCase().includes(q)))}
async function deleteCustomer(id){if(!confirm('Diesen Kunden wirklich löschen?'))return;const {error}=await db.from('vermittlung_kunden').delete().eq('id',id);if(error){alert('Kunde konnte nicht gelöscht werden: '+error.message);return}showToast('Kunde gelöscht');navigate('customers')}
async function deleteCompany(id){if(!confirm('Diese Firma wirklich löschen?'))return;const {error}=await db.from('vermittlung_firmen').delete().eq('id',id);if(error){alert('Firma konnte nicht gelöscht werden: '+error.message);return}showToast('Firma gelöscht');navigate('companies')}
async function deleteOrder(id){if(!confirm('Diesen Auftrag wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.'))return;const {error}=await db.from('vermittlung_auftraege').delete().eq('id',id);if(error){alert('Auftrag konnte nicht gelöscht werden: '+error.message);return}showToast('Auftrag gelöscht');navigate('orders')}
function renderCustomers(){
  const rows=customers.map(c=>`<tr><td>${esc((c.vorname||'')+' '+(c.nachname||''))}</td><td>${esc(c.firma||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td><td>${esc((c.strasse||'')+' '+(c.plz||'')+' '+(c.ort||''))}</td><td><button class="delete-btn" onclick="deleteCustomer('${c.id}')">Löschen</button></td></tr>`).join('');
  $('#main').innerHTML=page('Kunden',`<div class="toolbar"><input id="customerSearch" placeholder="Kunden suchen…" oninput="filterCustomers()"><button class="primary" onclick="newCustomer()">+ Neuer Kunde</button></div><div id="customersTable"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Firma</th><th>Telefon</th><th>E-Mail</th><th>Adresse</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Noch keine Kunden.</td></tr>'}</tbody></table></div></div>`)
}
function filterCustomers(){
  const q=($('#customerSearch')?.value||'').toLowerCase();
  const list=customers.filter(c=>JSON.stringify(c).toLowerCase().includes(q));
  const rows=list.map(c=>`<tr><td>${esc((c.vorname||'')+' '+(c.nachname||''))}</td><td>${esc(c.firma||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td><td>${esc((c.strasse||'')+' '+(c.plz||'')+' '+(c.ort||''))}</td><td><button class="delete-btn" onclick="deleteCustomer('${c.id}')">Löschen</button></td></tr>`).join('');
  $('#customersTable').innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Firma</th><th>Telefon</th><th>E-Mail</th><th>Adresse</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Keine Treffer.</td></tr>'}</tbody></table></div>`;
}
function newCustomer(){
  const m=modal(`<h2>Neuer Kunde</h2><form id="customerForm" class="form-grid">
    <label>Vorname<input name="vorname" required></label>
    <label>Nachname<input name="nachname" required></label>
    <label>Firma<input name="firma"></label>
    <label>Telefon<input name="telefon"></label>
    <label>E-Mail<input name="email" type="email"></label>
    <label class="full">Straße<input name="strasse"></label>
    <label>PLZ<input name="plz"></label>
    <label>Ort<input name="ort"></label>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Kunde speichern</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.target).entries());
    const {error}=await db.from('vermittlung_kunden').insert(d);
    if(error){alert('Kunde konnte nicht gespeichert werden: '+error.message);return}
    m.remove();showToast('Kunde gespeichert');navigate('customers');
  };
}
function renderCompanies(){
  const rows=companies.map(c=>`<tr><td>${esc(c.firmenname)}</td><td>${esc(c.ansprechpartner||'')}</td><td>${esc(c.gewerk||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td><td><button class="delete-btn" onclick="deleteCompany('${c.id}')">Löschen</button></td></tr>`).join('');
  $('#main').innerHTML=page('Firmen / Subunternehmer',`<div class="toolbar"><input id="companySearch" placeholder="Firmen suchen…" oninput="filterCompanies()"><button class="primary" onclick="newCompany()">+ Neue Firma</button></div><div id="companiesTable"><div class="table-wrap"><table class="table"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Gewerk</th><th>Telefon</th><th>E-Mail</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Noch keine Firmen.</td></tr>'}</tbody></table></div></div>`)
}
function filterCompanies(){
  const q=($('#companySearch')?.value||'').toLowerCase();
  const list=companies.filter(c=>JSON.stringify(c).toLowerCase().includes(q));
  const rows=list.map(c=>`<tr><td>${esc(c.firmenname)}</td><td>${esc(c.ansprechpartner||'')}</td><td>${esc(c.gewerk||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td><td><button class="delete-btn" onclick="deleteCompany('${c.id}')">Löschen</button></td></tr>`).join('');
  $('#companiesTable').innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Gewerk</th><th>Telefon</th><th>E-Mail</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Keine Treffer.</td></tr>'}</tbody></table></div>`;
}
function newCompany(){
  const m=modal(`<h2>Neue Firma / Subunternehmer</h2><form id="companyForm" class="form-grid">
    <label>Firmenname<input name="firmenname" required></label>
    <label>Ansprechpartner<input name="ansprechpartner"></label>
    <label>Gewerk<select name="gewerk">
      <option>Reinigung</option><option>Wasserschaden / Sanierung</option><option>Gartenarbeiten</option><option>Immobilien / Vermietung</option><option>Sonstige</option>
    </select></label>
    <label>Telefon<input name="telefon"></label>
    <label>E-Mail<input name="email" type="email"></label>
    <label class="full">Straße<input name="strasse"></label>
    <label>PLZ<input name="plz"></label>
    <label>Ort<input name="ort"></label>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Firma speichern</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async e=>{
    e.preventDefault();
    const d=Object.fromEntries(new FormData(e.target).entries());
    const {error}=await db.from('vermittlung_firmen').insert(d);
    if(error){alert('Firma konnte nicht gespeichert werden: '+error.message);return}
    m.remove();showToast('Firma gespeichert');navigate('companies');
  };
}
const companyMonthSelections={};
function monthLabelFor(key){return key?key.split('-').reverse().join('/'):'—'}
function periodCompanyId(a){return a?.firma_id??a?.ausfuehrende_firma_id??null}
function orderHasPeriodForMonth(orderId,month){return periodAccounts.some(a=>String(a.auftrag_id)===String(orderId)&&String(a.abrechnungsmonat||'').slice(0,7)===month&&a.status!=='Storniert')}
function companyFinanceEntries(companyId,month){
  const entries=[];
  const periods=periodAccounts.filter(a=>a.status!=='Storniert'&&String(periodCompanyId(a)||'')===String(companyId)&&String(a.abrechnungsmonat||'').slice(0,7)===month);
  periods.forEach(a=>{
    const order=orders.find(o=>String(o.id)===String(a.auftrag_id));
    entries.push({kind:'period',period:a,order,vol:Number(a.auftragswert_netto??order?.auftragswert_netto??0),prov:Number(a.provision??order?.provision??0),paid:!!a.bezahlt});
  });
  orders.filter(o=>String(o.ausfuehrende_firma_id||'')===String(companyId)&&o.status!=='Storniert'&&orderMonth(o)===month&&!orderHasPeriodForMonth(o.id,month)).forEach(o=>{
    entries.push({kind:'order',period:null,order:o,vol:Number(o.auftragswert_netto||0),prov:Number(o.provision||0),paid:!!o.provision_bezahlt});
  });
  return entries.sort((a,b)=>String(a.order?.auftragsnummer||'').localeCompare(String(b.order?.auftragsnummer||''),'de'));
}
function companyFinanceYear(companyId,year){
  const entries=[];
  periodAccounts.filter(a=>a.status!=='Storniert'&&String(periodCompanyId(a)||'')===String(companyId)&&String(a.abrechnungsmonat||'').slice(0,4)===year).forEach(a=>{
    const order=orders.find(o=>String(o.id)===String(a.auftrag_id));
    entries.push({vol:Number(a.auftragswert_netto??order?.auftragswert_netto??0),prov:Number(a.provision??order?.provision??0),paid:!!a.bezahlt});
  });
  orders.filter(o=>String(o.ausfuehrende_firma_id||'')===String(companyId)&&o.status!=='Storniert'&&orderMonth(o).slice(0,4)===year&&!orderHasPeriodForMonth(o.id,orderMonth(o))).forEach(o=>entries.push({vol:Number(o.auftragswert_netto||0),prov:Number(o.provision||0),paid:!!o.provision_bezahlt}));
  return entries.reduce((s,e)=>({count:s.count+1,vol:s.vol+e.vol,prov:s.prov+e.prov,paid:s.paid+(e.paid?e.prov:0)}),{count:0,vol:0,prov:0,paid:0});
}
function renderCompanyFinance(){
  const allMonths=new Set();
  periodAccounts.filter(a=>a.status!=='Storniert').forEach(a=>{const m=String(a.abrechnungsmonat||'').slice(0,7);if(/^\d{4}-\d{2}$/.test(m))allMonths.add(m)});
  orders.filter(o=>o.status!=='Storniert').forEach(o=>{const m=orderMonth(o);if(/^\d{4}-\d{2}$/.test(m))allMonths.add(m)});
  const monthKeys=[...allMonths].sort((a,b)=>b.localeCompare(a));
  const currentMonth=new Date().toISOString().slice(0,7);
  const defaultMonth=monthKeys.includes(currentMonth)?currentMonth:(monthKeys[0]||currentMonth);
  const year=new Date().getFullYear().toString();
  const firms=[...companies].sort((a,b)=>(a.firmenname||'').localeCompare(b.firmenname||'','de'));
  const companyCards=firms.map(c=>{
    const selectedMonth=companyMonthSelections[c.id]&&allMonths.has(companyMonthSelections[c.id])?companyMonthSelections[c.id]:defaultMonth;
    companyMonthSelections[c.id]=selectedMonth;
    const monthEntries=companyFinanceEntries(c.id,selectedMonth);
    const monthly=monthEntries.reduce((s,e)=>({count:s.count+1,vol:s.vol+e.vol,prov:s.prov+e.prov,paid:s.paid+(e.paid?e.prov:0)}),{count:0,vol:0,prov:0,paid:0});
    const annual=companyFinanceYear(c.id,year);
    const rows=monthEntries.map(e=>{
      const o=e.order,a=e.period;
      const status=a?(a.bezahlt?'Bezahlt':'Offen'):(o?.provision_bezahlt?'Bezahlt':'Noch nicht abgerechnet');
      const statusStyle=a?`background:${a.bezahlt?'#d8f5df':'#ffe0e0'};color:${a.bezahlt?'#176534':'#9f2020'}`:'background:#edf2f7;color:#475569';
      const action=a?`<button class="${a.bezahlt?'secondary':'primary'}" onclick="togglePeriodPaid('${a.id}',${!a.bezahlt})">${a.bezahlt?'Als offen markieren':'Als bezahlt markieren'}</button>`:'<span class="muted">Keine Abrechnungsperiode</span>';
      return `<tr><td>${esc(o?.auftragsnummer||a?.auftrag_id||'—')}</td><td>${esc(customerNameForOrder(o))}</td><td>${esc(o?.bereich||'—')}</td><td>${money(e.vol)}</td><td>${money(e.prov)}</td><td><span class="badge status" style="${statusStyle}">${status}</span></td><td>${a?.bezahlt?esc(a.zahlungsdatum||'—'):'—'}</td><td>${action}</td></tr>`;
    }).join('');
    return `<section class="panel" style="margin-bottom:16px;padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap">
        <div style="min-width:220px;flex:1"><h3 style="margin:0 0 5px">${esc(c.firmenname||'Unbenannte Firma')}</h3><div class="muted" style="font-size:13px">${annual.count} Abrechnungen/Aufträge im Jahr ${year}</div></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:10px;min-width:min(100%,280px)"><div style="background:#f3f6fb;border-radius:9px;padding:10px 12px"><div class="muted" style="font-size:12px">Jahresumsatz / Auftragsvolumen</div><strong>${money(annual.vol)}</strong></div><div style="background:#f3f6fb;border-radius:9px;padding:10px 12px"><div class="muted" style="font-size:12px">Jahresprovision</div><strong>${money(annual.prov)}</strong><div class="muted" style="font-size:12px">Offen ${money(annual.prov-annual.paid)}</div></div></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0 10px;padding-top:12px;border-top:1px solid #e2e8f0"><label style="font-weight:600" for="company-month-${esc(c.id)}">Monat</label><select id="company-month-${esc(c.id)}" onchange="setCompanyFinanceMonth('${esc(c.id)}',this.value)" style="padding:9px 12px;border:1px solid #d7dfeb;border-radius:8px;background:white;min-width:130px">${monthKeys.map(m=>`<option value="${esc(m)}" ${m===selectedMonth?'selected':''}>${esc(monthLabelFor(m))}</option>`).join('')||`<option value="${esc(selectedMonth)}">${esc(monthLabelFor(selectedMonth))}</option>`}</select><div style="margin-left:auto;display:flex;gap:18px;flex-wrap:wrap"><span>Monatsumsatz <strong>${money(monthly.vol)}</strong></span><span>Provision <strong>${money(monthly.prov)}</strong></span><span>Offen <strong>${money(monthly.prov-monthly.paid)}</strong></span></div></div>
      <details><summary style="cursor:pointer;font-weight:650;padding:5px 0">Aufträge und Abrechnungen für ${esc(monthLabelFor(selectedMonth))} anzeigen (${monthEntries.length})</summary><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Auftrag</th><th>Kunde</th><th>Bereich</th><th>Auftragswert</th><th>Provision</th><th>Status</th><th>Zahlungsdatum</th><th>Aktion</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Keine zugeordneten Aufträge oder Abrechnungen in diesem Monat.</td></tr>'}</tbody></table></div></details>
    </section>`;
  }).join('');
  const unassigned=orders.filter(o=>!o.ausfuehrende_firma_id&&o.status!=='Storniert');
  const unassignedHtml=unassigned.length?`<details class="panel" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:650">Nicht zugeordnete Aufträge (${unassigned.length})</summary><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Auftrag</th><th>Kunde</th><th>Bereich</th><th>Auftragswert</th></tr></thead><tbody>${unassigned.map(o=>`<tr><td><button class="secondary" onclick="showOrder('${o.id}')">${esc(o.auftragsnummer||'—')}</button></td><td>${esc(customerNameForOrder(o))}</td><td>${esc(o.bereich||'—')}</td><td>${money(o.auftragswert_netto)}</td></tr>`).join('')}</tbody></table></div></details>`:'';
  $('#main').innerHTML=page('Firmen & Abrechnung',`<div class="panel" style="margin-bottom:16px"><div class="panel-title-row"><div><h3 style="margin-bottom:5px">Firmenübersicht</h3><p class="muted" style="margin:0">Jede Firma zeigt rechts ihre Jahreswerte. Wähle innerhalb der Firmenkarte einen Monat, um Monatsumsatz, Provision und die dazugehörigen Aufträge zu sehen.</p></div><button class="secondary" onclick="generatePeriodsNow()">Abrechnungen prüfen</button></div></div>${companyCards||'<div class="panel">Noch keine Firmen angelegt.</div>'}${unassignedHtml}`);
}
function setCompanyFinanceMonth(companyId,month){companyMonthSelections[companyId]=month;renderCompanyFinance()}
async function togglePeriodPaid(id,paid){
  if(!isAdmin()){
    alert('Nur Administratoren dürfen Zahlungsstatus ändern.');
    return;
  }
  const {error}=await db.rpc('vermittlung_set_period_paid',{
    p_period_id:id,
    p_paid:paid
  });
  if(error){
    alert('Zahlungsstatus konnte nicht geändert werden: '+error.message);
    return;
  }
  showToast(paid?'Abrechnungsperiode als bezahlt markiert':'Abrechnungsperiode wieder offen');
  await loadBase();renderCompanyFinance();
}
async function generatePeriodsNow(){
  if(!isAdmin())return;
  const {data,error}=await db.rpc('vermittlung_generate_due_periods',{p_actor_email:currentUser.email});
  if(error){alert('Abrechnungen konnten nicht erzeugt werden. Bitte SQL-Einrichtung und Berechtigungen prüfen: '+error.message);return;}
  showToast(`Abrechnungen geprüft: ${data?.created_count??'fertig'}`);
  await loadBase();renderCompanyFinance();
}
function modal(content){const el=document.createElement('div');el.className='modal show';el.innerHTML=`<div class="modal-card">${content}</div>`;document.body.appendChild(el);return el}
function renderOrderEntry(){
  $('#main').innerHTML=page('Auftrag erfassen',`
    <div class="panel">
      <span class="eyebrow">AUFTRAGSERFASSUNG</span>
      <h3>Neuen Auftrag anlegen</h3>
      <p class="muted">Hier kannst du Aufträge erfassen. Andere Bereiche der Vermittlungsapp sind für diesen Benutzer nicht zugänglich.</p>
      <form id="entryOrderForm" class="form-grid">
        <label>Bereich<select name="bereich"><option>Wasserschaden / Sanierung</option><option>Reinigungsvermittlung</option><option>Gartenvermittlung</option><option>Immobilien / Vermietung</option><option>Sonstige Vermittlung</option></select></label>
        <label>Priorität<select name="prioritaet"><option>Normal</option><option>Dringend</option></select></label>
        <label class="full">Kunde / Ansprechpartner<input name="objekt_kontakt" required></label>
        <label>Telefon<input name="objekt_kontakt_telefon"></label>
        <label>E-Mail<input name="ansprechpartner"></label>
        <label class="full">Objektadresse<input name="objekt_adresse"></label>
        <label>Objekttyp<select name="objekt_typ"><option>Wohnung</option><option>Einfamilienhaus</option><option>Mehrfamilienhaus</option><option>Gewerbe</option><option>Sonstiges</option></select></label>
        <label>Geplanter Beginn<input type="date" name="geplanter_beginn"></label>
        <label class="full">Beschreibung<textarea name="beschreibung" required></textarea></label>
        <label>Schadensart<input name="schadensart"></label>
        <label>Schadensort<input name="schadensort"></label>
        <label>Versicherung<select name="versicherung"><option value="">unbekannt</option><option value="true">Ja</option><option value="false">Nein</option></select></label>
        <label>Schadennummer<input name="schadennummer"></label>
        <label>Versicherungsgesellschaft<input name="versicherungsgesellschaft"></label>
        <label class="full">Notizen<textarea name="notizen"></textarea></label>
        <div class="full actions"><button class="primary">Auftrag speichern</button></div>
      </form>
      <div id="entryOrderMsg" class="message"></div>
    </div>`);
  $('#entryOrderForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), d=Object.fromEntries(fd.entries());
    d.versicherung=d.versicherung===''?null:d.versicherung==='true';
    const {data,error}=await db.rpc('vermittlung_create_order_entry',{p_user_email:currentUser.email,p_data:d});
    if(error){$('#entryOrderMsg').textContent='Auftrag konnte nicht gespeichert werden: '+error.message;return;}
    e.target.reset();
    $('#entryOrderMsg').textContent='Auftrag wurde erfolgreich erfasst.';
    showToast('Auftrag gespeichert');
  };
}

function renderSettings(){
  if(!isAdmin()){navigate('dashboard');return;}
  $('#main').innerHTML=page('Einstellungen',`
    <div class="panel">
      <div class="panel-title-row"><div><span class="eyebrow">BENUTZERVERWALTUNG</span><h3>Benutzer</h3></div><button class="primary" onclick="newAppUser()">+ Benutzer anlegen</button></div>
      <p class="muted">Nur Administratoren können Benutzer anlegen, deaktivieren, löschen oder Passwörter ändern.</p>
      <div id="usersTable"><p class="muted">Benutzer werden geladen…</p></div>
    </div>`);
  loadAppUsers();
}
async function loadAppUsers(){
  const {data,error}=await db.rpc('vermittlung_admin_list_users',{p_actor_email:currentUser.email});
  if(error){$('#usersTable').innerHTML='<p class="message">Benutzer konnten nicht geladen werden: '+esc(error.message)+'</p>';return;}
  const rows=(data||[]).map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="badge status">${esc(u.rolle)}</span></td><td>${u.aktiv?'Aktiv':'Deaktiviert'}</td><td>${u.created_at?new Date(u.created_at).toLocaleDateString('de-DE'):'—'}</td><td><button class="secondary" onclick="editAppUser('${u.id}','${esc(u.name)}','${esc(u.email)}','${esc(u.rolle)}',${u.aktiv})">Bearbeiten</button> <button class="delete-btn" onclick="deleteAppUser('${u.id}')">Löschen</button></td></tr>`).join('');
  $('#usersTable').innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th>Angelegt</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6">Keine Benutzer vorhanden.</td></tr>'}</tbody></table></div>`;
}
function newAppUser(){
  const m=modal(`<h2>Benutzer anlegen</h2><form id="appUserForm" class="form-grid">
    <label>Name<input name="name" required></label><label>E-Mail<input name="email" type="email" required></label>
    <label>Passwort<input name="password" type="password" minlength="8" required placeholder="mindestens 8 Zeichen"></label>
    <label>Rolle<select name="rolle"><option value="Auftragserfassung">Auftragserfassung</option><option value="Administrator">Administrator</option></select></label>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Benutzer speichern</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const {error}=await db.rpc('vermittlung_admin_create_user',{p_actor_email:currentUser.email,p_name:d.name,p_email:d.email,p_password:d.password,p_rolle:d.rolle});if(error){alert(error.message);return}m.remove();showToast('Benutzer angelegt');loadAppUsers();};
}
function editAppUser(id,name,email,rolle,aktiv){
  const m=modal(`<h2>Benutzer bearbeiten</h2><form id="editAppUserForm" class="form-grid">
    <label>Name<input name="name" value="${esc(name)}" required></label><label>E-Mail<input name="email" type="email" value="${esc(email)}" required></label>
    <label>Neue Rolle<select name="rolle"><option value="Auftragserfassung" ${rolle==='Auftragserfassung'?'selected':''}>Auftragserfassung</option><option value="Administrator" ${rolle==='Administrator'?'selected':''}>Administrator</option></select></label>
    <label>Status<select name="aktiv"><option value="true" ${aktiv?'selected':''}>Aktiv</option><option value="false" ${!aktiv?'selected':''}>Deaktiviert</option></select></label>
    <label class="full">Neues Passwort (leer lassen = unverändert)<input name="password" type="password" minlength="8"></label>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Änderungen speichern</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const {error}=await db.rpc('vermittlung_admin_update_user',{p_actor_email:currentUser.email,p_user_id:id,p_name:d.name,p_email:d.email,p_password:d.password||null,p_rolle:d.rolle,p_aktiv:d.aktiv==='true'});if(error){alert(error.message);return}m.remove();showToast('Benutzer geändert');loadAppUsers();};
}
async function deleteAppUser(id){if(!confirm('Diesen Benutzer wirklich löschen?'))return;const {error}=await db.rpc('vermittlung_admin_delete_user',{p_actor_email:currentUser.email,p_user_id:id});if(error){alert(error.message);return}showToast('Benutzer gelöscht');loadAppUsers();}

function newOrder(){
  const m=modal(`<h2>Neuer Auftrag</h2><form id="orderForm" class="form-grid">
  <label>Bereich<select name="bereich"><option>Wasserschaden / Sanierung</option><option>Reinigungsvermittlung</option><option>Gartenvermittlung</option><option>Immobilien / Vermietung</option><option>Sonstige Vermittlung</option></select></label>
  <label>Priorität<select name="prioritaet"><option>Normal</option><option>Dringend</option></select></label>
  <label>Status<select name="status">${['Neue Anfrage','In Prüfung','Kostenvoranschlag angefordert','Kostenvoranschlag erhalten','Angebot beim Kunden','Auftrag erteilt','In Ausführung','Abgeschlossen','Provision offen','Abgerechnet','Storniert'].map(x=>`<option>${x}</option>`).join('')}</select></label>
  <label>Verantwortlich<input name="verantwortlich"></label>
  <label>Kunde<select name="kunde_id"><option value="">— neuer / noch nicht zugeordnet —</option>${customers.map(c=>`<option value="${c.id}">${esc((c.vorname||'')+' '+(c.nachname||'')+(c.firma?' – '+c.firma:''))}</option>`).join('')}</select></label>
  <label>Ausführende Firma<select name="ausfuehrende_firma_id"><option value="">— noch nicht zugeordnet —</option>${companies.map(c=>`<option value="${c.id}">${esc(c.firmenname)}</option>`).join('')}</select></label>
  <label class="full">Objektadresse<input name="objekt_adresse"></label>
  <label>Objekttyp<select name="objekt_typ"><option>Wohnung</option><option>Einfamilienhaus</option><option>Mehrfamilienhaus</option><option>Gewerbe</option><option>Sonstiges</option></select></label>
  <label>Geplanter Beginn<input type="date" name="geplanter_beginn"></label>
  <div class="full panel"><h3>Wiederkehrender Auftrag</h3><p class="muted">Bei wiederkehrenden Aufträgen bleibt die Auftragsnummer gleich. Die Abrechnung wird je Zeitraum separat geführt.</p>
  <div class="form-grid">
    <label>Abrechnungsintervall<select name="wiederholung"><option value="Einmalig">Einmalauftrag</option><option value="Monatlich">Monatlich</option><option value="Vierteljährlich">Vierteljährlich</option><option value="Halbjährlich">Halbjährlich</option><option value="Jährlich">Jährlich</option></select></label>
    <label>Wiederholung beginnt am<input type="date" name="wiederholung_beginn"></label>
    <label>Wiederholung endet am (optional)<input type="date" name="wiederholung_ende"></label>
  </div></div>
  <label class="full">Beschreibung<textarea name="beschreibung"></textarea></label>
  <label>Kostenvoranschlag netto<input type="number" step="0.01" name="kostenvoranschlag_netto" value="0"></label>
  <label>Kostenvoranschlag brutto<input type="number" step="0.01" name="kostenvoranschlag_brutto" value="0"></label>
  <label>Auftragswert netto<input type="number" step="0.01" name="auftragswert_netto" value="0"></label>
  <label>Schadensart (bei Wasserschaden)<input name="schadensart"></label><label>Schadensort<input name="schadensort"></label>
  <label>Versicherung<select name="versicherung"><option value="">unbekannt</option><option value="true">Ja</option><option value="false">Nein</option></select></label>
  <label>Schadennummer<input name="schadennummer"></label><label>Versicherungsgesellschaft<input name="versicherungsgesellschaft"></label><label>Notizen<textarea name="notizen"></textarea></label>
  <div class="full panel"><h3>Dokumente direkt hochladen</h3><p class="muted">PDF, JPG, PNG, WebP, Word und Excel. Maximal 50 MB je Datei.</p><input id="orderFiles" name="orderFiles" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><p id="orderFilesInfo" class="muted">Noch keine Dateien ausgewählt.</p></div>
  <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary" id="saveOrderBtn">Auftrag speichern</button></div><p id="orderUploadMsg" class="full muted"></p></form>`);
  const fileInput=m.querySelector('#orderFiles');
  fileInput.addEventListener('change',()=>{const fs=[...fileInput.files];m.querySelector('#orderFilesInfo').textContent=fs.length?fs.map(f=>`${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`).join(' · '):'Noch keine Dateien ausgewählt.';});
  m.querySelector('#orderForm').onsubmit=async e=>{
    e.preventDefault();
    const btn=m.querySelector('#saveOrderBtn'), msg=m.querySelector('#orderUploadMsg');
    const files=[...fileInput.files];
    const max=50*1024*1024;
    if(files.some(f=>f.size>max)){alert('Mindestens eine Datei ist größer als 50 MB. Bitte kleinere Dateien auswählen.');return;}
    btn.disabled=true; msg.textContent='Auftrag wird gespeichert …';
    const fd=new FormData(e.target), d=Object.fromEntries([...fd.entries()].filter(([k])=>k!=='orderFiles'));
    for(const k of ['kunde_id','ausfuehrende_firma_id'])if(!d[k])d[k]=null;
    for(const k of ['kostenvoranschlag_netto','kostenvoranschlag_brutto','auftragswert_netto'])d[k]=Number(d[k]||0);
    d.versicherung=d.versicherung===''?null:d.versicherung==='true'; d.created_by=currentUser.email; d.wiederholung=d.wiederholung||'Einmalig'; d.wiederholung_aktiv=d.wiederholung!=='Einmalig'; d.wiederholung_beginn=d.wiederholung_beginn||d.geplanter_beginn||new Date().toISOString().slice(0,10); d.wiederholung_ende=d.wiederholung_ende||null;
    const {data:created,error}=await db.from('vermittlung_auftraege').insert(d).select('id').single();
    if(error){btn.disabled=false;msg.textContent='Auftrag konnte nicht gespeichert werden: '+error.message;return;}
    let failed=[];
    for(let i=0;i<files.length;i++){
      const file=files[i]; msg.textContent=`Dokument ${i+1} von ${files.length} wird hochgeladen: ${file.name}`;
      const uploadForm=new FormData(); uploadForm.append('actor_email',currentUser.email); uploadForm.append('order_id',created.id); uploadForm.append('file',file,file.name);
      const {data:uploadData,error:uploadError}=await db.functions.invoke('upload-order-document',{body:uploadForm});
      if(uploadError||!uploadData?.ok)failed.push(`${file.name}: ${uploadData?.error||uploadError?.message||'Upload fehlgeschlagen'}`);
    }
    m.remove();
    if(failed.length)alert('Der Auftrag wurde gespeichert, aber einige Dateien konnten nicht hochgeladen werden:\n\n'+failed.join('\n'));
    else showToast(files.length?`Auftrag und ${files.length} Dokument(e) gespeichert`:'Auftrag gespeichert');
    navigate('orders');
  };
}

const ORDER_MAIL_FROM='auftragsservice@josef-altmann.de';
const ORDER_MAIL_CC='auftragsservice@josef-altmann.de';
function orderMailText(o){
  const fields=[
    ['Auftragsnummer',o.auftragsnummer],['Art des Auftrags',o.bereich],['Objektadresse',o.objekt_adresse],
    ['Objekttyp',o.objekt_typ],['Ansprechpartner',o.objekt_kontakt],['Telefon',o.objekt_kontakt_telefon],
    ['Gewünschter Termin',o.geplanter_beginn],['Fertigstellung',o.fertigstellung],['Dringlichkeit',o.prioritaet],
    ['Status',o.status],['Schadensart',o.schadensart],['Schadensort',o.schadensort],
    ['Versicherung',o.versicherung===true?'Ja':o.versicherung===false?'Nein':'Nicht angegeben'],
    ['Schadennummer',o.schadennummer],['Versicherungsgesellschaft',o.versicherungsgesellschaft],
    ['Beschreibung',o.beschreibung],['Weitere Informationen',o.notizen]
  ].filter(([k,v])=>v!==null&&v!==undefined&&String(v).trim()!=='');
  return `Sehr geehrte Damen und Herren,

wir haben eine neue Auftragsanfrage erhalten und würden Ihnen diesen Auftrag gerne zur Prüfung und möglichen Übernahme weiterleiten.

Nachfolgend finden Sie die uns vorliegenden Informationen zum Auftrag:

${fields.map(([k,v])=>`${k}: ${v}`).join('\n')}

Sollten Sie Interesse an der Übernahme dieses Auftrags haben, freuen wir uns über eine kurze Rückmeldung per E-Mail oder WhatsApp. Bitte teilen Sie uns kurz mit, ob Sie den Auftrag grundsätzlich übernehmen könnten. Wir stimmen anschließend die weiteren Einzelheiten mit Ihnen ab.

Sollten Sie aktuell keine Kapazitäten haben, genügt uns ebenfalls eine kurze Nachricht. Vielen Dank!

Wir freuen uns auf eine gute Zusammenarbeit und Ihre Rückmeldung.

Mit freundlichen Grüßen

Josef Altmann
Vermittlungssystem Josef Altmann
Grabitzer Straße 21 a
93437 Furth im Wald
E-Mail: ${ORDER_MAIL_FROM}`;
}
async function openOrderEmail(orderId){
  if(!isAdmin()){alert('Nur Administratoren dürfen Aufträge versenden.');return}
  const o=orders.find(x=>String(x.id)===String(orderId));
  if(!o)return;
  const eligible=companies.filter(c=>String(c.email||'').includes('@'));
  const {data: relatedDocsResult, error: relatedDocsError}=await db.functions.invoke('get-order-documents',{body:{actor_email:currentUser.email,order_id:orderId}});
  const relatedDocs={data:relatedDocsResult?.ok?(relatedDocsResult.documents||[]):[],error:relatedDocsError||(!relatedDocsResult?.ok?new Error(relatedDocsResult?.error||'Dokumente konnten nicht geladen werden.'):null)};
  if(relatedDocs.error) console.error('Dokumente für E-Mail konnten nicht geladen werden:',relatedDocs.error.message);
  const subject=`Neue Auftragsanfrage – ${o.bereich||'Auftrag'} – ${o.auftragsnummer||orderId}`;
  const m=modal(`<div class="page-head"><div><h2>Auftrag versenden</h2><p class="muted">Empfänger auswählen und Nachricht vor dem Versand prüfen.</p></div><button type="button" class="close" onclick="this.closest('.modal').remove()">Schließen</button></div>
  <form id="orderEmailForm" class="form-grid">
    <div class="full panel"><h3>Firmen auswählen</h3><p class="muted">Die Firmen stammen aus „Firmen / Subunternehmer“. Es werden nur Firmen mit E-Mail-Adresse angezeigt.</p>
    ${eligible.map(c=>`<label class="check-row"><input type="checkbox" name="recipients" value="${esc(c.id)}"> ${esc(c.firmenname)} — ${esc(c.email)}</label>`).join('')||'<p>Keine Firmen mit E-Mail-Adresse vorhanden.</p>'}</div>
    <label class="full">Betreff<input name="subject" value="${esc(subject)}" required></label>
    <label class="full">E-Mail-Text<textarea name="body" rows="18" required>${esc(orderMailText(o))}</textarea></label>
    <div class="full panel"><strong>Absender:</strong> ${ORDER_MAIL_FROM}<br><strong>CC:</strong> ${ORDER_MAIL_CC}
    <h3>Dokumente als E-Mail-Anhänge</h3>${(relatedDocs.data||[]).length?(relatedDocs.data||[]).map(d=>`<label class="check-row"><input type="checkbox" name="attachments" value="${esc(d.id)}" checked> ${esc(d.dateiname)} <span class="muted">(${(Number(d.dateigroesse||0)/1024/1024).toFixed(2)} MB)</span></label>`).join(''):'<p class="muted">Für diesen Auftrag wurden noch keine Dateien hochgeladen.</p>'}<p class="muted">Ausgewählte Dateien werden als echte Anhänge mitgesendet.</p></div>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary" ${eligible.length?'':'disabled'}>Jetzt versenden</button></div>
    <p id="orderEmailMsg" class="full muted"></p>
  </form>`);
  m.querySelector('#orderEmailForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const recipientIds=fd.getAll('recipients');
    if(!recipientIds.length){alert('Bitte mindestens eine Firma auswählen.');return}
    const recipients=eligible.filter(c=>recipientIds.includes(String(c.id))).map(c=>({company_id:c.id,name:c.firmenname,email:c.email}));
    if(!confirm(`Auftrag an ${recipients.length} Firma/Firmen versenden? Eine Kopie geht an ${ORDER_MAIL_CC}.`))return;
    const msg=m.querySelector('#orderEmailMsg');msg.textContent='Versand wird vorbereitet …';
    const attachment_ids=fd.getAll('attachments');
    const {data,error}=await db.functions.invoke('send-order-email',{body:{actor_email:currentUser.email,order_id:o.id,recipients,subject:fd.get('subject'),body:fd.get('body'),cc:ORDER_MAIL_CC,attachment_ids}});
    if(error||!data?.ok){msg.textContent='Versand fehlgeschlagen: '+(data?.error||error?.message||'Unbekannter Fehler');return}
    msg.textContent=`Versand vom Maildienst angenommen. Vorgangs-ID: ${data.message_id||'nicht zurückgegeben'}. Bitte zusätzlich den Eingang der CC-Kopie prüfen.`;
    showToast('Auftrags-E-Mail versendet');
  };
}

async function openOrderDocument(documentId){
  try{
    const {data,error}=await db.functions.invoke('get-order-document-url',{body:{actor_email:currentUser.email,document_id:documentId}});
    if(error||!data?.ok||!data?.url) throw new Error(data?.error||error?.message||'Datei-Link konnte nicht erstellt werden.');
    window.open(data.url,'_blank','noopener,noreferrer');
  }catch(err){alert('Datei konnte nicht geöffnet werden: '+(err?.message||err));}
}

async function showOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;

  const history=await db.from('vermittlung_verlauf')
    .select('*').eq('auftrag_id',id).order('datum',{ascending:false});
  const {data: docsResult, error: docsError}=await db.functions.invoke('get-order-documents',{body:{actor_email:currentUser.email,order_id:id}});
  const docs={data:docsResult?.ok?(docsResult.documents||[]):[],error:docsError||(!docsResult?.ok?new Error(docsResult?.error||'Dokumente konnten nicht geladen werden.'):null)};
  if(docs.error) console.error('Dokumente für Auftrag konnten nicht geladen werden:',docs.error.message);

  const m=modal(`
    <div class="page-head">
      <div>
        <h2>Auftrag ${esc(o.auftragsnummer||'')}</h2>
        <p class="muted">${esc(o.bereich)}</p>
      </div>
      <div class="actions">
        ${isAdmin()?`<button type="button" class="primary" onclick="openOrderEmail('${o.id}')">✉ Auftrag versenden</button>`:''}
        <button class="close" onclick="this.closest('.modal').remove()">Schließen</button>
      </div>
    </div>

    <form id="detailForm" class="form-grid">
      <label>Status
        <select name="status">
          ${['Neue Anfrage','In Prüfung','Kostenvoranschlag angefordert','Kostenvoranschlag erhalten','Angebot beim Kunden','Auftrag erteilt','In Ausführung','Abgeschlossen','Provision offen','Abgerechnet','Storniert']
          .map(x=>`<option ${x===o.status?'selected':''}>${x}</option>`).join('')}
        </select>
      </label>

      <label>Priorität
        <select name="prioritaet">
          <option ${o.prioritaet==='Normal'?'selected':''}>Normal</option>
          <option ${o.prioritaet==='Dringend'?'selected':''}>Dringend</option>
        </select>
      </label>

      <label>Verantwortlich
        <input name="verantwortlich" value="${esc(o.verantwortlich||'')}">
      </label>

      <label>Auftragsnummer
        <input value="${esc(o.auftragsnummer||'')}" disabled>
      </label>

      <label class="full">Beschreibung
        <textarea name="beschreibung">${esc(o.beschreibung||'')}</textarea>
      </label>

      <label>Objektadresse
        <input name="objekt_adresse" value="${esc(o.objekt_adresse||'')}">
      </label>

      <label>Objekttyp
        <select name="objekt_typ">
          ${['Wohnung','Einfamilienhaus','Mehrfamilienhaus','Gewerbe','Sonstiges']
          .map(x=>`<option ${x===o.objekt_typ?'selected':''}>${x}</option>`).join('')}
        </select>
      </label>

      <label>Objektkontakt
        <input name="objekt_kontakt" value="${esc(o.objekt_kontakt||'')}">
      </label>

      <label>Telefon Objektkontakt
        <input name="objekt_kontakt_telefon" value="${esc(o.objekt_kontakt_telefon||'')}">
      </label>

      <label>Ausführende Firma
        <select name="ausfuehrende_firma_id">
          <option value="">— nicht zugeordnet —</option>
          ${companies.map(c=>`<option value="${c.id}" ${c.id===o.ausfuehrende_firma_id?'selected':''}>${esc(c.firmenname)}</option>`).join('')}
        </select>
      </label>

      <label>Ansprechpartner Firma
        <input name="ansprechpartner" value="${esc(o.ansprechpartner||'')}">
      </label>

      <label>Telefon Ansprechpartner
        <input name="ansprechpartner_telefon" value="${esc(o.ansprechpartner_telefon||'')}">
      </label>

      <label>Geplanter Beginn
        <input type="date" name="geplanter_beginn" value="${esc(o.geplanter_beginn||'')}">
      </label>

      <label>Abrechnungsintervall
        <select name="wiederholung">
          ${['Einmalig','Monatlich','Vierteljährlich','Halbjährlich','Jährlich'].map(x=>`<option value="${x}" ${((o.wiederholung||'Einmalig')===x)?'selected':''}>${x==='Einmalig'?'Einmalauftrag':x}</option>`).join('')}
        </select>
      </label>
      <label>Wiederholung beginnt am
        <input type="date" name="wiederholung_beginn" value="${esc(o.wiederholung_beginn||o.geplanter_beginn||'')}">
      </label>
      <label>Wiederholung endet am (optional)
        <input type="date" name="wiederholung_ende" value="${esc(o.wiederholung_ende||'')}">
      </label>
      <label>Wiederholung aktiv
        <select name="wiederholung_aktiv">
          <option value="true" ${(o.wiederholung_aktiv===true || (o.wiederholung_aktiv==null && o.wiederholung && o.wiederholung!=='Einmalig'))?'selected':''}>Ja</option>
          <option value="false" ${(o.wiederholung_aktiv===false || !o.wiederholung || o.wiederholung==='Einmalig')?'selected':''}>Nein</option>
        </select>
      </label>

      <label>Fertigstellung
        <input type="date" name="fertigstellung" value="${esc(o.fertigstellung||'')}">
      </label>

      <label>Kostenvoranschlag netto
        <input type="number" step="0.01" name="kostenvoranschlag_netto" value="${Number(o.kostenvoranschlag_netto||0).toFixed(2)}">
      </label>

      <label>Kostenvoranschlag brutto
        <input type="number" step="0.01" name="kostenvoranschlag_brutto" value="${Number(o.kostenvoranschlag_brutto||0).toFixed(2)}">
      </label>

      <label>Auftragswert netto
        <input type="number" step="0.01" name="auftragswert_netto" value="${Number(o.auftragswert_netto||0).toFixed(2)}">
      </label>

      <label>Provision
        <input value="${money(o.provision)} (10 %)" disabled>
      </label>

      <label>Provision abgerechnet
        <select name="provision_abgerechnet">
          <option value="false" ${!o.provision_abgerechnet?'selected':''}>Nein</option>
          <option value="true" ${o.provision_abgerechnet?'selected':''}>Ja</option>
        </select>
      </label>

      <label>Provision bezahlt
        <select name="provision_bezahlt">
          <option value="false" ${!o.provision_bezahlt?'selected':''}>Nein</option>
          <option value="true" ${o.provision_bezahlt?'selected':''}>Ja</option>
        </select>
      </label>

      <label>Rechnungsdatum
        <input type="date" name="provisions_rechnungsdatum" value="${esc(o.provisions_rechnungsdatum||'')}">
      </label>

      <label>Zahlungsdatum
        <input type="date" name="provisions_zahlungsdatum" value="${esc(o.provisions_zahlungsdatum||'')}">
      </label>

      <div class="full panel">
        <h3>Wasserschaden / Sanierung</h3>
        <div class="form-grid">
          <label>Schadensart<input name="schadensart" value="${esc(o.schadensart||'')}"></label>
          <label>Schadensort<input name="schadensort" value="${esc(o.schadensort||'')}"></label>
          <label>Versicherung<select name="versicherung">
            <option value="" ${o.versicherung==null?'selected':''}>unbekannt</option>
            <option value="true" ${o.versicherung===true?'selected':''}>Ja</option>
            <option value="false" ${o.versicherung===false?'selected':''}>Nein</option>
          </select></label>
          <label>Schadennummer<input name="schadennummer" value="${esc(o.schadennummer||'')}"></label>
          <label>Versicherungsgesellschaft<input name="versicherungsgesellschaft" value="${esc(o.versicherungsgesellschaft||'')}"></label>
          <label>Gutachter<input name="gutachter" value="${esc(o.gutachter||'')}"></label>
          <label>Trocknungsfirma<input name="trocknungsfirma" value="${esc(o.trocknungsfirma||'')}"></label>
          <label>Sanierungsfirma<input name="sanierungsfirma" value="${esc(o.sanierungsfirma||'')}"></label>
        </div>
      </div>

      <label class="full">Notizen
        <textarea name="notizen">${esc(o.notizen||'')}</textarea>
      </label>

      <div class="full actions">
        <button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button>
        <button class="primary">Änderungen speichern</button>
      </div>
    </form>

    <div class="panel" style="margin-top:18px">
      <h3>Dokumentation</h3>
      <p class="muted">Hier kannst du Dokumente zu diesem Auftrag ansehen und weitere Dateien hinzufügen. Die Dokumente können beim E-Mail-Versand ausgewählt werden.</p>
      ${isAdmin()?`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0">
        <input id="existingOrderFiles" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <button type="button" class="primary" id="uploadExistingOrderFiles">Dokumente hinzufügen</button>
      </div><p id="existingOrderUploadMsg" class="muted">Mehrere Dateien möglich, maximal 50 MB je Datei.</p>`:''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Datei</th><th>Typ</th><th>Größe</th><th>Hochgeladen</th><th>Aktion</th></tr></thead>
      <tbody>${(docs.data||[]).map(d=>`<tr><td>${esc(d.dateiname)}</td><td>${esc(d.mime_type||'unbekannt')}</td><td>${(Number(d.dateigroesse||0)/1024/1024).toFixed(2)} MB</td><td>${d.erstellt_am?new Date(d.erstellt_am).toLocaleString('de-DE'):'—'}</td><td><button type="button" class="close" onclick="openOrderDocument('${esc(d.id)}')">Öffnen / Herunterladen</button></td></tr>`).join('')||(docs.error?`<tr><td colspan="4">Dokumente konnten nicht geladen werden. Details stehen in der Browser-Konsole.</td></tr>`:'<tr><td colspan="4">Noch keine Dateien hochgeladen.</td></tr>')}</tbody></table></div>
    </div>

    <div class="panel" style="margin-top:18px">
      <h3>Verlauf</h3>
      <form id="historyForm" class="form-grid">
        <label class="full">Aktivität / Notiz<textarea name="notiz" required placeholder="z. B. Kostenvoranschlag bei Firma angefordert"></textarea></label>
        <div class="full actions"><button class="primary">Eintrag hinzufügen</button></div>
      </form>
      <div class="table-wrap">
        <table class="table"><thead><tr><th>Datum</th><th>Bearbeiter</th><th>Aktivität</th></tr></thead>
        <tbody>${(history.data||[]).map(h=>`<tr><td>${new Date(h.datum).toLocaleString('de-DE')}</td><td>${esc(h.bearbeiter||'')}</td><td>${esc(h.notiz||h.aktivitaet||'')}</td></tr>`).join('')||'<tr><td colspan="3">Noch kein Verlauf.</td></tr>'}</tbody></table>
      </div>
    </div>
  `);

  if(isAdmin()){
    const fileInput=m.querySelector('#existingOrderFiles');
    const uploadBtn=m.querySelector('#uploadExistingOrderFiles');
    const uploadMsg=m.querySelector('#existingOrderUploadMsg');
    uploadBtn.addEventListener('click', async ()=>{
      const files=[...(fileInput?.files||[])];
      if(!files.length){uploadMsg.textContent='Bitte zuerst mindestens eine Datei auswählen.';return;}
      const max=50*1024*1024;
      if(files.some(f=>f.size>max)){uploadMsg.textContent='Mindestens eine Datei ist größer als 50 MB. Bitte kleinere Dateien auswählen.';return;}
      uploadBtn.disabled=true; fileInput.disabled=true;
      const failed=[];
      for(let i=0;i<files.length;i++){
        const file=files[i];
        uploadMsg.textContent=`Dokument ${i+1} von ${files.length} wird hochgeladen: ${file.name}`;
        const uploadForm=new FormData();
        uploadForm.append('actor_email',currentUser.email);
        uploadForm.append('order_id',id);
        uploadForm.append('file',file,file.name);
        try{
          const {data:uploadData,error:uploadError}=await db.functions.invoke('upload-order-document',{body:uploadForm});
          if(uploadError||!uploadData?.ok)failed.push(`${file.name}: ${uploadData?.error||uploadError?.message||'Upload fehlgeschlagen'}`);
        }catch(err){failed.push(`${file.name}: ${err?.message||'Upload fehlgeschlagen'}`);}
      }
      if(failed.length){
        uploadMsg.textContent=`Upload beendet: ${files.length-failed.length} von ${files.length} Datei(en) erfolgreich.`;
        alert('Einige Dateien konnten nicht hochgeladen werden:\n\n'+failed.join('\n'));
        uploadBtn.disabled=false; fileInput.disabled=false;
      }else{
        m.remove();
        showToast(`${files.length} Dokument(e) zum Auftrag hinzugefügt`);
        await showOrder(id);
      }
    });
  }

  m.querySelector('#detailForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), d=Object.fromEntries(fd.entries());
    // Leere Datumsfelder als NULL statt als ungueltigen Leerstring an Supabase senden.
    e.target.querySelectorAll('input[type="date"]').forEach(input=>{
      if (input.name) d[input.name] = input.value.trim() === '' ? null : input.value;
    });
    for(const k of ['kostenvoranschlag_netto','kostenvoranschlag_brutto','auftragswert_netto']) d[k]=Number(d[k]||0);
    for(const k of ['provision_abgerechnet','provision_bezahlt','wiederholung_aktiv']) if(d[k]!==undefined)d[k]=d[k]==='true';
    d.wiederholung=d.wiederholung||'Einmalig'; if(d.wiederholung==='Einmalig')d.wiederholung_aktiv=false; d.wiederholung_beginn=d.wiederholung_beginn||d.geplanter_beginn||null; d.wiederholung_ende=d.wiederholung_ende||null;
    d.versicherung=d.versicherung===''?null:d.versicherung==='true';
    d.ausfuehrende_firma_id=d.ausfuehrende_firma_id||null;
    d.updated_at=new Date().toISOString();
    const {error}=await db.from('vermittlung_auftraege').update(d).eq('id',id);
    if(error){alert(error.message);return}
    m.remove();showToast('Auftrag aktualisiert');navigate('orders');
  };

  m.querySelector('#historyForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), notiz=fd.get('notiz');
    const {error}=await db.from('vermittlung_verlauf').insert({
      auftrag_id:id, aktivitaet:'Bearbeitung', notiz, bearbeiter:currentUser.email
    });
    if(error){alert(error.message);return}
    m.remove();showToast('Verlauf gespeichert');showOrder(id);
  };
}