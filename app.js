const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(n||0));
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let currentUser=null, customers=[], companies=[], orders=[], currentPage=localStorage.getItem('vermittlung_last_page')||'dashboard', appInitialized=false;

document.addEventListener('DOMContentLoaded', async ()=>{
  $('#loginForm').addEventListener('submit', login);
  $('#logoutBtn').addEventListener('click', ()=>{
    localStorage.removeItem('vermittlung_app_user');
    currentUser=null;
    appInitialized=false;
    renderAuth();
  });
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>navigate(b.dataset.page));

  // Eigene Anmeldung nur für das Vermittlungssystem.
  // Supabase Auth wird hier bewusst NICHT verwendet.
  const saved=localStorage.getItem('vermittlung_app_user');
  if(saved){
    try{currentUser=JSON.parse(saved);}catch{
      localStorage.removeItem('vermittlung_app_user');
      currentUser=null;
    }
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
    $('#userName').textContent=currentUser.email||'';
    // Only choose the initial page when the app is first opened.
    // Auth refresh/token events must not send the user back to the dashboard.
    if(!appInitialized){
      appInitialized=true;
      navigate(currentPage);
    }
  }else{
    appInitialized=false;
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }
}
async function loadBase(){const [c,f,o]=await Promise.all([db.from('vermittlung_kunden').select('*').order('nachname'),db.from('vermittlung_firmen').select('*').order('firmenname'),db.from('vermittlung_auftraege').select('*').order('erstellt_am',{ascending:false})]);customers=c.data||[];companies=f.data||[];orders=o.data||[];}
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
function toast(message){
  const el=$('#toast');
  if(!el){console.log(message);return}
  el.textContent=message;
  el.classList.add('show');
  clearTimeout(window.__vermittlungToastTimer);
  window.__vermittlungToastTimer=setTimeout(()=>el.classList.remove('show'),3000);
}

async function syncGoogle(){
  const u=googleSyncUrl(),t=googleSyncToken();
  if(!u||!t){alert('Bitte zuerst die Google-Verbindung speichern.');navigate('google');return}
  await loadBase();
  const payload={action:'syncAll',token:t,user:currentUser?.email||'',generatedAt:new Date().toISOString(),orders,customers,companies};
  try{
    let frame=document.getElementById('vermittlungGoogleSyncFrame');
    if(!frame){
      frame=document.createElement('iframe');
      frame.id='vermittlungGoogleSyncFrame';
      frame.name='vermittlungGoogleSyncFrame';
      frame.style.display='none';
      document.body.appendChild(frame);
    }
    const form=document.createElement('form');
    form.method='POST';
    form.action=u;
    form.target='vermittlungGoogleSyncFrame';
    form.style.display='none';
    const input=document.createElement('input');
    input.type='hidden';
    input.name='payload';
    input.value=JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    const s=$('#googleStatus');
    if(s)s.textContent='Synchronisierung wurde an Google übergeben. Bitte kurz warten, bis die Tabellen aktualisiert sind.';
    toast('Synchronisierung gestartet');
  }catch(e){alert('Google-Synchronisierung konnte nicht gestartet werden: '+e.message)}
}

async function navigate(page){
  currentPage=page;
  localStorage.setItem('vermittlung_last_page',page);
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  await loadBase();
  ({dashboard:renderDashboard,orders:renderOrders,customers:renderCustomers,companies:renderCompanies,commissions:renderCommissions,reports:renderReports,google:renderGoogle}[page]||renderDashboard)();
}
function page(title,body,actions=''){return `<div class="page"><div class="page-head"><h2>${title}</h2><div>${actions}</div></div>${body}</div>`}
function renderDashboard(){const open=orders.filter(o=>!['Abgeschlossen','Abgerechnet','Storniert'].includes(o.status));const vol=orders.filter(o=>o.status!=='Storniert').reduce((s,o)=>s+Number(o.auftragswert_netto||0),0);const prov=orders.filter(o=>o.status!=='Storniert').reduce((s,o)=>s+Number(o.provision||0),0);const unpaid=orders.filter(o=>o.status!=='Storniert'&&!o.provision_bezahlt).reduce((s,o)=>s+Number(o.provision||0),0);const urgent=open.filter(o=>o.prioritaet==='Dringend');$('#main').innerHTML=page('Dashboard',`<div class="grid cards"><div class="card"><div class="label">Offene Aufträge</div><div class="value">${open.length}</div></div><div class="card"><div class="label">Auftragsvolumen</div><div class="value">${money(vol)}</div></div><div class="card"><div class="label">Provision gesamt</div><div class="value green">${money(prov)}</div></div><div class="card"><div class="label">Provision offen</div><div class="value red">${money(unpaid)}</div></div></div><div class="grid" style="grid-template-columns:2fr 1fr;margin-top:18px"><div class="panel"><h3>Aktuelle Aufträge</h3>${orderTable(orders.slice(0,8))}</div><div class="panel"><h3>Dringend</h3><p>${urgent.length} dringende offene Aufträge</p><button class="secondary" onclick="navigate('orders')">Aufträge öffnen</button></div></div>`)}
function orderTable(list){if(!list.length)return '<p class="muted">Keine Aufträge vorhanden.</p>';return `<div class="table-wrap"><table class="table"><thead><tr><th>Nr.</th><th>Bereich</th><th>Status</th><th>Auftrag</th><th>Wert</th><th>Provision</th><th>Aktion</th></tr></thead><tbody>${list.map(o=>`<tr><td><button class="secondary" onclick="showOrder('${o.id}')">${esc(o.auftragsnummer||'—')}</button></td><td>${esc(o.bereich)}</td><td><span class="badge status">${esc(o.status)}</span></td><td>${esc(o.beschreibung||'—')}</td><td>${money(o.auftragswert_netto)}</td><td>${money(o.provision)}</td><td><button class="secondary" onclick="deleteOrder('${o.id}')">Löschen</button></td></tr>`).join('')}</tbody></table></div>`}
function renderOrders(){const body=`<div class="toolbar"><input id="orderSearch" placeholder="Aufträge suchen…" oninput="filterOrders()"><button class="primary" onclick="newOrder()">+ Neuer Auftrag</button></div><div id="ordersTable">${orderTable(orders)}</div>`;$('#main').innerHTML=page('Aufträge',body)}
function filterOrders(){const q=$('#orderSearch').value.toLowerCase();$('#ordersTable').innerHTML=orderTable(orders.filter(o=>JSON.stringify(o).toLowerCase().includes(q)))}
function renderCustomers(){
  const rows=customers.map(c=>`<tr>
    <td><button class="secondary" onclick="showCustomer('${c.id}')">${esc((c.vorname||'')+' '+(c.nachname||''))}</button></td>
    <td>${esc(c.firma||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td>
    <td>${esc((c.strasse||'')+' '+(c.plz||'')+' '+(c.ort||''))}</td>
    <td><button class="secondary" onclick="deleteCustomer('${c.id}')">Löschen</button></td>
  </tr>`).join('');
  $('#main').innerHTML=page('Kunden',`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Firma</th><th>Telefon</th><th>E-Mail</th><th>Adresse</th><th>Aktion</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Noch keine Kunden.</td></tr>'}</tbody></table></div>`)
}

function showCustomer(id){
  const c=customers.find(x=>x.id===id);
  if(!c)return;
  const name=((c.vorname||'')+' '+(c.nachname||'')).trim()||'Kunde';
  const linked=orders.filter(o=>o.kunde_id===id);
  const m=modal(`
    <div class="page-head">
      <div><h2>${esc(name)}</h2><p class="muted">Kundendetails</p></div>
      <button class="close" onclick="this.closest('.modal').remove()">Schließen</button>
    </div>
    <div class="panel">
      <p><strong>Firma:</strong> ${esc(c.firma||'—')}</p>
      <p><strong>Telefon:</strong> ${esc(c.telefon||'—')}</p>
      <p><strong>E-Mail:</strong> ${esc(c.email||'—')}</p>
      <p><strong>Adresse:</strong> ${esc((c.strasse||'')+' '+(c.plz||'')+' '+(c.ort||'')||'—')}</p>
      ${linked.length?`<p class="muted">Mit diesem Kunden sind ${linked.length} Auftrag/Aufträge verknüpft. Daher kann er aktuell nicht gelöscht werden.</p>`:''}
      <div class="actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Schließen</button>
        <button class="secondary" onclick="deleteCustomer('${c.id}');this.closest('.modal').remove()">Kunden löschen</button>
      </div>
    </div>`);
}
function renderCompanies(){
  const rows=companies.map(c=>`<tr>
    <td><button class="secondary" onclick="showCompany('${c.id}')">${esc(c.firmenname)}</button></td>
    <td>${esc(c.ansprechpartner||'')}</td><td>${esc(c.gewerk||'')}</td><td>${esc(c.telefon||'')}</td><td>${esc(c.email||'')}</td>
    <td><button class="secondary" onclick="deleteCompany('${c.id}')">Löschen</button></td>
  </tr>`).join('');
  $('#main').innerHTML=page('Firmen / Subunternehmer',`<div class="table-wrap"><table class="table"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Gewerk</th><th>Telefon</th><th>E-Mail</th><th>Aktion</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Noch keine Firmen.</td></tr>'}</tbody></table></div>`)
}

function showCompany(id){
  const c=companies.find(x=>x.id===id);
  if(!c)return;
  const linked=orders.filter(o=>o.ausfuehrende_firma_id===id);
  const m=modal(`
    <div class="page-head">
      <div><h2>${esc(c.firmenname||'Firma')}</h2><p class="muted">Firmendetails</p></div>
      <button class="close" onclick="this.closest('.modal').remove()">Schließen</button>
    </div>
    <div class="panel">
      <p><strong>Ansprechpartner:</strong> ${esc(c.ansprechpartner||'—')}</p>
      <p><strong>Gewerk:</strong> ${esc(c.gewerk||'—')}</p>
      <p><strong>Telefon:</strong> ${esc(c.telefon||'—')}</p>
      <p><strong>E-Mail:</strong> ${esc(c.email||'—')}</p>
      ${linked.length?`<p class="muted">Mit dieser Firma sind ${linked.length} Auftrag/Aufträge verknüpft. Daher kann sie aktuell nicht gelöscht werden.</p>`:''}
      <div class="actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Schließen</button>
        <button class="secondary" onclick="deleteCompany('${c.id}');this.closest('.modal').remove()">Firma löschen</button>
      </div>
    </div>`);
}
async function deleteCustomer(id){
  const c=customers.find(x=>x.id===id); if(!c)return;
  const linked=orders.filter(o=>o.kunde_id===id);
  if(linked.length){alert('Dieser Kunde kann nicht gelöscht werden, weil noch '+linked.length+' Auftrag/Aufträge mit ihm verknüpft sind.');return;}
  if(!confirm('Kunde '+((c.vorname||'')+' '+(c.nachname||'')).trim()+' wirklich löschen?'))return;
  const {error}=await db.from('vermittlung_kunden').delete().eq('id',id);
  if(error){alert('Kunde konnte nicht gelöscht werden: '+error.message);return;}
  toast('Kunde gelöscht'); await navigate('customers');
}
async function deleteCompany(id){
  const c=companies.find(x=>x.id===id); if(!c)return;
  const linked=orders.filter(o=>o.ausfuehrende_firma_id===id);
  if(linked.length){alert('Diese Firma kann nicht gelöscht werden, weil noch '+linked.length+' Auftrag/Aufträge mit ihr verknüpft sind.');return;}
  if(!confirm('Firma '+(c.firmenname||'')+' wirklich löschen?'))return;
  const {error}=await db.from('vermittlung_firmen').delete().eq('id',id);
  if(error){alert('Firma konnte nicht gelöscht werden: '+error.message);return;}
  toast('Firma gelöscht'); await navigate('companies');
}
async function deleteOrder(id){
  const o=orders.find(x=>x.id===id); if(!o)return;
  if(!confirm('Auftrag '+(o.auftragsnummer||'')+' wirklich vollständig löschen?\n\nDabei werden auch Verlauf, Dokumentation und Provision dieses Auftrags gelöscht.'))return;
  const checks=[
    await db.from('vermittlung_verlauf').delete().eq('auftrag_id',id),
    await db.from('vermittlung_dokumente').delete().eq('auftrag_id',id),
    await db.from('vermittlung_provisionen').delete().eq('auftrag_id',id)
  ];
  const depError=checks.find(x=>x.error)?.error;
  if(depError){alert('Zugehörige Daten konnten nicht gelöscht werden: '+depError.message);return;}
  const {error}=await db.from('vermittlung_auftraege').delete().eq('id',id);
  if(error){alert('Auftrag konnte nicht gelöscht werden: '+error.message);return;}
  toast('Auftrag gelöscht'); await navigate('orders');
}
function renderCommissions(){const active=orders.filter(o=>o.status!=='Storniert');const rows=active.map(o=>`<tr><td>${esc(o.auftragsnummer)}</td><td>${esc(o.bereich)}</td><td>${money(o.auftragswert_netto)}</td><td>${money(o.provision)}</td><td>${o.provision_abgerechnet?'Ja':'Nein'}</td><td>${o.provision_bezahlt?'Ja':'Nein'}</td></tr>`).join('');$('#main').innerHTML=page('Provisionen',`<div class="table-wrap"><table class="table"><thead><tr><th>Auftrag</th><th>Bereich</th><th>Auftragswert</th><th>Provision 10 %</th><th>Abgerechnet</th><th>Bezahlt</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Keine Daten.</td></tr>'}</tbody></table></div>`)}
function renderReports(){const active=orders.filter(o=>o.status!=='Storniert');const months={};const years={};active.forEach(o=>{const d=new Date(o.erstellt_am);const m=d.toLocaleDateString('de-DE',{month:'2-digit',year:'numeric'});const y=d.getFullYear();for(const [obj,key] of [[months,m],[years,y]]){obj[key]??={count:0,vol:0,prov:0,paid:0};obj[key].count++;obj[key].vol+=Number(o.auftragswert_netto||0);obj[key].prov+=Number(o.provision||0);if(o.provision_bezahlt)obj[key].paid+=Number(o.provision||0)}});const table=(obj)=>`<div class="table-wrap"><table class="table"><thead><tr><th>Zeitraum</th><th>Aufträge</th><th>Auftragsvolumen</th><th>Provision</th><th>Bezahlt</th><th>Offen</th></tr></thead><tbody>${Object.entries(obj).sort().reverse().map(([k,v])=>`<tr><td>${k}</td><td>${v.count}</td><td>${money(v.vol)}</td><td>${money(v.prov)}</td><td>${money(v.paid)}</td><td>${money(v.prov-v.paid)}</td></tr>`).join('')||'<tr><td colspan="6">Keine Daten.</td></tr>'}</tbody></table></div>`;$('#main').innerHTML=page('Monats- / Jahresabrechnung',`<h3>Monat</h3>${table(months)}<h3 style="margin-top:25px">Jahr</h3>${table(years)}`)}
function modal(content){const el=document.createElement('div');el.className='modal show';el.innerHTML=`<div class="modal-card">${content}</div>`;document.body.appendChild(el);return el}
function newOrder(){const m=modal(`<h2>Neuer Auftrag</h2><form id="orderForm" class="form-grid"><label>Bereich<select name="bereich"><option>Wasserschaden / Sanierung</option><option>Reinigungsvermittlung</option><option>Gartenvermittlung</option><option>Immobilien / Vermietung</option><option>Sonstige Vermittlung</option></select></label><label>Priorität<select name="prioritaet"><option>Normal</option><option>Dringend</option></select></label><label>Status<select name="status">${['Neue Anfrage','In Prüfung','Kostenvoranschlag angefordert','Kostenvoranschlag erhalten','Angebot beim Kunden','Auftrag erteilt','In Ausführung','Abgeschlossen','Provision offen','Abgerechnet','Storniert'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Verantwortlich<input name="verantwortlich"></label><label>Kunde<select name="kunde_id"><option value="">— neuer / noch nicht zugeordnet —</option>${customers.map(c=>`<option value="${c.id}">${esc((c.vorname||'')+' '+(c.nachname||'')+(c.firma?' – '+c.firma:''))}</option>`).join('')}</select></label><label>Ausführende Firma<select name="ausfuehrende_firma_id"><option value="">— noch nicht zugeordnet —</option>${companies.map(c=>`<option value="${c.id}">${esc(c.firmenname)}</option>`).join('')}</select></label><label class="full">Objektadresse<input name="objekt_adresse"></label><label>Objekttyp<select name="objekt_typ"><option>Wohnung</option><option>Einfamilienhaus</option><option>Mehrfamilienhaus</option><option>Gewerbe</option><option>Sonstiges</option></select></label><label>Geplanter Beginn<input type="date" name="geplanter_beginn"></label><label class="full">Beschreibung<textarea name="beschreibung"></textarea></label><label>Kostenvoranschlag netto<input type="number" step="0.01" name="kostenvoranschlag_netto" value="0"></label><label>Kostenvoranschlag brutto<input type="number" step="0.01" name="kostenvoranschlag_brutto" value="0"></label><label>Auftragswert netto<input type="number" step="0.01" name="auftragswert_netto" value="0"></label><label>Schadensart (bei Wasserschaden)<input name="schadensart"></label><label>Schadensort<input name="schadensort"></label><label>Versicherung<select name="versicherung"><option value="">unbekannt</option><option value="true">Ja</option><option value="false">Nein</option></select></label><label>Schadennummer<input name="schadennummer"></label><label>Versicherungsgesellschaft<input name="versicherungsgesellschaft"></label><label>Notizen<textarea name="notizen"></textarea></label><div class="full actions"><button type="button" class="close" onclick="this.closest('.modal').remove()">Abbrechen</button><button class="primary">Auftrag speichern</button></div></form>`);m.querySelector('form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const d=Object.fromEntries(fd.entries());for(const k of ['kunde_id','ausfuehrende_firma_id'])if(!d[k])d[k]=null;for(const k of ['kostenvoranschlag_netto','kostenvoranschlag_brutto','auftragswert_netto'])d[k]=Number(d[k]||0);d.versicherung=d.versicherung===''?null:d.versicherung==='true';d.created_by=currentUser.email;const {error}=await db.from('vermittlung_auftraege').insert(d);if(error){alert(error.message);return}m.remove();toast('Auftrag gespeichert');navigate('orders')}}
async function showOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;

  const history=await db.from('vermittlung_verlauf')
    .select('*').eq('auftrag_id',id).order('datum',{ascending:false});
  const docs=await db.from('vermittlung_dokumente')
    .select('*').eq('auftrag_id',id).order('erstellt_am',{ascending:false});

  const m=modal(`
    <div class="page-head">
      <div>
        <h2>Auftrag ${esc(o.auftragsnummer||'')}</h2>
        <p class="muted">${esc(o.bereich)}</p>
      </div>
      <button class="close" onclick="this.closest('.modal').remove()">Schließen</button>
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
      <form id="docForm" class="form-grid">
        <label>Dokumenttyp<select name="dokumenttyp">
          <option>Kostenvoranschlag</option><option>Angebot</option><option>Rechnung</option>
          <option>Foto</option><option>Vertrag</option><option>Sonstiges</option>
        </select></label>
        <label>Dateiname<input name="dateiname" required placeholder="z. B. Angebot Müller.pdf"></label>
        <label>Google-Drive-Pfad / Ordner<input name="drive_pfad" placeholder="2026/2026-001 Müller Wasserschaden/Angebote"></label>
        <label>Google-Drive-Link<input name="drive_url" type="url"></label>
        <div class="full actions"><button class="primary">Dokument verknüpfen</button></div>
      </form>
      <div class="table-wrap">
        <table class="table"><thead><tr><th>Typ</th><th>Datei</th><th>Drive</th><th>Erstellt</th></tr></thead>
        <tbody>${(docs.data||[]).map(d=>`<tr>
          <td>${esc(d.dokumenttyp)}</td><td>${esc(d.dateiname)}</td>
          <td>${d.drive_url?`<a href="${esc(d.drive_url)}" target="_blank" rel="noopener">Öffnen</a>`:esc(d.drive_pfad||'—')}</td>
          <td>${new Date(d.erstellt_am).toLocaleString('de-DE')}</td>
        </tr>`).join('')||'<tr><td colspan="4">Noch keine Dokumente verknüpft.</td></tr>'}</tbody></table>
      </div>
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
    for(const k of ['provision_abgerechnet','provision_bezahlt']) d[k]=d[k]==='true';
    d.versicherung=d.versicherung===''?null:d.versicherung==='true';
    d.ausfuehrende_firma_id=d.ausfuehrende_firma_id||null;
    d.updated_at=new Date().toISOString();
    const {error}=await db.from('vermittlung_auftraege').update(d).eq('id',id);
    if(error){alert(error.message);return}
    m.remove();toast('Auftrag aktualisiert');navigate('orders');
  };

  m.querySelector('#docForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target), d=Object.fromEntries(fd.entries());
    d.auftrag_id=id; d.hochgeladen_von=currentUser.email;
    const {error}=await db.from('vermittlung_dokumente').insert(d);
    if(error){alert(error.message);return}
    m.remove();toast('Dokument verknüpft');showOrder(id);
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

