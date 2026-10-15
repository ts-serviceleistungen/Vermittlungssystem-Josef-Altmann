import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
const MAX_BYTES=50*1024*1024;
const ALLOWED=new Set(["application/pdf","image/jpeg","image/png","image/webp","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const SAFE_EXT=/\.(pdf|jpe?g|png|webp|doc|docx|xls|xlsx)$/i;
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({ok:false,error:"Nur POST erlaubt."},405);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return json({ok:false,error:"Serverkonfiguration fehlt."},500);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return json({ok:false,error:"Anmeldung erforderlich."},401);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:authErr}=await admin.auth.getUser(token);
  if(authErr||!auth.user)return json({ok:false,error:"Sitzung ungültig."},401);
  const {data:user,error:userErr}=await admin.from("vermittlung_benutzer").select("id,email,rolle,aktiv,firma_id").eq("auth_user_id",auth.user.id).maybeSingle();
  if(userErr)throw userErr;
  if(!user||!user.aktiv||!["Administrator","Auftragserfassung","Externe Firma"].includes(user.rolle))return json({ok:false,error:"Keine Berechtigung."},403);
  const form=await req.formData(),orderId=String(form.get("order_id")||"").trim(),file=form.get("file");
  if(!orderId||!(file instanceof File))return json({ok:false,error:"Auftrag und Datei sind erforderlich."},400);
  if(file.size<=0||file.size>MAX_BYTES)return json({ok:false,error:"Datei muss größer als 0 und höchstens 50 MB sein."},400);
  if(!ALLOWED.has(file.type)||!SAFE_EXT.test(file.name))return json({ok:false,error:"Dateityp nicht erlaubt."},415);
  const {data:order,error:orderErr}=await admin.from("vermittlung_auftraege").select("id,ausfuehrende_firma_id").eq("id",orderId).maybeSingle();
  if(orderErr)throw orderErr;
  if(!order)return json({ok:false,error:"Auftrag nicht gefunden."},404);
  if(user.rolle==="Externe Firma"&&(!user.firma_id||order.ausfuehrende_firma_id!==user.firma_id))return json({ok:false,error:"Dieser Auftrag ist Ihrer Firma nicht zugeordnet."},403);
  const clean=file.name.replace(/[^\p{L}\p{N}._() -]/gu,"_").slice(0,180),path=`${orderId}/${crypto.randomUUID()}-${clean}`;
  const bytes=new Uint8Array(await file.arrayBuffer());
  const {error:storageErr}=await admin.storage.from("vermittlung-dokumente").upload(path,bytes,{contentType:file.type,upsert:false});
  if(storageErr)throw new Error("Datei konnte nicht gespeichert werden: "+storageErr.message);
  const {data:doc,error:insertErr}=await admin.from("vermittlung_auftragsdokumente").insert({auftrag_id:orderId,dateiname:file.name,speicherpfad:path,mime_type:file.type,dateigroesse:file.size,hochgeladen_von:user.email}).select("id,dateiname,mime_type,dateigroesse,erstellt_am").single();
  if(insertErr){await admin.storage.from("vermittlung-dokumente").remove([path]);throw new Error("Dokumentzuordnung fehlgeschlagen: "+insertErr.message);}
  return json({ok:true,document:doc});
 }catch(e){console.error("upload-order-document",e);return json({ok:false,error:e instanceof Error?e.message:"Interner Fehler."},500);}
});