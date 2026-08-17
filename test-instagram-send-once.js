const raw=process.env.META_INSTAGRAM_ACCESS_TOKEN||'';
const igUserId='17841441308562806';
const recipientId='1644231633938346';
const hadBearer=/^\s*Bearer\s+/i.test(raw);
const hadQuotes=/^\s*["'].*["']\s*$/.test(raw);
let token=raw.trim().replace(/^Bearer\s+/i,'').trim();
if((token.startsWith('"')&&token.endsWith('"'))||(token.startsWith("'")&&token.endsWith("'"))) token=token.slice(1,-1).trim();
const internalWhitespace=/\s/.test(token);
console.log('[IG_TOKEN_TEST] token_shape '+JSON.stringify({present:!!raw,rawLength:raw.length,normalizedLength:token.length,hadBearer,hadQuotes,internalWhitespace,looksInstagram:/^IG/i.test(token),looksFacebook:/^EA/i.test(token)}));
if(!token){
  console.log('[IG_TOKEN_TEST] missing META_INSTAGRAM_ACCESS_TOKEN');
  process.exit(0);
}
try{
  const r=await fetch(`https://graph.instagram.com/v26.0/${igUserId}/messages`,{
    method:'POST',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({recipient:{id:recipientId},message:{text:'Prueba técnica Banana Twins ✅'}})
  });
  const text=await r.text();
  let data=null;
  try{data=JSON.parse(text);}catch{}
  console.log('[IG_TOKEN_TEST] result '+JSON.stringify({status:r.status,ok:r.ok,recipient_id:data?.recipient_id||null,message_id:data?.message_id||null,error:data?.error?{message:data.error.message,type:data.error.type,code:data.error.code,error_subcode:data.error.error_subcode}:null}));
}catch(e){
  console.log('[IG_TOKEN_TEST] failure '+JSON.stringify({message:String(e?.message||e)}));
}
