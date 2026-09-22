const CONFIG = {
  SPREADSHEET_NAME: 'Vermittlungssystem Josef Altmann',
  DRIVE_ROOT: 'Aufträge',
  SHEETS: ['Übersicht','Wasserschäden','Reinigungsvermittlung','Gartenvermittlung','Immobilien','Sonstige','Provisionen','Monatsabrechnung','Jahresabrechnung','Kunden','Firmen - Subunternehmer','Dokumentation']
};

function doGet(e) {
  const p=e.parameter||{};
  if(p.action==='setup' && validToken(p.token)) return setupResponse();
  return HtmlService.createHtmlOutput('<h2>Vermittlungssystem Google-Connector</h2><p>Der Anschluss ist aktiv.</p>');
}

function doPost(e) {
  try {
    const data=JSON.parse(e.postData.contents||'{}');
    if(!validToken(data.token)) return json({ok:false,error:'Ungültiger Sicherheitsschlüssel.'});
    if(data.action==='syncAll') return json(syncAll(data));
    return json({ok:false,error:'Unbekannte Aktion.'});
  } catch(err) { return json({ok:false,error:String(err)}); }
}

function validToken(token){
  const saved=PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  return !!saved && token===saved;
}

function setupResponse(){
  const props=PropertiesService.getScriptProperties();
  let token=props.getProperty('SYNC_TOKEN');
  if(!token){ token=Utilities.getUuid().replace(/-/g,''); props.setProperty('SYNC_TOKEN',token); }
  const ss=getOrCreateSpreadsheet();
  const root=getOrCreateFolder(CONFIG.DRIVE_ROOT);
  return HtmlService.createHtmlOutput(`<h2>Google-Verbindung eingerichtet</h2><p><b>Google Sheets:</b> <a href="${ss.getUrl()}" target="_blank">${ss.getUrl()}</a></p><p><b>Google Drive:</b> <a href="${root.getUrl()}" target="_blank">${root.getUrl()}</a></p><p><b>Sicherheitsschlüssel:</b> ${token}</p><p>Diesen Schlüssel im Vermittlungssystem unter „Google Drive / Sheets“ eintragen.</p>`);
}

function getOrCreateSpreadsheet(){
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty('SPREADSHEET_ID');
  if(id) return SpreadsheetApp.openById(id);
  const ss=SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID',ss.getId());
  CONFIG.SHEETS.forEach((name,i)=>{
    let sh=i===0?ss.getSheets()[0]:ss.insertSheet();
    sh.setName(name);
  });
  return ss;
}

function getOrCreateFolder(name,parent){
  const folder=parent||DriveApp.getRootFolder();
  const it=folder.getFoldersByName(name);
  return it.hasNext()?it.next():folder.createFolder(name);
}

function orderFolder(order){
  const year=(order.erstellt_am||new Date().toISOString()).slice(0,4);
  const root=getOrCreateFolder(CONFIG.DRIVE_ROOT);
  const yf=getOrCreateFolder(year,root);
  const safe=(order.auftragsnummer||'Auftrag')+' '+((order.beschreibung||order.bereich||'').slice(0,70)).replace(/[\\/:*?"<>|]/g,'-').trim();
  const of=getOrCreateFolder(safe||'Auftrag',yf);
  ['Fotos','Kostenvoranschlag','Angebote','Rechnungen','Verträge','Sonstiges'].forEach(n=>getOrCreateFolder(n,of));
  return of;
}

function syncAll(data){
  const ss=getOrCreateSpreadsheet();
  writeTable(ss,'Wasserschäden',data.orders.filter(o=>o.bereich==='Wasserschaden / Sanierung'),waterHeaders(),waterRow);
  writeTable(ss,'Reinigungsvermittlung',data.orders.filter(o=>o.bereich==='Reinigungsvermittlung'),orderHeaders(),orderRow);
  writeTable(ss,'Gartenvermittlung',data.orders.filter(o=>o.bereich==='Gartenvermittlung'),orderHeaders(),orderRow);
  writeTable(ss,'Immobilien',data.orders.filter(o=>o.bereich==='Immobilien / Vermietung'),realHeaders(),realRow);
  writeTable(ss,'Sonstige',data.orders.filter(o=>o.bereich==='Sonstige Vermittlung'),orderHeaders(),orderRow);
  writeTable(ss,'Provisionen',data.orders,commissionHeaders(),commissionRow);
  writeTable(ss,'Kunden',data.customers,customerHeaders(),customerRow);
  writeTable(ss,'Firmen - Subunternehmer',data.companies,companyHeaders(),companyRow);
  writeOverview(ss,data.orders);
  writeReports(ss,data.orders);
  writeTable(ss,'Dokumentation',[],['Auftragsnummer','Datum','Aktivität','Notiz','Bearbeiter'],()=>[]);
  (data.orders||[]).forEach(orderFolder);
  PropertiesService.getScriptProperties().setProperty('LAST_SYNC',new Date().toISOString());
  return {ok:true,spreadsheetUrl:ss.getUrl(),lastSync:PropertiesService.getScriptProperties().getProperty('LAST_SYNC')};
}

function writeTable(ss,name,items,headers,rowFn){
  const sh=ss.getSheetByName(name)||ss.insertSheet(name);
  sh.clearContents(); sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  if(items.length) sh.getRange(2,1,items.length,headers.length).setValues(items.map(rowFn));
  sh.setFrozenRows(1); sh.autoResizeColumns(1,headers.length);
}
function writeOverview(ss,orders){
  const sh=ss.getSheetByName('Übersicht'); sh.clearContents();
  const active=orders.filter(o=>o.status!=='Storniert');
  const vol=active.reduce((s,o)=>s+Number(o.auftragswert_netto||0),0);
  const prov=active.reduce((s,o)=>s+Number(o.provision||0),0);
  const paid=active.filter(o=>o.provision_bezahlt).reduce((s,o)=>s+Number(o.provision||0),0);
  const rows=[['VERMITTLUNGSSYSTEM – ÜBERSICHT'],[],['Kennzahl','Wert'],['Aufträge',active.length],['Auftragsvolumen netto',vol],['Provision gesamt',prov],['Provision bezahlt',paid],['Provision offen',prov-paid]];
  sh.getRange(1,1,rows.length,2).setValues(rows); sh.getRange('A1:B1').merge(); sh.getRange('A1').setFontWeight('bold').setFontSize(16); sh.getRange('A3:B3').setFontWeight('bold'); sh.autoResizeColumns(1,2);
}
function writeReports(ss,orders){
  const active=orders.filter(o=>o.status!=='Storniert');
  const months={}; active.forEach(o=>{const d=new Date(o.erstellt_am||Date.now()); const k=Utilities.formatDate(d,Session.getScriptTimeZone(),'MM.yyyy'); months[k]??={n:0,v:0,p:0,paid:0}; months[k].n++;months[k].v+=Number(o.auftragswert_netto||0);months[k].p+=Number(o.provision||0);if(o.provision_bezahlt)months[k].paid+=Number(o.provision||0);});
  const sh=ss.getSheetByName('Monatsabrechnung'); sh.clearContents(); sh.getRange(1,1,1,6).setValues([['Monat','Aufträge','Auftragsvolumen netto','Provision entstanden','Provision bezahlt','Provision offen']]).setFontWeight('bold');
  const rows=Object.entries(months).sort().map(([k,v])=>[k,v.n,v.v,v.p,v.paid,v.p-v.paid]); if(rows.length) sh.getRange(2,1,rows.length,6).setValues(rows); sh.autoResizeColumns(1,6);
  const years={}; active.forEach(o=>{const y=new Date(o.erstellt_am||Date.now()).getFullYear(); years[y]??={n:0,v:0,p:0,paid:0}; years[y].n++;years[y].v+=Number(o.auftragswert_netto||0);years[y].p+=Number(o.provision||0);if(o.provision_bezahlt)years[y].paid+=Number(o.provision||0);});
  const sy=ss.getSheetByName('Jahresabrechnung'); sy.clearContents(); sy.getRange(1,1,1,6).setValues([['Jahr','Aufträge','Auftragsvolumen netto','Provision entstanden','Provision bezahlt','Provision offen']]).setFontWeight('bold'); const yr=Object.entries(years).sort().map(([k,v])=>[Number(k),v.n,v.v,v.p,v.paid,v.p-v.paid]); if(yr.length) sy.getRange(2,1,yr.length,6).setValues(yr); sy.autoResizeColumns(1,6);
}

function orderHeaders(){return ['Auftragsnummer','Erstellt am','Status','Priorität','Verantwortlich','Kunde','Objektadresse','Beschreibung','Ausführende Firma','Geplanter Beginn','Fertigstellung','Kostenvoranschlag netto','Auftragswert netto','Provision 10%','Provision abgerechnet','Provision bezahlt','Notizen'];}
function orderRow(o){return [o.auftragsnummer,o.erstellt_am,o.status,o.prioritaet,o.verantwortlich,o.kunde_id,o.objekt_adresse,o.beschreibung,o.ausfuehrende_firma_id,o.geplanter_beginn,o.fertigstellung,o.kostenvoranschlag_netto,o.auftragswert_netto,o.provision,o.provision_abgerechnet?'Ja':'Nein',o.provision_bezahlt?'Ja':'Nein',o.notizen];}
function waterHeaders(){return ['Auftragsnummer','Erstellt am','Status','Priorität','Verantwortlich','Kunde','Objektadresse','Objekttyp','Beschreibung','Ausführende Firma','Geplanter Beginn','Fertigstellung','Kostenvoranschlag netto','Auftragswert netto','Provision 10%','Provision abgerechnet','Provision bezahlt','Schadensart','Schadensort','Versicherung','Versicherungsnummer','Schadennummer','Versicherungsgesellschaft','Gutachter','Trocknungsfirma','Sanierungsfirma','Notizen'];}
function waterRow(o){return [o.auftragsnummer,o.erstellt_am,o.status,o.prioritaet,o.verantwortlich,o.kunde_id,o.objekt_adresse,o.objekt_typ,o.beschreibung,o.ausfuehrende_firma_id,o.geplanter_beginn,o.fertigstellung,o.kostenvoranschlag_netto,o.auftragswert_netto,o.provision,o.provision_abgerechnet?'Ja':'Nein',o.provision_bezahlt?'Ja':'Nein',o.schadensart,o.schadensort,o.versicherung==null?'':o.versicherung?'Ja':'Nein',o.versicherungsnummer,o.schadennummer,o.versicherungsgesellschaft,o.gutachter,o.trocknungsfirma,o.sanierungsfirma,o.notizen];}
function realHeaders(){return ['Auftragsnummer','Erstellt am','Status','Priorität','Verantwortlich','Kunde','Objektadresse','Objekttyp','Beschreibung','Ansprechpartner','Ausführende Firma','Geplanter Beginn','Fertigstellung','Kostenvoranschlag netto','Auftragswert netto','Provision 10%','Provision abgerechnet','Provision bezahlt','Notizen'];}
function realRow(o){return [o.auftragsnummer,o.erstellt_am,o.status,o.prioritaet,o.verantwortlich,o.kunde_id,o.objekt_adresse,o.objekt_typ,o.beschreibung,o.ansprechpartner,o.ausfuehrende_firma_id,o.geplanter_beginn,o.fertigstellung,o.kostenvoranschlag_netto,o.auftragswert_netto,o.provision,o.provision_abgerechnet?'Ja':'Nein',o.provision_bezahlt?'Ja':'Nein',o.notizen];}
function commissionHeaders(){return ['Auftragsnummer','Bereich','Kunde','Auftragswert netto','Provisionssatz','Provision','Entstanden am','Abgerechnet','Bezahlt','Rechnungsdatum','Zahlungsdatum','Status'];}
function commissionRow(o){return [o.auftragsnummer,o.bereich,o.kunde_id,o.auftragswert_netto,Number(o.provision_prozent||10)/100,o.provision,o.erstellt_am,o.provision_abgerechnet?'Ja':'Nein',o.provision_bezahlt?'Ja':'Nein',o.provisions_rechnungsdatum,o.provisions_zahlungsdatum,o.provision_bezahlt?'Bezahlt':o.provision_abgerechnet?'Abgerechnet':'Offen'];}
function customerHeaders(){return ['Kunden-ID','Erstellt am','Vorname','Nachname','Firma','Straße','PLZ','Ort','Telefon','E-Mail','Notizen'];}
function customerRow(c){return [c.id,c.erstellt_am,c.vorname,c.nachname,c.firma,c.strasse,c.plz,c.ort,c.telefon,c.email,c.notizen];}
function companyHeaders(){return ['Firmen-ID','Erstellt am','Firmenname','Ansprechpartner','Telefon','E-Mail','Straße','PLZ','Ort','Gewerk','Notizen'];}
function companyRow(c){return [c.id,c.erstellt_am,c.firmenname,c.ansprechpartner,c.telefon,c.email,c.strasse,c.plz,c.ort,c.gewerk,c.notizen];}
function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
