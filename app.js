const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(n||0));
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let currentUser=null, customers=[], companies=[], orders=[];
const ADMIN_ROLE='Administrator';
const ENTRY_ROLE='Auftragserfassung';
function isAdmin(){return currentUser?.rolle===ADMIN_ROLE;}
function isEntryUser(){return currentUser?.rolle===ENTRY_ROLE;}
function canPage(page){return isAdmin() || (isEntryUser() && page==='order-entry');}
function applyRoleUI(){
  document.querySelectorAll('.admin-only').forEach(b=>b.classList.toggle('hidden',!isAdmin()));
  document.querySelectorAll('.nav').forEach(b=>{
    const allowed=isAdmin() || (isEntryUser() && b.dataset.page==='order-entry');
    b.classList.toggle('hidden',!allowed);
  });
}

document.addEventListener('DOMContentLoaded', async ()=>{
  $('#loginForm').addEventListener('submit', login);
  $('#logoutBtn').addEventListener('click', ()=>{
    localStorage.removeItem('vermittlung_app_user');
    currentUser=null;
    renderAuth();
  });
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>navigate(b.dataset.page));

  const saved=localStorage.getItem('vermittlung_app_user');
  if(saved){
    try{ currentUser=JSON.parse(saved); }
    catch{ localStorage.removeItem('vermittlung_app_user'); currentUser=null; }
  }
  renderAuth();
});

async function login(e){
  e.preventDefault();
  $('#loginMsg').textContent='';
  const email=$('#email').value.trim();
  const password=$('#password').value;

  if(!email||!password){
    $('#loginMsg').textContent='Bitte E-Mail und Passwort eingeben.';
    return;
  }

  const {data,error}=await db.rpc('vermittlung_login',{
    p_email:email,
    p_password:password
  });

  if(error){
    $('#loginMsg').textContent='Anmeldung fehlgeschlagen: '+error.message;
    return;
  }

  const user=Array.isArray(data)?data[0]:data;
  if(!user){
    $('#loginMsg').textContent='E-Mail oder Passwort ist falsch.';
    return;
  }

  currentUser={
    id:user.id,
    name:user.name,
    email:user.email,
    rolle:user.rolle
  };
  localStorage.setItem('vermittlung_app_user',JSON.stringify(currentUser));
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
  $('#googleForm').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.target);localStorage.setItem(GOOGLE_SYNC_URL_KEY,fd.get('url').trim());localStorage.setItem(GOOGLE_SYNC_TOKEN_KEY,fd.get('token').trim());toast('Google-Verbindung gespeichert');};
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
    toast('Synchronisierung gestartet');
  }catch(e){alert('Google-Synchronisierung konnte nicht gestartet werden: '+e.message)}
}

async function navigate(page){
  if(isEntryUser()) page='order-entry';
  if(!isAdmin() && page!=='order-entry') page='order-entry';
  localStorage.setItem('vermittlung_current_page',page);
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(isEntryUser()){renderOrderEntry();return;}
  await loadBase();
  ({dashboard:renderDashboard,orders:renderOrders,customers:renderCustomers,companies:renderCompanies,commissions:renderCommissions,reports:renderReports,google:renderGoogle,settings:renderSettings}[page]||renderDashboard)();
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

function orderTable(list){if(!list.length)return '<p class="muted">Keine Aufträge vorhanden.</p>';return `<div class="table-wrap"><table class="table"><thead><tr><th>Nr.</th><th>Bereich</th><th>Status</th><th>Auftrag</th><th>Wert</th><th>Provision</th><th></th></tr></thead><tbody>${list.map(o=>`<tr><td><button class="secondary" onclick="showOrder('${o.id}')">${esc(o.auftragsnummer||'—')}</button></td><td>${esc(o.bereich)}</td><td><span class="badge status">${esc(o.status)}</span></td><td>${esc(o.beschreibung||'—')}</td><td>${money(o.auftragswert_netto)}</td><td>${money(o.provision)}</td><td><button class="delete-btn" onclick="deleteOrder('${o.id}');event.stopPropagation()">Löschen</button></td></tr>`).join('')}</tbody></table></div>`}
function renderOrders(){const body=`<div class="toolbar"><input id="orderSearch" placeholder="Aufträge suchen…" oninput="filterOrders()"><button class="primary" onclick="newOrder()">+ Neuer Auftrag</button></div><div id="ordersTable">${orderTable(orders)}</div>`;$('#main').innerHTML=page('Aufträge',body)}
function filterOrders(){const q=$('#orderSearch').value.toLowerCase();$('#ordersTable').innerHTML=orderTable(orders.filter(o=>JSON.stringify(o).toLowerCase().includes(q)))}
async function deleteCustomer(id){if(!confirm('Diesen Kunden wirklich löschen?'))return;const {error}=await db.from('vermittlung_kunden').delete().eq('id',id);if(error){alert('Kunde konnte nicht gelöscht werden: '+error.message);return}toast('Kunde gelöscht');navigate('customers')}
async function deleteCompany(id){if(!confirm('Diese Firma wirklich löschen?'))return;const {error}=await db.from('vermittlung_firmen').delete().eq('id',id);if(error){alert('Firma konnte nicht gelöscht werden: '+error.message);return}toast('Firma gelöscht');navigate('companies')}
async function deleteOrder(id){if(!confirm('Diesen Auftrag wirklich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.'))return;const {error}=await db.from('vermittlung_auftraege').delete().eq('id',id);if(error){alert('Auftrag konnte nicht gelöscht werden: '+error.message);return}toast('Auftrag gelöscht');navigate('orders')}
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
    m.remove();toast('Kunde gespeichert');navigate('customers');
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
    m.remove();toast('Firma gespeichert');navigate('companies');
  };
}
function renderCommissions(){
  const active=orders.filter(o=>o.status!=='Storniert');
  const groups={};
  active.forEach(o=>{
    const raw=o.bereich||'Sonstige Vermittlung';
    const gewerk=({Reinigungsvermittlung:'Reinigung',Gartenvermittlung:'Gartenarbeiten'})[raw]||raw;
    if(!groups[gewerk])groups[gewerk]={count:0,vol:0,prov:0,paid:0};
    groups[gewerk].count++;
    groups[gewerk].vol+=Number(o.auftragswert_netto||0);
    groups[gewerk].prov+=Number(o.provision||0);
    if(o.provision_bezahlt)groups[gewerk].paid+=Number(o.provision||0);
  });
  const total=active.reduce((s,o)=>s+Number(o.provision||0),0);
  const paid=active.filter(o=>o.provision_bezahlt).reduce((s,o)=>s+Number(o.provision||0),0);
  const summary=Object.entries(groups).sort((a,b)=>b[1].prov-a[1].prov).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v.count}</td><td>${money(v.vol)}</td><td>${money(v.prov)}</td><td>${money(v.paid)}</td><td>${money(v.prov-v.paid)}</td></tr>`).join('');
  const rows=active.map(o=>`<tr><td>${esc(o.auftragsnummer)}</td><td>${esc(o.bereich)}</td><td>${money(o.auftragswert_netto)}</td><td>${money(o.provision)}</td><td>${o.provision_abgerechnet?'Ja':'Nein'}</td><td>${o.provision_bezahlt?'Ja':'Nein'}</td></tr>`).join('');
  $('#main').innerHTML=page('Provisionen',`
    <div class="dashboard-cards">
      <div class="dash-card blue"><span>Provision gesamt</span><strong>${money(total)}</strong><small>10 % aller aktiven Aufträge</small></div>
      <div class="dash-card green"><span>Provision bezahlt</span><strong>${money(paid)}</strong><small>bereits eingegangen</small></div>
      <div class="dash-card orange"><span>Provision offen</span><strong>${money(total-paid)}</strong><small>noch nicht bezahlt</small></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-title-row"><div><span class="eyebrow">GEWERKE</span><h3>Provision nach Gewerk</h3></div><span class="badge status">10 % je Gewerk</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Gewerk</th><th>Aufträge</th><th>Auftragsvolumen</th><th>Provision 10 %</th><th>Bezahlt</th><th>Offen</th></tr></thead><tbody>${summary||'<tr><td colspan="6">Keine Daten.</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="panel-title-row"><div><span class="eyebrow">FIRMEN / SUBUNTERNEHMER</span><h3>Provisionen je Firma</h3></div><button class="secondary" onclick="navigate('companies')">Firmen verwalten →</button></div>
      <p class="muted">Hier siehst du für jede angelegte Firma die von uns verdiente Vermittlungsprovision. Neue Firmen erscheinen automatisch in dieser Liste.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Firma</th><th>Aufträge</th><th>Auftragsvolumen</th><th>Provision für uns</th><th>Bezahlt</th><th>Offen</th></tr></thead><tbody>${renderCompanyCommissionRows(active)||'<tr><td colspan="6">Noch keine Firmen angelegt.</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <h3>Einzelne Provisionen</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Auftrag</th><th>Bereich</th><th>Auftragswert</th><th>Provision 10 %</th><th>Abgerechnet</th><th>Bezahlt</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Keine Daten.</td></tr>'}</tbody></table></div>
    </div>`)}
function renderCompanyCommissionRows(active){
  const byCompany=new Map(companies.map(c=>[c.id,{name:c.firmenname||'Unbenannte Firma',count:0,vol:0,prov:0,paid:0}]));
  const unassigned={name:'Nicht zugeordnet',count:0,vol:0,prov:0,paid:0};
  active.forEach(o=>{
    const value=Number(o.auftragswert_netto||0);
    const prov=Number(o.provision||0);
    const row=o.ausfuehrende_firma_id&&byCompany.has(o.ausfuehrende_firma_id) ? byCompany.get(o.ausfuehrende_firma_id) : unassigned;
    row.count++; row.vol+=value; row.prov+=prov;
    if(o.provision_bezahlt) row.paid+=prov;
  });
  const rows=[...byCompany.values()].sort((a,b)=>b.prov-a.prov||a.name.localeCompare(b.name,'de'));
  if(unassigned.count) rows.push(unassigned);
  return rows.map(v=>`<tr><td><strong>${esc(v.name)}</strong></td><td>${v.count}</td><td>${money(v.vol)}</td><td><strong>${money(v.prov)}</strong></td><td>${money(v.paid)}</td><td>${money(v.prov-v.paid)}</td></tr>`).join('');
}
function renderReports(){
  const valid=periodAccounts.filter(a=>a.status!=='Storniert');
  const months={},years={},companyMonths={};
  valid.forEach(a=>{
    const date=String(a.abrechnungsmonat||'').slice(0,10); if(!date)return;
    const [yy,mm]=date.split('-'); const m=`${mm}/${yy}`, y=yy;
    for(const [obj,key] of [[months,m],[years,y]]){obj[key]??={count:0,vol:0,prov:0,paid:0};obj[key].count++;obj[key].vol+=Number(a.auftragswert_netto||0);obj[key].prov+=Number(a.provision||0);if(a.bezahlt)obj[key].paid+=Number(a.provision||0);}
    const firm=companies.find(c=>String(c.id)===String(a.firma_id))?.firmenname||'Nicht zugeordnet';
    const ck=`${m} · ${firm}`;companyMonths[ck]??={month:m,firm,count:0,vol:0,prov:0,paid:0};
    companyMonths[ck].count++;companyMonths[ck].vol+=Number(a.auftragswert_netto||0);companyMonths[ck].prov+=Number(a.provision||0);if(a.bezahlt)companyMonths[ck].paid+=Number(a.provision||0);
  });
  const table=(obj)=>`<div class="table-wrap"><table class="table"><thead><tr><th>Zeitraum</th><th>Abrechnungen</th><th>Auftragsvolumen</th><th>Provision</th><th>Bezahlt</th><th>Offen</th></tr></thead><tbody>${Object.entries(obj).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v.count}</td><td>${money(v.vol)}</td><td>${money(v.prov)}</td><td>${money(v.paid)}</td><td>${money(v.prov-v.paid)}</td></tr>`).join('')||'<tr><td colspan="6">Keine Abrechnungsdaten. Bitte zuerst die SQL-Einrichtung ausführen.</td></tr>'}</tbody></table></div>`;
  const rows=valid.slice().sort((a,b)=>String(b.abrechnungsmonat).localeCompare(String(a.abrechnungsmonat))).map(a=>{
    const o=orders.find(x=>String(x.id)===String(a.auftrag_id)); const firm=companies.find(c=>String(c.id)===String(a.firma_id));
    const status=a.bezahlt?'Bezahlt':'Offen';
    return `<tr><td>${esc(String(a.abrechnungsmonat||'').slice(0,7))}</td><td>${esc(o?.auftragsnummer||a.auftrag_id||'—')}</td><td>${esc(firm?.firmenname||'Nicht zugeordnet')}</td><td>${money(a.auftragswert_netto)}</td><td>${money(a.provision)}</td><td><span class="badge status" style="background:${a.bezahlt?'#d8f5df':'#ffe0e0'};color:${a.bezahlt?'#176534':'#9f2020'}">${status}</span></td><td>${a.bezahlt?esc(a.zahlungsdatum||'—'):'—'}</td><td><button class="${a.bezahlt?'secondary':'primary'}" onclick="togglePeriodPaid('${a.id}',${!a.bezahlt})">${a.bezahlt?'Als offen markieren':'Als bezahlt markieren'}</button></td></tr>`;
  }).join('');
  $('#main').innerHTML=page('Monats- / Jahresabrechnung',`
    <div class="panel"><p class="muted">Die Auswertung basiert auf einzelnen Abrechnungszeiträumen. Ein wiederkehrender Auftrag bleibt derselbe Auftrag; jede Periode hat einen eigenen Zahlungsstatus.</p></div>
    <h3>Monatsauswertung</h3>${table(months)}
    <h3 style="margin-top:25px">Monatsauswertung je Firma</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Monat</th><th>Firma</th><th>Abrechnungen</th><th>Auftragsvolumen</th><th>Provision</th><th>Bezahlt</th><th>Offen</th></tr></thead><tbody>${Object.values(companyMonths).sort((a,b)=>b.month.localeCompare(a.month)||a.firm.localeCompare(b.firm,'de')).map(v=>`<tr><td>${esc(v.month)}</td><td>${esc(v.firm)}</td><td>${v.count}</td><td>${money(v.vol)}</td><td>${money(v.prov)}</td><td>${money(v.paid)}</td><td>${money(v.prov-v.paid)}</td></tr>`).join('')||'<tr><td colspan="7">Keine Firmendaten vorhanden.</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:25px">Jahresauswertung</h3>${table(years)}
    <div class="panel" style="margin-top:22px"><div class="panel-title-row"><div><h3>Einzelne Abrechnungsperioden</h3><p class="muted">Grün = bezahlt, Rot = offen.</p></div><button class="secondary" onclick="generatePeriodsNow()">Abrechnungen jetzt prüfen</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Monat</th><th>Auftrag</th><th>Firma</th><th>Auftragswert</th><th>Provision</th><th>Status</th><th>Zahlungsdatum</th><th>Aktion</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Noch keine Abrechnungsperioden. Bitte SQL einrichten und danach „Abrechnungen jetzt prüfen“ wählen.</td></tr>'}</tbody></table></div></div>`);
}
async function togglePeriodPaid(id,paid){
  if(!isAdmin())return;
  const update={bezahlt:paid,zahlungsdatum:paid?new Date().toISOString().slice(0,10):null,aktualisiert_am:new Date().toISOString()};
  const {error}=await db.from('vermittlung_auftragsabrechnungen').update(update).eq('id',id);
  if(error){alert('Zahlungsstatus konnte nicht geändert werden: '+error.message);return;}
  toast(paid?'Abrechnungsperiode als bezahlt markiert':'Abrechnungsperiode wieder offen');
  await loadBase();renderReports();
}
async function generatePeriodsNow(){
  if(!isAdmin())return;
  const {data,error}=await db.rpc('vermittlung_generate_due_periods',{p_actor_email:currentUser.email});
  if(error){alert('Abrechnungen konnten nicht erzeugt werden. Bitte SQL-Einrichtung und Berechtigungen prüfen: '+error.message);return;}
  toast(`Abrechnungen geprüft: ${data?.created_count??'fertig'}`);
  await loadBase();renderReports();
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
    toast('Auftrag gespeichert');
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
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const {error}=await db.rpc('vermittlung_admin_create_user',{p_actor_email:currentUser.email,p_name:d.name,p_email:d.email,p_password:d.password,p_rolle:d.rolle});if(error){alert(error.message);return}m.remove();toast('Benutzer angelegt');loadAppUsers();};
}
function editAppUser(id,name,email,rolle,aktiv){
  const m=modal(`<h2>Benutzer bearbeiten</h2><form id="editAppUserForm" class="form-grid">
    <label>Name<input name="name" value="${esc(name)}" required></label><label>E-Mail<input name="email" type="email" value="${esc(email)}" required></label>
    <label>Neue Rolle<select name="rolle"><option value="Auftragserfassung" ${rolle==='Auftragserfassung'?'selected':''}>Auftragserfassung</option><option value="Administrator" ${rolle==='Administrator'?'selected':''}>Administrator</option></select></label>
    <label>Status<select name="aktiv"><option value="true" ${aktiv?'selected':''}>Aktiv</option><option value="false" ${!aktiv?'selected':''}>Deaktiviert</option></select></label>
    <label class="full">Neues Passwort (leer lassen = unverändert)<input name="password" type="password" minlength="8"></label>
    <div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Änderungen speichern</button></div>
  </form>`);
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const {error}=await db.rpc('vermittlung_admin_update_user',{p_actor_email:currentUser.email,p_user_id:id,p_name:d.name,p_email:d.email,p_password:d.password||null,p_rolle:d.rolle,p_aktiv:d.aktiv==='true'});if(error){alert(error.message);return}m.remove();toast('Benutzer geändert');loadAppUsers();};
}
async function deleteAppUser(id){if(!confirm('Diesen Benutzer wirklich löschen?'))return;const {error}=await db.rpc('vermittlung_admin_delete_user',{p_actor_email:currentUser.email,p_user_id:id});if(error){alert(error.message);return}toast('Benutzer gelöscht');loadAppUsers();}

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
    else toast(files.length?`Auftrag und ${files.length} Dokument(e) gespeichert`:'Auftrag gespeichert');
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
    toast('Auftrags-E-Mail versendet');
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
      <p class="muted">Dateien werden beim Anlegen des Auftrags hochgeladen. Die unten aufgeführten Dokumente können beim E-Mail-Versand ausgewählt werden.</p>
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

  m.querySelector('#detailForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), d=Object.fromEntries(fd.entries());
    for(const k of ['kostenvoranschlag_netto','kostenvoranschlag_brutto','auftragswert_netto']) d[k]=Number(d[k]||0);
    for(const k of ['provision_abgerechnet','provision_bezahlt','wiederholung_aktiv']) if(d[k]!==undefined)d[k]=d[k]==='true';
    d.wiederholung=d.wiederholung||'Einmalig'; if(d.wiederholung==='Einmalig')d.wiederholung_aktiv=false; d.wiederholung_beginn=d.wiederholung_beginn||d.geplanter_beginn||null; d.wiederholung_ende=d.wiederholung_ende||null;
    d.versicherung=d.versicherung===''?null:d.versicherung==='true';
    d.ausfuehrende_firma_id=d.ausfuehrende_firma_id||null;
    d.updated_at=new Date().toISOString();
    const {error}=await db.from('vermittlung_auftraege').update(d).eq('id',id);
    if(error){alert(error.message);return}
    m.remove();toast('Auftrag aktualisiert');navigate('orders');
  };

  m.querySelector('#historyForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), notiz=fd.get('notiz');
    const {error}=await db.from('vermittlung_verlauf').insert({
      auftrag_id:id, aktivitaet:'Bearbeitung', notiz, bearbeiter:currentUser.email
    });
    if(error){alert(error.message);return}
    m.remove();toast('Verlauf gespeichert');showOrder(id);
  };
}