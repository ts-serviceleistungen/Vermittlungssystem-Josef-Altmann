import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
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
  const {data:user,error:userErr}=await admin.from("vermittlung_benutzer").select("id,rolle,aktiv,firma_id").eq("auth_user_id",auth.user.id).maybeSingle();
  if(userErr)throw userErr;
  if(!user||!user.aktiv||!["Administrator","Auftragserfassung","Externe Firma"].includes(user.rolle))return json({ok:false,error:"Keine Berechtigung."},403);
  const input=await req.json(),documentId=String(input.document_id||"").trim();
  if(!documentId)return json({ok:false,error:"Dokument ist erforderlich."},400);
  const {data:doc,error:docErr}=await admin.from("vermittlung_auftragsdokumente").select("id,auftrag_id,dateiname,speicherpfad").eq("id",documentId).maybeSingle();
  if(docErr)throw docErr;
  if(!doc)return json({ok:false,error:"Dokument nicht gefunden."},404);
  if(user.rolle==="Externe Firma"){
   const {data:order,error:orderErr}=await admin.from("vermittlung_auftraege").select("ausfuehrende_firma_id").eq("id",doc.auftrag_id).maybeSingle();
   if(orderErr)throw orderErr;
   if(!user.firma_id||!order||order.ausfuehrende_firma_id!==user.firma_id)return json({ok:false,error:"Dieses Dokument gehört nicht zu einem Auftrag Ihrer Firma."},403);
  }
  const {data:signed,error:signErr}=await admin.storage.from("vermittlung-dokumente").createSignedUrl(doc.speicherpfad,120);
  if(signErr||!signed?.signedUrl)throw new Error("Download-Link konnte nicht erstellt werden: "+(signErr?.message||"Unbekannter Fehler"));
  return json({ok:true,url:signed.signedUrl,filename:doc.dateiname});
 }catch(e){console.error("get-order-document-url",e);return json({ok:false,error:e instanceof Error?e.message:"Interner Fehler."},500);}
});