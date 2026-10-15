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
  const {data:user,error:userErr}=await admin.from("vermittlung_benutzer").select("id,email,rolle,aktiv,firma_id").eq("auth_user_id",auth.user.id).maybeSingle();
  if(userErr)throw userErr;
  if(!user||!user.aktiv||!["Administrator","Auftragserfassung","Externe Firma"].includes(user.rolle))return json({ok:false,error:"Keine Berechtigung."},403);
  const input=await req.json(),orderId=String(input.order_id||"").trim();
  if(!orderId)return json({ok:false,error:"Auftrag ist erforderlich."},400);
  const {data:order,error:orderErr}=await admin.from("vermittlung_auftraege").select("id,ausfuehrende_firma_id").eq("id",orderId).maybeSingle();
  if(orderErr)throw orderErr;
  if(!order)return json({ok:false,error:"Auftrag nicht gefunden."},404);
  if(user.rolle==="Externe Firma"&&(!user.firma_id||order.ausfuehrende_firma_id!==user.firma_id))return json({ok:false,error:"Dieser Auftrag ist Ihrer Firma nicht zugeordnet."},403);
  const {data:docs,error:docsErr}=await admin.from("vermittlung_auftragsdokumente").select("id,auftrag_id,dateiname,mime_type,dateigroesse,hochgeladen_von,erstellt_am,speicherpfad").eq("auftrag_id",orderId).order("erstellt_am",{ascending:false});
  if(docsErr)throw docsErr;
  const documents=[];
  for(const doc of docs||[]){
   const {data:signed,error:signErr}=await admin.storage.from("vermittlung-dokumente").createSignedUrl(doc.speicherpfad,120);
   documents.push({id:doc.id,auftrag_id:doc.auftrag_id,dateiname:doc.dateiname,mime_type:doc.mime_type,dateigroesse:doc.dateigroesse,hochgeladen_von:doc.hochgeladen_von,erstellt_am:doc.erstellt_am,download_url:signErr?null:signed?.signedUrl||null});
  }
  return json({ok:true,documents});
 }catch(e){console.error("get-order-documents",e);return json({ok:false,error:e instanceof Error?e.message:"Interner Fehler."},500);}
});