// Prevent browser-native navigation for app-managed forms even if a later
// initializer fails. Their existing submit handlers still perform the saves.
document.addEventListener("submit",event=>{
 const form=event.target;
 if(form instanceof HTMLFormElement&&["postForm","diaryEditForm","profileForm"].includes(form.id)){
  event.preventDefault();
 }
},true);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
// Register ticket opening before the rest of the app initializes. This keeps
// ticket taps working even if an unrelated later initializer fails.
document.addEventListener("click",event=>{
 const target=event.target;
 const card=target instanceof Element?target.closest("[data-open-ticket]"):null;
 if(!card)return;
 event.preventDefault();
 event.stopImmediatePropagation();
 try{openTravelTicket(card.dataset.openTicket);}
 catch(error){console.error("チケットを開けませんでした",error);const notice=document.querySelector("#toast");if(notice){notice.textContent="チケットを開けませんでした。ページを再読み込みしてください。";notice.classList.add("show");}}
},true);
document.addEventListener("click",event=>{const target=event.target;const trigger=target instanceof Element?target.closest("#editProfileHome, #editProfile"):null;if(!trigger)return;event.preventDefault();event.stopPropagation();try{openProfileEditor();}catch(error){console.error("プロフィール編集を開けません:",error);const notice=document.querySelector("#toast");if(notice){notice.textContent="プロフィール編集を開けませんでした。画面を再読み込みしてください。";notice.classList.add("show");}}},true);
document.addEventListener("keydown",event=>{
 if(event.key!=="Enter"&&event.key!==" ")return;
 const target=event.target;
 const card=target instanceof Element?target.closest("[data-open-ticket]"):null;
 if(!card)return;
 event.preventDefault();
 event.stopImmediatePropagation();
 try{openTravelTicket(card.dataset.openTicket);}
 catch(error){console.error("チケットを開けませんでした",error);const notice=document.querySelector("#toast");if(notice){notice.textContent="チケットを開けませんでした。ページを再読み込みしてください。";notice.classList.add("show");}}
},true);
const DB_NAME="tabiLogMedia", STORE="media";
function openMediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function mediaPut(key,blob){const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(blob,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function compressPhotoForCloud(file){
 if(!file||!file.type.startsWith("image/"))throw new Error("画像ファイルを選択してください");
 if(file.size<=1350000)return file;
 if(typeof createImageBitmap!=="function")throw new Error("このブラウザでは写真の圧縮に対応していません。1.35MB以下の写真を選んでください");
 const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});
 try{
  let scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  for(let pass=0;pass<5;pass++){
   const canvas=document.createElement("canvas");
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));
   canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext("2d",{alpha:false});
   if(!context)throw new Error("写真の圧縮に失敗しました");
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [0.84,0.76,0.68,0.60]){
    const output=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
    if(output&&output.size<=1350000)return new File([output],"tabi-photo.webp",{type:"image/webp",lastModified:Date.now()});
   }
   scale*=0.78;
  }
  throw new Error("写真を1.35MB以下に圧縮できませんでした。別の写真を選んでください");
 }finally{bitmap.close?.();}
}
async function mediaGet(key){const db=await openMediaDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function mediaDelete(key){if(!key)return;const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function renderAvatarImage(){const key=profile.avatarMediaKey;const targets=[$("#profileAvatar"),$("#travelerAvatar")].filter(Boolean);if(!key){targets.forEach(el=>{el.replaceChildren(document.createTextNode((profile.name||"旅").slice(0,1)));el.classList.remove("has-avatar-image");});return;}try{const blob=await mediaGet(key);if(!blob)throw new Error("画像が見つかりません");const url=URL.createObjectURL(blob);targets.forEach(el=>{const img=document.createElement("img");img.src=url;img.alt="プロフィール画像";el.replaceChildren(img);el.classList.add("has-avatar-image");});}catch(error){console.warn("プロフィール画像の読み込みに失敗:",error);profile.avatarMediaKey="";save();targets.forEach(el=>{el.replaceChildren(document.createTextNode((profile.name||"旅").slice(0,1)));el.classList.remove("has-avatar-image");});}}
async function loadPostMedia(post){
 if(!post?.mediaKey)return null;
 const local=await mediaGet(post.mediaKey).catch(()=>null);
 if(local)return local;
 if(!signedInUser||!sessionToken||!post.cloudMediaSynced)return null;
 try{
  const response=await fetch(API_BASE+"/api/media/"+encodeURIComponent(post.id),{headers:{authorization:"Bearer "+sessionToken}});
  if(!response.ok)return null;
  const blob=await response.blob();
  if(!blob.size)return null;
  await mediaPut(post.mediaKey,blob);
  return blob;
 }catch(error){console.warn("クラウド写真の取得に失敗:",error);return null;}
}
async function uploadPendingPostMedia(){
 let allUploaded=true;
 for(const post of posts.filter(item=>item.author===profile.name&&item.mediaKey&&!item.cloudMediaSynced)){
  let blob=await mediaGet(post.mediaKey).catch(()=>null);
  if(!blob){allUploaded=false;continue;}
  if(String(blob.type||post.mediaType||"").startsWith("video/")){
   if(post.cloudMediaKey){
    try{
     const response=await fetch(API_BASE+"/api/media/"+encodeURIComponent(post.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});
     const data=await response.json();
     if(!response.ok||!data.ok)throw new Error(data.error||"以前の写真コピーを削除できませんでした");
     post.cloudMediaKey="";post.cloudMediaSynced=false;
    }catch(error){allUploaded=false;console.warn("動画への差し替え後に古いクラウド写真を削除できませんでした:",post.id,error);}
   }
   continue;
  }
  try{
   const cloudBlob=blob.size>1350000?await compressPhotoForCloud(blob):blob;
   const response=await fetch(API_BASE+"/api/media/"+encodeURIComponent(post.id),{method:"PUT",headers:{authorization:"Bearer "+sessionToken,"content-type":cloudBlob.type||post.mediaType||"image/jpeg"},body:cloudBlob});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"写真をクラウドに保存できませんでした");
   post.cloudMediaKey=data.key;post.mediaType=data.mediaType||cloudBlob.type||post.mediaType;post.cloudMediaSynced=true;
  }catch(error){allUploaded=false;console.warn("写真のクラウド保存に失敗:",post.id,error);}
 }
 return allUploaded;
}
async function deleteDiaryEntry(p){if(signedInUser&&sessionToken){const res=await fetch(API_BASE+"/api/posts/"+encodeURIComponent(p.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"クラウド側の日記を削除できませんでした");}posts=posts.filter(x=>x.id!==p.id);await mediaDelete(p.mediaKey);save();}
const uid=()=>crypto.randomUUID();
const API_BASE=(window.TABI_LOG_API_BASE||"").replace(/\/$/,"");
const GOOGLE_CLIENT_ID=window.TABI_LOG_GOOGLE_CLIENT_ID||"";
const SESSION_KEY="tabiLogSession";
let sessionToken=sessionStorage.getItem(SESSION_KEY)||"", signedInUser=null, googleInitialized=false;
function renderAuth(){
 const host=$("#googleLogin"),status=$("#authStatus"),importHost=$("#importGoogleLogin");
 if(!host||!status)return;
 const pendingImport=Boolean(new URLSearchParams(location.search).get("import"));
 const notice=$("#importAuthNotice");
 if(notice)notice.hidden=!(pendingImport&&!signedInUser);
 host.innerHTML="";
 if(importHost)importHost.innerHTML="";
 if(signedInUser){
   status.innerHTML='<span class="auth-name">'+esc(signedInUser.name||"Googleユーザー")+'</span> <button type="button" class="auth-signout" id="googleSignOut">ログアウト</button>';
  $("#googleSignOut").onclick=logoutFromApp;
  return;
 }
 status.textContent="";
 if(window.google?.accounts?.id&&GOOGLE_CLIENT_ID){
  window.google.accounts.id.renderButton(host,{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"ja"});
  if(importHost)window.google.accounts.id.renderButton(importHost,{theme:"filled_blue",size:"large",shape:"pill",text:"signin_with",locale:"ja"});
 }else{
  host.innerHTML='<span class="auth-loading">Googleログインを読み込み中…</span>';
  if(importHost)importHost.innerHTML='<span class="auth-loading">Googleログインを読み込み中…</span>';
 }
}
async function restoreSession(){
 if(!sessionToken){renderAuth();return;}
 let data;
 try{
  const res=await fetch(API_BASE+"/api/me",{headers:{authorization:"Bearer "+sessionToken}});
  data=await res.json();
  if(!res.ok||!data.ok){
   // Only a confirmed invalid/expired session should sign the user out.
   // Temporary API errors must never erase a valid local session.
   if(res.status===401||res.status===403){
    sessionToken="";
    sessionStorage.removeItem(SESSION_KEY);
    signedInUser=null;
    activeAccountStorageId=null;
   }else{
    console.warn("ログイン状態の確認に失敗しました。セッションは保持します。",data.error||res.status);
    toast("ログイン状態を確認できません。通信回復後に再試行します。");
   }
   renderAuth();
   return;
  }
 }catch(error){
  console.warn("ログイン状態の確認中に通信エラーが発生しました。セッションは保持します。",error);
  renderAuth();
  toast("通信エラーのためログイン状態を確認できません。ログイン情報は保持しています。");
  return;
 }
 signedInUser=data.user;
 const hadAccountProfile=Boolean(localStorage.getItem(accountStorageKey(signedInUser.id,"profile"))||(localStorage.getItem("tabilog_legacy_account_migrated")!=="1"&&localStorage.getItem("tabilog_profile")!==null));
 activateAccountStorage(signedInUser);
 await syncProfileWithServer(signedInUser,hadAccountProfile);
 // Re-render immediately after switching from guest data to this account's data.
 // Otherwise stale guest ticket cards can remain visible while trips points at the account array.
 renderAll();
 renderAuth();
 try{
  const synced=await syncCloudData();
  if(!synced)console.warn("セッション復元後のクラウド同期は未完了です。ログイン状態は維持します。");
  await processPendingImport();
 }catch(error){
  console.warn("セッション復元後の同期処理に失敗しました。ログイン状態は維持します。",error);
 }
}
async function handleGoogleCredential(response){
 if(!response?.credential){toast("Googleログイン情報を取得できませんでした");return;}
 try{
  const res=await fetch(API_BASE+"/api/auth/session",{method:"POST",headers:{authorization:"Bearer "+response.credential}});
  const data=await res.json();
  if(!res.ok||!data.ok||!data.sessionToken)throw new Error(data.error||"ログインを確認できませんでした");
  sessionToken=data.sessionToken;
  sessionStorage.setItem(SESSION_KEY,sessionToken);
  signedInUser=data.user;
  const hadAccountProfile=Boolean(localStorage.getItem(accountStorageKey(signedInUser.id,"profile"))||(localStorage.getItem("tabilog_legacy_account_migrated")!=="1"&&localStorage.getItem("tabilog_profile")!==null));
  activateAccountStorage(signedInUser);
  await syncProfileWithServer(signedInUser,hadAccountProfile);
  // Refresh the visible ticket list as soon as account-scoped data is activated.
  renderAll();
  renderAuth();
  await syncCloudData();
  await processPendingImport();
  toast("Googleログインしました");
 }catch(error){
  toast(error.message||"ログインに失敗しました");
 }
}
async function logoutFromApp(){
 const token=sessionToken;
 try{
  if(token)await fetch(API_BASE+"/api/auth/logout",{method:"POST",headers:{authorization:"Bearer "+token}});
 }catch{}
 sessionToken="";
 signedInUser=null;
 activeAccountStorageId=null;
 posts=[];trips=[];expenses=[];saved=[];following=[];blocked=[];
 profile={name:"旅好きユーザー",bio:"旅の記録を、少しずつ。"};shareRecords={};selectedTrip=null;
 sessionStorage.removeItem(SESSION_KEY);
 if(window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
 renderAuth();
 toast("ログアウトしました");
}
function initGoogleSignIn(){
 if(googleInitialized)return;
 if(!GOOGLE_CLIENT_ID){$("#googleLogin").textContent="ログイン設定を確認中";return;}
 if(!window.google?.accounts?.id)return;
 googleInitialized=true;
 window.google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:handleGoogleCredential,auto_select:false});
 renderAuth();
}
restoreSession();
const googleScript=$("#googleIdentityScript");
if(googleScript)googleScript.addEventListener("load",initGoogleSignIn,{once:true});
window.addEventListener("load",initGoogleSignIn,{once:true});

let shareRecords={};
const seedPosts=[];
const seedTrips=[];
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem("tabilog_"+k))??d}catch{return d}};
shareRecords=read("shares",{});
let posts=read("posts",seedPosts),trips=read("trips",seedTrips),expenses=read("expenses",[]),saved=read("saved",[]),following=read("following",[]),blocked=read("blocked",[]),profile=read("profile",{name:"旅好きユーザー",bio:"旅の記録を、少しずつ。"}),selectedTrip=trips[0]?.id||null,category="すべて",feedSort="recommend",mediaUrls={};
let cloudSyncTimer=null,cloudSyncBusy=false,cloudSyncHydrating=false,cloudSyncQueued=false,activeItineraryTripId=null,activeTicketId=null;
let activeAccountStorageId=null;
const LOCAL_STATE_DEFAULTS={posts:seedPosts,trips:seedTrips,expenses:[],saved:[],following:[],blocked:[],profile:{name:"旅好きユーザー",bio:"旅の記録を、少しずつ。"},shares:{}};
function accountStorageKey(userId,key){return "tabilog_account_"+encodeURIComponent(String(userId))+"_"+key;}
function currentLocalState(){return {posts,trips,expenses,saved,following,blocked,profile,shares:shareRecords};}
function writeLocalState(state,userId=activeAccountStorageId){
 for(const [key,value] of Object.entries(state)){
  const storageKey=userId?accountStorageKey(userId,key):"tabilog_"+key;
  localStorage.setItem(storageKey,JSON.stringify(value));
 }
}
function activateAccountStorage(user){
 if(!user?.id)return;
 const userId=String(user.id);
 if(activeAccountStorageId===userId)return;
 const keys=Object.keys(LOCAL_STATE_DEFAULTS);
 const hasAccountState=keys.some(key=>localStorage.getItem(accountStorageKey(userId,key))!==null);
 const legacyAlreadyMigrated=localStorage.getItem("tabilog_legacy_account_migrated")==="1";
 if(!hasAccountState&&!legacyAlreadyMigrated){
  // Migrate the existing guest/device data to the first account only.
  writeLocalState(currentLocalState(),userId);
  localStorage.setItem("tabilog_legacy_account_migrated","1");
 }else{
  const loaded={};
  for(const key of keys){
   try{
    const raw=localStorage.getItem(accountStorageKey(userId,key));
    loaded[key]=raw===null?JSON.parse(JSON.stringify(LOCAL_STATE_DEFAULTS[key])):JSON.parse(raw);
   }catch{loaded[key]=JSON.parse(JSON.stringify(LOCAL_STATE_DEFAULTS[key]));}
  }
  posts=loaded.posts;trips=loaded.trips;expenses=loaded.expenses;saved=loaded.saved;
  following=loaded.following;blocked=loaded.blocked;profile=loaded.profile;shareRecords=loaded.shares;
  selectedTrip=trips[0]?.id||null;
 }
 activeAccountStorageId=userId;
}
function expenseSyncMetaKey(userId=signedInUser?.id){return userId?accountStorageKey(userId,"expense_sync_meta"):"tabilog_expense_sync_meta";}
function readExpenseSyncMeta(remoteExpenses){
 const key=expenseSyncMetaKey();
 let stored=null;
 try{const raw=localStorage.getItem(key);stored=raw?JSON.parse(raw):null;}catch{}
 return TabiLogExpenseSync.normalizeMeta(stored,remoteExpenses,expenses);
}
function writeExpenseSyncMeta(meta){localStorage.setItem(expenseSyncMetaKey(),JSON.stringify(meta));}
function markExpenseSyncDirty(id){
 if(!signedInUser)return;
 const meta=readExpenseSyncMeta([]);
 writeExpenseSyncMeta(TabiLogExpenseSync.markDirty(meta,id));
}
function markExpenseSyncDeleted(id){
 if(!signedInUser)return;
 const meta=readExpenseSyncMeta([]);
 writeExpenseSyncMeta(TabiLogExpenseSync.markDeleted(meta,id));
}
function save(){
 writeLocalState(currentLocalState());
 if(signedInUser&&!cloudSyncHydrating){
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>syncCloudData(),1200);
 }
}
// Keep account profile data durable across browser reloads and Google sign-ins.
async function syncProfileWithServer(user,preferLocal=true){
 if(!user?.id||!sessionToken||!API_BASE)return;
 try{
  if(preferLocal){
   const response=await fetch(API_BASE+"/api/profile",{method:"PUT",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({name:profile.name||user.name||"旅好きユーザー",bio:profile.bio||""})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"プロフィール同期に失敗しました");
   profile={...profile,name:data.profile.name,bio:data.profile.bio};
   signedInUser={...user,name:data.profile.name,bio:data.profile.bio};
  }else{
   profile={...profile,name:user.name||profile.name,bio:typeof user.bio==="string"?user.bio:profile.bio};
   signedInUser=user;
  }
  writeLocalState(currentLocalState());
 }catch(error){console.warn("プロフィール同期に失敗:",error);}
}
async function syncCloudData(){
 if(!signedInUser||!sessionToken||!API_BASE)return;
 if(cloudSyncBusy){cloudSyncQueued=true;return;}
 cloudSyncBusy=true;
 try{
  const response=await fetch(API_BASE+"/api/sync",{headers:{authorization:"Bearer "+sessionToken}});
  const remote=await response.json();
  if(!response.ok||!remote.ok)throw new Error(remote.error||"クラウドの旅行記録を取得できませんでした");
  cloudSyncHydrating=true;
  const remoteTrips=(remote.trips||[]).map(t=>({
   id:t.id,title:t.title,area:t.area,date:t.start_date||"",endDate:t.end_date||"",tripType:t.trip_type||"standard",relatedWork:t.related_work||"",archived:Boolean(t.archived),originCountry:t.origin_country||"",arrivalAirport:t.arrival_airport||"",firstAttraction:t.first_attraction||"",
   description:t.description||"",visibility:t.visibility||"private",budgetAmount:Number(t.budget_amount||0),budgetCurrency:t.budget_currency||"JPY",
   stops:Array.isArray(t.stops)?t.stops:[],actual:Array.isArray(t.actual)?t.actual:[],
   dayPlans:Array.isArray(t.dayPlans)?t.dayPlans.map(day=>({date:day.date,items:(day.items||[]).map((item,index)=>({id:item.id||uid(),name:item.name,startTime:item.startTime||"",endTime:item.endTime||"",note:item.note||"",sortOrder:Number.isInteger(item.sortOrder)?item.sortOrder:index,visited:Boolean(item.visited)}))})):[],
   isMine:true,owner:"me",source:t.source||"native",stopLocations:Array.isArray(t.stopLocations)?t.stopLocations:[]
  }));
  const remoteExpenses=(remote.expenses||[]).map(item=>({id:item.id,tripId:item.trip_id,date:item.expense_date,category:item.category,amount:Number(item.amount),currency:item.currency||"JPY",note:item.note||""}));
  const remotePosts=(remote.posts||[]).map(p=>({
   id:p.id,tripId:p.trip_id||"",title:p.title,story:p.story,place:p.place_name,
   author:profile.name,date:p.captured_at||p.created_at||new Date().toISOString(),
   category:"旅",visual:"v4",symbol:"📍",likes:0,liked:false,saved:false,
   visibility:p.visibility||"private",mediaKey:(typeof p.media_key==="string"&&p.media_key.startsWith("users/"+signedInUser.id+"/posts/"))?p.id:null,cloudMediaKey:(typeof p.media_key==="string"&&p.media_key.startsWith("users/"+signedInUser.id+"/posts/"))?p.media_key:null,driveFileId:p.media_key&&!p.media_key.startsWith("users/")?p.media_key:null,mediaType:p.media_type||"",cloudMediaSynced:Boolean(typeof p.media_key==="string"&&p.media_key.startsWith("users/"+signedInUser.id+"/posts/")),comments:[]
  }));
  const tripIds=new Set(trips.map(t=>t.id));
  for(const t of remoteTrips){
   const local=trips.find(item=>item.id===t.id);
   if(!local){trips.push(t);continue;}
   local.tripType=t.tripType||local.tripType||"standard";local.relatedWork=t.relatedWork||local.relatedWork||"";
   const validLocation=point=>Boolean(point?.name&&point.latitude!==null&&point.latitude!==undefined&&point.latitude!==""&&point.longitude!==null&&point.longitude!==undefined&&point.longitude!==""&&Number.isFinite(Number(point.latitude))&&Number(point.latitude)>=-90&&Number(point.latitude)<=90&&Number.isFinite(Number(point.longitude))&&Number(point.longitude)>=-180&&Number(point.longitude)<=180);
   const mergedLocations=new Map();
   for(const point of (Array.isArray(t.stopLocations)?t.stopLocations:[]))if(validLocation(point))mergedLocations.set(String(point.name).trim(),point);
   for(const point of (Array.isArray(local.stopLocations)?local.stopLocations:[]))if(validLocation(point)&&!mergedLocations.has(String(point.name).trim()))mergedLocations.set(String(point.name).trim(),point);
   if(mergedLocations.size)local.stopLocations=[...mergedLocations.values()];
   if((!Array.isArray(local.stops)||!local.stops.length)&&t.stops?.length)local.stops=t.stops;
   if((!Array.isArray(local.actual)||!local.actual.length)&&t.actual?.length)local.actual=t.actual;
   if((!Array.isArray(local.dayPlans)||!local.dayPlans.length)&&t.dayPlans?.length)local.dayPlans=t.dayPlans;
  }
  const postIds=new Set(posts.map(p=>p.id));
  for(const p of remotePosts){
    const local=posts.find(item=>item.id===p.id);
    if(!local)posts.push(p);
    else if(p.cloudMediaSynced&&local.cloudMediaSynced!==false){local.mediaKey=local.mediaKey||p.id;local.cloudMediaKey=p.cloudMediaKey;local.mediaType=p.mediaType;local.cloudMediaSynced=true;}
    else if(p.mediaType&&!local.mediaType)local.mediaType=p.mediaType;
   }
  // Signed-in cloud data is authoritative for expenses so deletions on another device do not reappear.
  const expenseSyncMeta=readExpenseSyncMeta(remoteExpenses);
  const mergedExpenses=TabiLogExpenseSync.merge(remoteExpenses,expenses,expenseSyncMeta);
  expenses.splice(0,expenses.length,...mergedExpenses);
  if(!selectedTrip&&trips.length)selectedTrip=trips[0].id;
  writeLocalState(currentLocalState());
  cloudSyncHydrating=false;
  const payload={
   trips:trips.filter(t=>t.source==="native").slice(0,100).map(t=>({
    id:t.id,title:t.title,area:t.area,description:t.description||"",trip_type:t.tripType||"standard",related_work:t.relatedWork||"",
    visibility:t.visibility||"private",start_date:t.date||"",end_date:t.endDate||"",
    budget_amount:Number(t.budgetAmount||0),budget_currency:t.budgetCurrency||"JPY",archived:Boolean(t.archived),
    stops:Array.isArray(t.stops)?t.stops:[],actual:Array.isArray(t.actual)?t.actual:[],
    stopLocations:Array.isArray(t.stopLocations)?t.stopLocations:[],
    dayPlans:Array.isArray(t.dayPlans)?t.dayPlans.map(day=>({
     date:day.date,
     items:(day.items||[]).map((item,index)=>({
      id:item.id,name:item.name,startTime:item.startTime||"",endTime:item.endTime||"",
      note:item.note||"",sortOrder:Number.isInteger(item.sortOrder)?item.sortOrder:index,
      visited:Boolean(item.visited)
     }))
    })): []
   })),
   expenses:expenses.filter(item=>trips.some(t=>t.id===item.tripId&&t.source==="native")).slice(0,1000).map(item=>({id:item.id,trip_id:item.tripId,expense_date:item.date,category:item.category,amount:item.amount,currency:item.currency||"JPY",note:item.note||""})),
   posts:posts.filter(p=>p.author===profile.name).slice(0,100).map(p=>({
    id:p.id,trip_id:p.tripId||null,title:p.title,story:p.story,place_name:p.place,
    visibility:p.visibility||"private",captured_at:p.date||""
   }))
  };
  const savedResponse=await fetch(API_BASE+"/api/sync",{
   method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},
   body:JSON.stringify(payload)
  });
  const savedData=await savedResponse.json();
  if(!savedResponse.ok||!savedData.ok)throw new Error(savedData.error||"クラウドへの保存に失敗しました");
  const mediaUploaded=await uploadPendingPostMedia();
  localStorage.setItem(firstCloudSyncKey,"1");
  writeExpenseSyncMeta(TabiLogExpenseSync.afterSuccess(expenseSyncMeta,payload.expenses.map(item=>item.id)));
  writeLocalState(currentLocalState());
  renderAll();
  return mediaUploaded;
 }catch(error){
  console.warn("旅ログのクラウド同期に失敗:",error);
  return false;
 }finally{
  cloudSyncHydrating=false;
  cloudSyncBusy=false;
  if(cloudSyncQueued){cloudSyncQueued=false;clearTimeout(cloudSyncTimer);cloudSyncTimer=setTimeout(()=>syncCloudData(),800);}
 }
}
function toast(s){let t=$("#toast");t.textContent=s;t.classList.add("show");clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove("show"),2300)}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(s){if(!s)return "日付未設定";return new Date(s).toLocaleDateString("ja-JP",{year:"numeric",month:"short",day:"numeric"});}
function visiblePosts(){return posts.filter(p=>(!blocked.includes(p.author)&&p.visibility==="public")||p.author===profile.name);}
function renderFeed(){let list=visiblePosts();let q=$("#feedSearch").value.trim().toLowerCase();if(q)list=list.filter(p=>(p.title+p.place+p.story).toLowerCase().includes(q));if(category!=="すべて")list=list.filter(p=>p.category===category);if(feedSort==="new")list.sort((a,b)=>String(b.date).localeCompare(String(a.date)));if(feedSort==="popular")list.sort((a,b)=>(b.likes||0)-(a.likes||0));
$("#feed").innerHTML=list.length?list.map(p=>`<article class="post-card"><div class="post-visual ${p.visual||"v1"}" id="visual-${p.id}"><span class="symbol">${p.symbol||"📍"}</span><span class="visual-bottom">${esc(p.place)}</span></div><div class="post-body"><div class="post-meta"><span class="mini-avatar">${esc((p.author||"旅").slice(0,1))}</span><span>${esc(p.author)} · ${esc(p.date||"今日")}</span><span>· ${esc(p.category||"旅")}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.story)}</p><span class="post-place">📍 ${esc(p.place)}</span><div class="post-actions"><button class="action ${p.liked?"active":""}" data-like="${p.id}">♥ ${p.likes||0}</button><button class="action" data-comment="${p.id}">コメント ${p.comments?.length||0}</button><button class="action" data-save="${p.id}">${p.saved?"保存済み":"保存"}</button><button class="action" data-remix="${p.id}">旅程にコピー</button><button class="action" data-follow="${esc(p.author)}">${following.includes(p.author)?"フォロー中":"フォロー"}</button><button class="action" data-block="${esc(p.author)}">非表示</button><button class="action" data-report="${p.id}">通報</button></div></div></article>`).join(""):`<div class="empty-state">該当する旅の記録はありません。</div>`;
list.forEach(async p=>{if(p.mediaKey||p.driveFileId){try{let blob=await loadPostMedia(p);if(blob){let url=URL.createObjectURL(blob);mediaUrls[p.id]=url;let el=$("#visual-"+p.id);if(el){el.querySelector(".symbol")?.remove();let m=document.createElement("img");m.src=url;el.prepend(m);}}}catch{}}});
}

function closeTicketExperience(){
 const layer=document.getElementById("ticketExperience");
 if(!layer)return;
 if(activeTicketId===layer._ticketTrip?.id)activeTicketId=null;
 layer._ticketMap?.remove();
 (layer._ticketObjectUrls||[]).forEach(url=>URL.revokeObjectURL(url));
 layer.classList.remove("is-open","is-torn");document.body.classList.remove("ticket-open");
 setTimeout(()=>layer.remove(),420);
}
function openMapMemoryComposer(trip,place,map){
 activeTicketId=trip.id;
 selectedTrip=trip.id;refreshTripSelect();
 const form=$("#postForm");form.reset();refreshTripSelect();
 form.elements.tripId.value=trip.id;refreshPostPlaces(trip.id);
 form.elements.place.value=place.name;form.elements.title.value=place.name+"の記録";
 form.elements.story.value="";map?.closePopup();openDialog("#postDialog");
}
function openDiaryEditor(post){
 const form=$("#diaryEditForm");
 form.elements.id.value=post.id;form.elements.title.value=post.title||"";
 form.elements.place.value=post.place||"";form.elements.capturedAt.value=String(post.date||"").slice(0,16);
 form.elements.story.value=post.story||"";form.elements.visibility.value=post.visibility||"private";
 form.elements.mediaReplace.value="";openDialog("#diaryEditDialog");
}
function makeMapEditButton(post){
 const button=document.createElement("button");button.type="button";
 button.className="map-pin-edit-memory";button.textContent="日記・写真を編集";
 button.addEventListener("click",()=>openDiaryEditor(post));return button;
}
function renderTicketMap(trip,layer){
 const host=layer.querySelector("#ticketRouteMap");
 if(!host)return;
 if(!window.L){host.innerHTML='<div class="ticket-map-empty">地図を読み込めませんでした。ネットワークを確認してください。</div>';return;}
 const locations=Array.isArray(trip.stopLocations)?trip.stopLocations:[];
 const valid=locations.filter(p=>{
  const lat=Number(p?.latitude),lon=Number(p?.longitude);
  return p?.name&&p?.latitude!==null&&p?.latitude!==undefined&&p?.latitude!==""&&p?.longitude!==null&&p?.longitude!==undefined&&p?.longitude!==""&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
 });
 if(!valid.length){host.innerHTML='<div class="ticket-map-empty">この旅行には地図座標が登録されていません。訪問先の座標がある旅行では、ここにルート地図が表示されます。</div>';return;}
 host.replaceChildren();
 const map=L.map(host,{scrollWheelZoom:false,zoomControl:true}).setView([Number(valid[0].latitude),Number(valid[0].longitude)],11);
 layer._ticketMap=map;
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 const bounds=[];layer._ticketMapMarkers=new Map();
 valid.forEach((place,index)=>{
  const point=[Number(place.latitude),Number(place.longitude)];bounds.push(point);
  const visited=(trip.actual||[]).includes(place.name);
  const icon=L.divIcon({className:"tabi-map-marker-wrap",html:'<span class="tabi-map-marker '+(visited?"visited":"planned")+'">'+(index+1)+'</span>',iconSize:[32,38],iconAnchor:[16,34]});
  const marker=L.marker(point,{icon}).addTo(map);layer._ticketMapMarkers.set(place.name,marker);
  const popup=document.createElement("div");popup.className="tabi-map-popup";
  const heading=document.createElement("strong");heading.textContent=place.name;popup.append(heading);
  const state=document.createElement("div");state.className="map-pin-state";state.textContent=visited?"訪問済み":"旅行予定";popup.append(state);
   const related=posts.filter(post=>post.tripId===trip.id&&String(post.place||"").trim()===place.name&&post.author===profile.name);
   const addMemory=document.createElement("button");addMemory.type="button";addMemory.className="map-pin-add-photo";addMemory.textContent="＋ この場所に日記・写真を追加";
   addMemory.addEventListener("click",()=>openMapMemoryComposer(trip,place,map));popup.append(addMemory);
   const diaryBox=document.createElement("div");diaryBox.className="ticket-map-popup-diaries";popup.append(diaryBox);
   const photos=document.createElement("div");photos.className="ticket-map-popup-photos";popup.append(photos);
   marker.bindPopup(popup);
   marker.on("popupopen",async()=>{
    diaryBox.replaceChildren();photos.replaceChildren();
    if(!related.length){const empty=document.createElement("small");empty.textContent="この場所の日記・写真はまだありません";diaryBox.append(empty);}
    for(const post of related){
     const row=document.createElement("div");row.className="map-pin-memory-row";
     const title=document.createElement("b");title.textContent=post.title||"旅の記録";row.append(title);
     if(post.story){const story=document.createElement("p");story.textContent=post.story;row.append(story);}
     row.append(makeMapEditButton(post));diaryBox.append(row);
     if(post.mediaKey||post.mediaType){
      try{
       const blob=await loadPostMedia(post);if(!blob)continue;
       const media=document.createElement(blob.type.startsWith("video/")?"video":"img");
       media.src=URL.createObjectURL(blob);layer._ticketObjectUrls=[...(layer._ticketObjectUrls||[]),media.src];
       media.alt=post.title||place.name;
       if(media.tagName==="VIDEO"){media.controls=true;media.muted=true;media.playsInline=true;}
       photos.append(media);
      }catch(error){console.warn("地図の写真を読み込めませんでした",error);}
     }
    }
   });
 });
 if(bounds.length>1)L.polyline(bounds,{color:"#b18b52",weight:4,opacity:.82,dashArray:"7 7"}).addTo(map);
 if(bounds.length===1)map.setView(bounds[0],13);else map.fitBounds(bounds,{padding:[28,28],maxZoom:13});
 setTimeout(()=>map.invalidateSize({pan:false}),120);
 setTimeout(()=>map.invalidateSize({pan:false}),500);
}
function finishTicketTear(layer){
 if(layer.dataset.opening==="1")return;
 layer.dataset.opening="1";layer.classList.add("is-torn");
 const ticket=layer.querySelector(".boarding-ticket");
 const detail=layer.querySelector(".ticket-detail");
 const help=layer.querySelector(".ticket-tear-help");
 if(help)help.textContent="YOUR JOURNEY ARCHIVE";
 if(ticket)ticket.setAttribute("aria-hidden","true");
 const track=layer.querySelector(".tear-track");
 if(track)track.setAttribute("aria-hidden","true");
 window.setTimeout(()=>{
  ticket?.remove();
  if(detail){
   detail.hidden=false;detail.classList.add("is-visible");
   detail.scrollIntoView({behavior:"smooth",block:"start"});
   if(layer._ticketTrip)renderTicketMap(layer._ticketTrip,layer);
  }
 },920);
}
function restoreTicketAfterSave(tripId){
 openTravelTicket(tripId);
 const layer=document.getElementById("ticketExperience");
 if(layer)window.setTimeout(()=>{if(document.getElementById("ticketExperience")===layer&&layer.isConnected)finishTicketTear(layer);},80);
}
function openTravelTicket(tripId){
 const trip=trips.find(item=>String(item.id)===String(tripId));
 if(!trip){toast("この旅行を読み込めませんでした。旅行一覧を更新してください。");console.warn("チケットに対応する旅行が見つかりません:",tripId);return;}
 activeTicketId=trip.id;
 selectedTrip=trip.id;document.body.classList.add("has-opened-ticket");try{renderMap();}catch(error){console.warn("チケット表示中の地図更新をスキップしました",error);}
 const previous=document.getElementById("ticketExperience");
 previous?._ticketMap?.remove();
 (previous?._ticketObjectUrls||[]).forEach(url=>URL.revokeObjectURL(url));
 previous?.remove();
 const places=[...new Set([...(Array.isArray(trip.stopLocations)?trip.stopLocations:[]).map(p=>p.name),...(Array.isArray(trip.stops)?trip.stops:[])].filter(Boolean))];
 const visited=Array.isArray(trip.actual)?trip.actual:[];
 const days=[...(trip.dayPlans||[])].sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
 const entries=posts.filter(p=>p.tripId===trip.id&&p.author===profile.name).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
 const spent=expenses.filter(item=>item.tripId===trip.id).reduce((sum,item)=>sum+Number(item.amount||0),0);
 const dateText=(trip.date?fmt(trip.date):"日付未設定")+(trip.endDate?" — "+fmt(trip.endDate):"");
 const firstMemory=entries[0];const firstDay=days[0];
 const previewHtml='<div class="ticket-reveal-preview" aria-hidden="true"><div class="ticket-reveal-inner"><div class="reveal-kicker">THE JOURNEY BEHIND THE TICKET</div><strong>'+esc(trip.title||"旅の記録")+'</strong><p>'+esc(firstMemory?.story||trip.description||"訪れた場所、旅程、写真や日記。あなたの旅の記録がここに保管されています。")+'</p><div class="reveal-stats"><span><b>'+places.length+'</b> PLACES</span><span><b>'+visited.length+'</b> VISITED</span><span>'+esc(firstDay?.date||dateText)+'</span></div><div class="reveal-stamp">TRAVEL<br>ARCHIVE</div></div></div>';
 const layer=document.createElement("div");layer.id="ticketExperience";layer.className="ticket-experience";layer._ticketTrip=trip;
 const h='<button class="ticket-close" type="button" aria-label="閉じる">×</button><div class="ticket-stage">'+previewHtml+'<div class="boarding-ticket"><div class="ticket-main-half"><div class="ticket-topline"><span class="ticket-brand">TABI LOG <b>TRAVEL</b></span><span class="ticket-doc-type">JOURNEY / ARCHIVE COPY</span></div><div class="ticket-route"><div><small>'+(trip.originCountry?"FROM COUNTRY":"DESTINATION")+'</small><strong>'+esc(trip.originCountry||trip.area||"旅の目的地")+'</strong></div><span class="ticket-route-line"><i></i><b>✈</b><i></i></span><div class="ticket-flight"><small>'+(trip.arrivalAirport?"ARRIVAL AIRPORT":"TRIP NO.")+'</small><strong>'+esc(trip.arrivalAirport||String(trip.id||"").slice(-6).toUpperCase())+'</strong></div></div>'+(trip.arrivalAirport?'<div class="ticket-route-subline"><span>'+esc(trip.arrivalAirport)+'</span><i>→</i><strong>'+esc(trip.firstAttraction||places[0]||"観光地未設定")+'</strong></div>':'')+'<h2>'+esc(trip.title||"旅の記録")+'</h2><div class="ticket-fields"><div><small>DATE</small><b>'+esc(dateText)+'</b></div><div><small>STOPS</small><b>'+places.length+' PLACES</b></div><div><small>VISITED</small><b>'+visited.length+' / '+places.length+'</b></div></div></div><div class="ticket-perforation"><span class="perforation-label">TEAR HERE</span><div class="tear-track" role="presentation"><div class="tear-progress"></div><span class="tear-grip">✂</span></div></div><div class="ticket-stub-half"><small>TRAVEL PASS</small><div class="ticket-stub-code">TL · ARCHIVE</div><div class="ticket-barcode" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><strong>'+esc((trip.title||"MY JOURNEY").slice(0,32))+'</strong><span>'+esc(trip.date?fmt(trip.date):"YOUR MEMORY")+'</span><b>KEEP THIS MEMORY</b></div></div><p class="ticket-tear-help">中央のミシン目を上から下へなぞってチケットを切り離してください</p><section class="ticket-detail" hidden><div class="ticket-detail-heading"><span>YOUR JOURNEY ARCHIVE</span><h2>'+esc(trip.title||"旅の記録")+'</h2><p>'+esc(trip.area||"")+' · '+esc(dateText)+'</p></div><div class="ticket-detail-grid"><article><small>TRAVEL NOTES</small><p>'+esc(trip.description||"この旅に登録されたメモはありません。")+'</p></article><article><small>VISIT RECORD</small><p>'+visited.length+' / '+places.length+' か所を訪問</p><div class="ticket-place-list">'+(places.length?places.map(name=>'<span class="ticket-place-chip '+(visited.includes(name)?"visited":"")+'">'+(visited.includes(name)?"✓ ":"")+esc(name)+'</span>').join(""):"訪問先はまだ登録されていません。")+'</div></article><article><small>ITINERARY</small>'+(days.length?days.map(day=>'<div class="ticket-day"><b>'+esc(day.date||"日付未設定")+'</b>'+(day.items||[]).map(item=>'<p>'+esc(item.startTime||"")+' '+esc(item.name||"")+(item.visited?" ✓":"")+'</p>').join("")+'</div>').join(""):"<p>日程はまだ登録されていません。</p>")+'</article></div><section class="ticket-map-section"><div class="ticket-section-heading"><div><small>ROUTE MAP</small><b>この旅行の地図</b></div><span>'+places.length+' PLACES</span></div><div id="ticketRouteMap" class="ticket-route-map" aria-label="この旅行の訪問先地図"></div></section><section class="ticket-memories"><div class="ticket-section-heading"><div><small>DIARY & PHOTOS</small><b>この旅行の写真と思い出</b></div><span>'+entries.length+' RECORDS</span></div>'+(entries.length?entries.map(p=>'<article class="ticket-memory"><div class="ticket-memory-media" id="ticket-memory-'+esc(p.id)+'">'+(p.mediaKey||p.mediaType?"📷":"✧")+'</div><div><b>'+esc(p.title||"旅の思い出")+'</b><small>'+esc(p.date||"")+(p.place?" · "+esc(p.place):"")+'</small><p>'+esc(p.story||"")+'</p><button type="button" class="action ticket-memory-map-link" data-ticket-map-place="'+esc(p.place||"")+'">地図で見る</button></div></article>').join(""):"<p>この旅行に紐づく日記や写真はまだありません。</p>")+'</section><div class="ticket-detail-actions ticket-detail-management"><button type="button" class="btn navy" data-ticket-itinerary="'+esc(trip.id)+'">日程を管理</button><button type="button" class="btn ghost" data-ticket-edit="'+esc(trip.id)+'">旅行を編集</button><button type="button" class="btn ghost" data-copy-trip="'+esc(trip.id)+'">旅行を複製</button><button type="button" class="btn ghost" data-archive-trip="'+esc(trip.id)+'">'+(trip.archived?"アーカイブ解除":"アーカイブ")+'</button><button type="button" class="btn ghost" data-share-trip="'+esc(trip.id)+'">'+(shareRecords[trip.id]?"共有リンクをコピー":"旅行を共有")+'</button>'+(shareRecords[trip.id]?'<button type="button" class="btn ghost" data-revoke-share="'+esc(trip.id)+'">共有を停止</button>':"")+'<button type="button" class="btn ghost" data-delete-trip="'+esc(trip.id)+'">旅行を削除</button></div></section></div>';
 layer.innerHTML=h;layer.addEventListener("click",event=>{const button=event.target.closest("[data-ticket-map-place]");if(!button)return;const marker=layer._ticketMapMarkers?.get(button.dataset.ticketMapPlace);if(marker&&layer._ticketMap){layer._ticketMap.setView(marker.getLatLng(),14);marker.openPopup();}});document.body.append(layer);document.body.classList.add("ticket-open");requestAnimationFrame(()=>layer.classList.add("is-open"));
 layer.querySelector(".ticket-close").addEventListener("click",closeTicketExperience);
 layer.addEventListener("click",event=>{if(event.target===layer)closeTicketExperience();});
 layer.querySelector(".boarding-ticket").addEventListener("click",event=>{if(!event.target.closest(".tear-track"))finishTicketTear(layer);});
 const track=layer.querySelector(".tear-track"),progress=layer.querySelector(".tear-progress"),grip=layer.querySelector(".tear-grip");let drawing=false,maxProgress=0;
 track.addEventListener("pointerdown",e=>{const r=track.getBoundingClientRect();if(e.clientY>r.top+r.height*.18)return;drawing=true;maxProgress=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));track.setPointerCapture(e.pointerId);});
 track.addEventListener("pointermove",e=>{if(!drawing)return;const r=track.getBoundingClientRect();const pct=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));maxProgress=Math.max(maxProgress,pct);progress.style.height=(maxProgress*100)+"%";grip.style.top=(maxProgress*100)+"%";layer.querySelector(".ticket-stage")?.style.setProperty("--tear-progress",(maxProgress*100)+"%");if(maxProgress>=.88){drawing=false;finishTicketTear(layer);}});
 track.addEventListener("pointerup",()=>drawing=false);track.addEventListener("pointercancel",()=>drawing=false);
 layer.querySelector("[data-ticket-itinerary]").addEventListener("click",()=>{closeTicketExperience();openItinerary(trip.id);});
 layer.querySelector("[data-ticket-edit]").addEventListener("click",()=>{closeTicketExperience();const f=$("#tripEditForm");f.elements.id.value=trip.id;f.elements.title.value=trip.title||"";f.elements.area.value=trip.area||"";f.elements.departurePlace.value=trip.departurePlace||trip.originCountry||"";f.elements.date.value=trip.date||"";f.elements.endDate.value=trip.endDate||"";f.elements.description.value=trip.description||"";f.elements.tripType.value=trip.tripType||"standard";f.elements.relatedWork.value=trip.relatedWork||"";f.elements.budgetAmount.value=trip.budgetAmount||"";f.elements.budgetCurrency.value=trip.budgetCurrency||"JPY";f.elements.stops.value=(trip.stops||[]).join(", ");f.elements.visibility.value=trip.visibility||"private";openDialog("#tripEditDialog");});
 entries.forEach(async p=>{if(!p.mediaKey&&!p.mediaType)return;try{const blob=await loadPostMedia(p);const host=layer.querySelector("#ticket-memory-"+CSS.escape(p.id));if(blob&&host){const media=document.createElement(blob.type.startsWith("video/")?"video":"img");media.src=URL.createObjectURL(blob);layer._ticketObjectUrls=[...(layer._ticketObjectUrls||[]),media.src];media.alt=p.title||"旅行の思い出";if(media.tagName==="VIDEO"){media.controls=true;media.muted=true;media.playsInline=true;}host.replaceChildren(media);}}catch(error){console.warn("チケット内の写真を読み込めませんでした",error);}});
}
function renderTrips(){let own=trips.filter(t=>t.owner==="me"||t.source==="native"&&t.isMine);if(!own.length)own=trips.filter(t=>t.isMine);const query=($("#tripSearch")?.value||"").trim().toLowerCase(),view=$("#tripStatusFilter")?.value||"active",sort=$("#tripSort")?.value||"date-desc",type=$("#tripTypeFilter")?.value||"all";own=own.filter(t=>view==="all"||(view==="archived"?Boolean(t.archived):!t.archived));if(type!=="all")own=own.filter(t=>(t.tripType||"standard")===type);if(query)own=own.filter(t=>(String(t.title||"")+" "+String(t.area||"")+" "+String(t.description||"")+" "+String(t.relatedWork||"")).toLowerCase().includes(query));own.sort((a,b)=>sort==="date-asc"?String(a.date||"").localeCompare(String(b.date||"")):sort==="name"?String(a.title||"").localeCompare(String(b.title||""),"ja"):String(b.date||"").localeCompare(String(a.date||"")));$("#tripTotal").textContent=own.length+"件";$("#tripCards").innerHTML=own.length?own.map(t=>{const places=[...new Set([...(Array.isArray(t.stopLocations)?t.stopLocations:[]).map(p=>p.name),...(Array.isArray(t.stops)?t.stops:[])].filter(Boolean))];const visited=Array.isArray(t.actual)?t.actual:[];return `<article class="trip-card ticket-card ${selectedTrip===t.id?"selected":""}" data-open-ticket="${esc(t.id)}" tabindex="0" role="button" aria-label="${esc(t.title||"旅の記録")}のチケットを開く"><div class="ticket-card-main"><div class="ticket-card-top"><span>TABI LOG / ${t.tripType==="pilgrimage"?"PILGRIMAGE PASS":"JOURNEY PASS"}</span><span>${esc(t.title||"TRIP")}</span></div><div class="ticket-card-route"><div class="ticket-card-endpoint"><small>FROM</small><h3>${esc(t.departurePlace||t.originCountry||"出発地未設定")}</h3></div><span class="ticket-route-arrow">→</span><div class="ticket-card-endpoint ticket-card-destination"><small>TO</small><h3>${esc(t.area||t.title||"目的地未設定")}</h3></div></div><div class="ticket-card-meta"><span>${fmt(t.date)}${t.endDate?" — "+fmt(t.endDate):""}</span><span>${places.length} PLACES</span><span>${visited.length} VISITED</span></div></div><div class="ticket-card-stub"><span>BOARDING PASS</span><b>${esc(String(t.id||"").slice(-6).toUpperCase())}</b><i>✂ · · · · · · · · · ·</i><small>${t.source==="aileron"?"AILERON CONNECTED":"PERSONAL JOURNEY"}</small></div></article>`}).join(""):`<div class="empty-state">Aileronから旅行プランを取り込むと、ここに旅が表示されます。</div>`;}
$("#tripSearch")?.addEventListener("input",renderTrips);$("#tripStatusFilter")?.addEventListener("change",renderTrips);$("#tripSort")?.addEventListener("change",renderTrips);$("#tripTypeFilter")?.addEventListener("change",renderTrips);
function renderItineraryItems(){
 const trip=trips.find(item=>item.id===activeItineraryTripId),host=$("#itineraryItems");
 if(!trip||!host){if(host)host.innerHTML='<div class="empty-state">旅行が見つかりません。</div>';return;}
 const days=[...(trip.dayPlans||[])].sort((a,b)=>a.date.localeCompare(b.date));
 const count=days.reduce((sum,day)=>sum+(day.items||[]).length,0);$("#itineraryCount").textContent=count+"件";
 host.innerHTML=days.length?days.map(day=>{
  const items=[...(day.items||[])].sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||(a.startTime||"99:99").localeCompare(b.startTime||"99:99"));
  return `<section class="itinerary-day"><h4>${esc(new Date(day.date+"T00:00:00").toLocaleDateString("ja-JP",{month:"long",day:"numeric",weekday:"short"}))}</h4>${items.map(item=>`<article class="itinerary-item ${item.visited?"is-visited":""}"><div class="itinerary-time">${esc(item.startTime||"時間未設定")}${item.endTime?" – "+esc(item.endTime):""}</div><div class="itinerary-item-main"><b>${esc(item.name)}</b><p>${esc(item.note||"メモなし")}</p><span>${item.visited?"訪問済み":"予定"}</span></div><div class="itinerary-item-actions"><button type="button" class="action" data-itin-move="up" data-itin-id="${item.id}" ${items[0]?.id===item.id?"disabled":""}>↑ 上へ</button><button type="button" class="action" data-itin-move="down" data-itin-id="${item.id}" ${items[items.length-1]?.id===item.id?"disabled":""}>↓ 下へ</button><button type="button" class="action" data-itin-toggle="${item.id}">${item.visited?"未訪問に戻す":"訪問済みにする"}</button><button type="button" class="action" data-itin-edit="${item.id}">編集</button><button type="button" class="action" data-itin-delete="${item.id}">削除</button></div></article>`).join("")}</section>`;
 }).join(""):'<div class="empty-state">まだ日程がありません。上のフォームから最初の予定を追加できます。</div>';
}
function openItinerary(tripId){
 const trip=trips.find(item=>item.id===tripId);if(!trip)return;
 activeItineraryTripId=tripId;if(!Array.isArray(trip.dayPlans))trip.dayPlans=[];
 $("#itineraryHeading").textContent=trip.title+" の日程";
 const form=$("#itineraryForm");form.reset();form.elements.tripId.value=tripId;form.elements.itemId.value="";
 form.elements.dayDate.value=trip.date||new Date().toISOString().slice(0,10);
 $("#itinerarySaveButton").textContent="予定を追加";renderItineraryItems();openDialog("#itineraryDialog");
}
let routeLeafletMap=null, routeMapLayer=null, routeTileLayer=null, routeTileFallbackUsed=false;
const routeResultCache=new Map();
let routeAbortController=null,routeInFlightKey="",lastRouteRequestAt=0;
function cancelPendingRoute(){
 if(routeAbortController)routeAbortController.abort();
 routeAbortController=null;routeInFlightKey="";
}
function addApproximateRoute(points,layer){
 if(points.length>1)L.polyline(points,{color:"#c49a5e",weight:3,opacity:.65,dashArray:"7 8"}).addTo(layer);
}
function paintRealRoute(result,mode,layer,map){
 const line=L.polyline(result.latLngs,{color:"#b68b4f",weight:5,opacity:.92}).addTo(layer);
 if(line.getBounds().isValid())map.fitBounds(line.getBounds(),{padding:[32,32],maxZoom:13});
 const km=(Number(result.distance||0)/1000);
 const minutes=Math.round(Number(result.duration||0)/60);
 const distanceLabel=km>=10?km.toFixed(0):km.toFixed(1);
 const status=$("#routeStatus");
 if(status)status.textContent=(mode==="foot"?"徒歩ルート":"車の道路ルート")+"： 約"+distanceLabel+"km・約"+minutes+"分（経路データ：OpenStreetMap / FOSSGIS）";
}
async function drawTripRoute(points,layer,map){
 const status=$("#routeStatus");
 if(points.length<2){
  cancelPendingRoute();
  if(status)status.textContent="ルート検索には座標付きの訪問先が2か所以上必要です。";
  return;
 }
 const consent=$("#routeExternalConsent")?.checked===true;
 const mode=$("#routeMode")?.value==="foot"?"foot":"car";
 const coordinates=points.map(([lat,lon])=>Number(lon).toFixed(6)+","+Number(lat).toFixed(6)).join(";");
 if(!consent){
  cancelPendingRoute();addApproximateRoute(points,layer);
  if(status)status.textContent="外部送信はオフです。表示中の点線は訪問順の概略線で、道路・徒歩の実経路ではありません。";
  return;
 }
 const key=mode+"|"+coordinates;
 if(routeInFlightKey&&routeInFlightKey!==key)cancelPendingRoute();
 const cached=routeResultCache.get(key);
 if(cached){paintRealRoute(cached,mode,layer,map);return;}
 if(routeInFlightKey===key){
  if(status)status.textContent=(mode==="foot"?"徒歩":"車")+"ルートを検索中…";
  return;
 }
 const controller=new AbortController();
 routeAbortController=controller;routeInFlightKey=key;
 if(status)status.textContent=(mode==="foot"?"徒歩":"車")+"ルートを検索中…";
 try{
  const wait=Math.max(0,1200-(Date.now()-lastRouteRequestAt));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(controller.signal.aborted)return;
  lastRouteRequestAt=Date.now();
  const profile=mode==="foot"?"routed-foot":"routed-car";
  const url="https://routing.openstreetmap.de/"+profile+"/route/v1/driving/"+coordinates+"?overview=full&geometries=geojson&steps=false";
  const response=await fetch(url,{signal:controller.signal,headers:{Accept:"application/json"},referrerPolicy:"strict-origin-when-cross-origin"});
  if(!response.ok)throw new Error("経路サービスの応答："+response.status);
  const data=await response.json(),route=data.routes?.[0];
  if(data.code!=="Ok"||!Array.isArray(route?.geometry?.coordinates))throw new Error("この訪問順のルートを取得できませんでした");
  const latLngs=route.geometry.coordinates.map(pair=>[Number(pair[1]),Number(pair[0])]).filter(pair=>Number.isFinite(pair[0])&&Number.isFinite(pair[1])&&Math.abs(pair[0])<=90&&Math.abs(pair[1])<=180);
  if(!latLngs.length)throw new Error("経路データが空でした");
  const result={latLngs,distance:Number(route.distance)||0,duration:Number(route.duration)||0};
  routeResultCache.set(key,result);
  if(routeResultCache.size>12)routeResultCache.delete(routeResultCache.keys().next().value);
  if(controller.signal.aborted)return;
  paintRealRoute(result,mode,layer,map);
 }catch(error){
  if(controller.signal.aborted)return;
  addApproximateRoute(points,layer);
  if(status)status.textContent="実ルートを取得できませんでした。点線は訪問順の概略線です（実際の経路ではありません）。";
  console.warn("ルート検索に失敗しました:",error);
 }finally{
  if(routeInFlightKey===key){routeInFlightKey="";routeAbortController=null;}
 }
}
function addRouteBaseTiles(){
 const primary=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  crossOrigin:true
 });
 primary.on("tileerror",()=>{
  if(routeTileFallbackUsed||!routeLeafletMap)return;
  routeTileFallbackUsed=true;
  primary.remove();
  routeTileLayer=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{
   subdomains:"abcd",maxZoom:20,
   attribution:'&copy; OpenStreetMap contributors &copy; CARTO',
   crossOrigin:true
  }).addTo(routeLeafletMap);
 });
 routeTileLayer=primary.addTo(routeLeafletMap);
}

function renderMap(){
 const t=trips.find(x=>x.id===selectedTrip),host=$("#routeMap"),list=$("#mapStopList");
 const title=$("#mapTitle");
 if(title)title.textContent=t?t.title:"旅の地図";
 if(list)list.innerHTML="";
 if(!host)return;
 host.querySelector(".map-overlay-empty")?.remove();
 if(!window.L){
  host.innerHTML='<div class="map-unavailable">地図ライブラリを読み込めませんでした。ページを再読み込みしてください。</div>';
  return;
 }
 if(!routeLeafletMap){
  host.innerHTML="";
  routeLeafletMap=L.map(host,{scrollWheelZoom:false}).setView([36.2,138.25],5);
  addRouteBaseTiles();
  routeMapLayer=L.layerGroup().addTo(routeLeafletMap);
 }
 routeMapLayer.clearLayers();
 if(!t){
  cancelPendingRoute();
  host.insertAdjacentHTML("beforeend",'<div class="map-overlay-empty">Aileronから旅行プランを取り込むと、ここに地図が表示されます。</div>');
  setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),150);
  return;
 }
 const locations=Array.isArray(t.stopLocations)?t.stopLocations:[];
 const valid=locations.filter(p=>{
  const lat=Number(p?.latitude),lon=Number(p?.longitude);
  return p?.name&&p?.latitude!==null&&p?.latitude!==undefined&&p?.latitude!==""&&p?.longitude!==null&&p?.longitude!==undefined&&p?.longitude!==""&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
 });
 if(!valid.length){
  cancelPendingRoute();
  host.insertAdjacentHTML("beforeend",'<div class="map-overlay-empty">この旅行には有効な地図座標がありません。立ち寄り先の座標を確認してください。</div>');
  setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),150);
  return;
 }
 const bounds=[];
 valid.forEach((p,index)=>{
  const visited=(t.actual||[]).includes(p.name),point=[Number(p.latitude),Number(p.longitude)];
  bounds.push(point);
  const icon=L.divIcon({className:"tabi-map-marker-wrap",html:'<span class="tabi-map-marker '+(visited?"visited":"planned")+'">'+(index+1)+'</span>',iconSize:[32,38],iconAnchor:[16,34]});
  const marker=L.marker(point,{icon}).addTo(routeMapLayer);
  const popup=document.createElement("div");popup.className="tabi-map-popup";
  const heading=document.createElement("strong");heading.textContent=p.name;popup.append(heading);
  const state=document.createElement("div");state.className="map-pin-state";state.textContent=visited?"訪問済み":"旅行予定";popup.append(state);
  const diary=posts.filter(post=>post.tripId===t.id&&String(post.place||"").trim()===p.name);
  const count=document.createElement("div");count.className="map-pin-count";count.textContent=diary.length?diary.length+"件の記録":"まだ写真・日記はありません";popup.append(count);
  const photoBox=document.createElement("div");photoBox.className="map-pin-photos";popup.append(photoBox);
  const addPhoto=document.createElement("button");addPhoto.type="button";addPhoto.className="map-pin-add-photo";addPhoto.textContent="＋ この場所に日記・写真を追加";
  addPhoto.addEventListener("click",()=>openMapMemoryComposer(t,p,routeLeafletMap));
  popup.append(addPhoto);
  const diaryBox=document.createElement("div");diaryBox.className="map-pin-diaries";popup.append(diaryBox);
  marker.bindPopup(popup);
  marker.on("popupopen",async()=>{
   diaryBox.replaceChildren();photoBox.replaceChildren();
   if(!diary.length){const empty=document.createElement("small");empty.textContent="この場所の日記・写真はまだありません";diaryBox.append(empty);}
   for(const entry of diary){
    const row=document.createElement("div");row.className="map-pin-memory-row";
    const title=document.createElement("b");title.textContent=entry.title||"旅の記録";row.append(title);
    if(entry.story){const story=document.createElement("p");story.textContent=entry.story;row.append(story);}
    row.append(makeMapEditButton(entry));diaryBox.append(row);
    if(!entry.mediaKey&&!entry.mediaType)continue;
    try{
     const blob=await loadPostMedia(entry);if(!blob)continue;
     const item=document.createElement("div");item.className="map-pin-photo-item";
     const img=document.createElement(blob.type.startsWith("video/")?"video":"img");
     img.alt=entry.title||p.name;img.src=URL.createObjectURL(blob);
     if(img.tagName==="VIDEO"){img.controls=true;img.muted=true;img.playsInline=true;}
     item.append(img);item.append(makeMapEditButton(entry));
     const remove=document.createElement("button");remove.type="button";remove.className="map-pin-photo-delete";remove.textContent="日記ごと削除";
     remove.addEventListener("click",async()=>{if(!confirm("この日記と写真を削除しますか？"))return;remove.disabled=true;try{await deleteDiaryEntry(entry);renderAll();toast("記録を削除しました");}catch(error){remove.disabled=false;toast(error.message||"削除できませんでした");}});
     item.append(remove);photoBox.append(item);
    }catch(error){console.warn("地図の写真を読み込めませんでした",error);}
   }
  });
  const pill=document.createElement("button");pill.type="button";pill.className="stop-pill";pill.textContent=(visited?"✓ ":"")+p.name;
  pill.addEventListener("click",()=>{routeLeafletMap.setView(point,13);marker.openPopup();});
  if(list)list.append(pill);
 });
 drawTripRoute(bounds,routeMapLayer,routeLeafletMap);
 routeLeafletMap.fitBounds(bounds,{padding:[28,28],maxZoom:12});
 setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),100);
 setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),450);
}
window.addEventListener("resize",()=>{
 if(routeLeafletMap)setTimeout(()=>routeLeafletMap.invalidateSize({pan:false}),100);
});
$("#routeExternalConsent")?.addEventListener("change",()=>renderMap());
$("#routeMode")?.addEventListener("change",()=>{if($("#routeExternalConsent")?.checked)renderMap();});
async function processPendingImport(){
 const token=new URLSearchParams(location.search).get("import");
 if(!token||!signedInUser||!sessionToken)return;
 try{
  const response=await fetch(API_BASE+"/api/imports/"+encodeURIComponent(token),{method:"POST",headers:{authorization:"Bearer "+sessionToken}});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||"Aileronの旅行プランを取り込めませんでした");
  history.replaceState(null,"",location.pathname+location.hash);
  await syncCloudData();
  selectedTrip=data.tripId;
  renderAll();
  $("#mytrips").scrollIntoView({behavior:"smooth",block:"start"});
  toast("Aileronの旅行プランと地図を取り込みました");
 }catch(error){toast(error.message||"旅行プランの取り込みに失敗しました");}
}

function renderDiary(){const timeline=$("#diaryTimeline");if(!timeline)return;let mine=posts.filter(p=>p.author===profile.name).sort((a,b)=>String(b.date).localeCompare(String(a.date)));timeline.innerHTML=mine.length?mine.map(p=>`<div class="timeline-item"><div class="timeline-date">${esc(p.date||"今日")}</div><div class="timeline-line"></div><article class="timeline-card"><div class="timeline-thumb" id="diary-thumb-${p.id}">${p.mediaKey||p.mediaType?(String(p.mediaType||"").startsWith("video/")?"🎬":"📷"):p.symbol||"📍"}</div><div class="timeline-content"><small>📍 ${esc(p.place)}</small><h3>${esc(p.title)}</h3><p>${esc(p.story)}</p><div class="timeline-actions"><button class="action" type="button" data-edit-diary="${p.id}">編集</button><button class="action" type="button" data-delete-diary="${p.id}">削除</button></div></div></article></div>`).join(""):`<div class="empty-state">ここに日記・思い出が時系列で並びます。「日記を追加」から記録できます。</div>`;mine.forEach(async p=>{if(!p.mediaKey&&!p.mediaType)return;try{const blob=await loadPostMedia(p);const thumb=$("#diary-thumb-"+p.id);if(blob&&thumb){const media=document.createElement(blob.type.startsWith("video/")?"video":"img");media.src=URL.createObjectURL(blob);media.alt=p.title||"旅行の思い出";if(media.tagName==="VIDEO"){media.controls=true;media.muted=true;media.playsInline=true;}thumb.replaceChildren(media);}}catch(error){console.warn("写真の読み込みに失敗:",error);}});}
function renderProfile(){let mine=posts.filter(p=>p.author===profile.name);$("#profileName").textContent=profile.name;$("#profileBio").textContent=profile.bio;if($("#travelerName"))$("#travelerName").textContent=profile.name;if($("#travelerBio"))$("#travelerBio").textContent=profile.bio;$("#profilePostCount").textContent=mine.length;$("#profileTripCount").textContent=trips.filter(t=>t.isMine).length;if($("#followingCount"))$("#followingCount").textContent=0;$("#statTrips").textContent=trips.filter(t=>t.isMine).length;$("#statPosts").textContent=mine.length;$("#statSaved").textContent=saved.length;if($("#mobileStatTrips"))$("#mobileStatTrips").textContent=trips.filter(t=>t.isMine).length;if($("#mobileStatPosts"))$("#mobileStatPosts").textContent=mine.length;if($("#mobileStatSaved"))$("#mobileStatSaved").textContent=saved.length;}renderAvatarImage();
function renderExpenses(){
 const host=$("#expenseList"),summary=$("#expenseSummary");if(!host||!summary)return;
 const ownTrips=trips.filter(t=>t.isMine);
 summary.innerHTML=ownTrips.map(t=>{
  const items=expenses.filter(item=>item.tripId===t.id),currency=t.budgetCurrency||"JPY";
  const spent=items.filter(item=>(item.currency||"JPY")===currency).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const budget=Number(t.budgetAmount||0),remaining=budget-spent,byCategory={};
  items.filter(item=>(item.currency||"JPY")===currency).forEach(item=>{byCategory[item.category]=(byCategory[item.category]||0)+Number(item.amount||0);});
  return `<article class="expense-budget-card"><div class="expense-budget-head"><div><b>${esc(t.title)}</b><small>${esc(t.area)}</small></div><span>${budget?esc(currency)+" "+budget.toLocaleString("ja-JP"):"予算未設定"}</span></div><div class="expense-budget-numbers"><div><small>支出合計（${esc(currency)}）</small><b>${spent.toLocaleString("ja-JP")}</b></div><div><small>${budget?"予算残額":"記録件数"}</small><b>${budget?remaining.toLocaleString("ja-JP"):items.length+"件"}</b></div></div>${budget?`<div class="expense-progress"><span style="width:${Math.min(100,spent/budget*100)}%"></span></div><small class="expense-progress-label">${Math.round(spent/budget*100)}% 使用</small>`:""}<div class="expense-category-list">${Object.entries(byCategory).map(([name,value])=>`<span>${esc(name)} ${value.toLocaleString("ja-JP")} ${esc(currency)}</span>`).join("")}</div></article>`;
 }).join("")||'<div class="empty-state">旅行を作成すると、予算と支出を管理できます。</div>';
 const list=[...expenses].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 host.innerHTML=list.length?list.map(item=>{const trip=trips.find(t=>t.id===item.tripId);return `<article class="expense-row"><div><b>${esc(item.category)}</b><small>${esc(trip?.title||"旅行")} · ${esc(item.date)}</small><p>${esc(item.note||"")}</p></div><strong>${Number(item.amount).toLocaleString("ja-JP")} ${esc(item.currency||"JPY")}</strong><div class="expense-actions"><button class="action" type="button" data-expense-edit="${item.id}">編集</button><button class="action" type="button" data-expense-delete="${item.id}">削除</button></div></article>`;}).join(""):'<div class="empty-state">まだ支出がありません。「支出を記録」から追加できます。</div>';
}
async function renderCommunityFeed(){const host=$("#communityFeed");if(!host)return;if(!API_BASE){host.innerHTML='<div class="empty-state">公開フィードの接続設定を確認中です。</div>';return;}try{const response=await fetch(API_BASE+"/api/feed",{headers:{accept:"application/json"}});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"公開記録を読み込めませんでした");const items=Array.isArray(data.items)?data.items:[];host.innerHTML=items.length?items.map(item=>`<article class="community-card"><div class="community-card-top"><span class="community-avatar">${esc((item.display_name||"旅").slice(0,1))}</span><span>${esc(item.display_name||"旅好きユーザー")}</span><small>${fmt(item.created_at)}</small></div><h3>${esc(item.title)}</h3><p class="community-place">📍 ${esc(item.place_name||"場所未設定")}</p><p>${esc(item.story||"")}</p></article>`).join(""):'<div class="empty-state">まだ公開された記録がありません。自分の思い出を「みんなに公開」にすると、ここに表示されます。</div>';}catch(error){host.innerHTML='<div class="empty-state">公開記録を読み込めませんでした。時間をおいて再読み込みしてください。</div>';console.warn("公開フィード:",error);}}
function renderJourneyCollection(){
 const own=trips.filter(t=>t.isMine),visitedPlaces=new Set(own.flatMap(t=>(t.actual||[]).map(x=>String(x).trim()).filter(Boolean)));
 const memoryCount=posts.filter(p=>p.author===profile.name).length,pilgrimage=own.filter(t=>t.tripType==="pilgrimage");
 const stats=$("#collectionStats");
 if(stats)stats.innerHTML='<article><b>'+own.length+'</b><span>旅のチケット</span></article><article><b>'+visitedPlaces.size+'</b><span>訪れた場所</span></article><article><b>'+memoryCount+'</b><span>思い出の記録</span></article><article><b>'+pilgrimage.length+'</b><span>聖地巡礼</span></article>';
 const yearHost=$("#journeyYearbook");
 if(yearHost){const years={};own.filter(t=>/^\\d{4}/.test(t.date||"")).forEach(t=>{const y=t.date.slice(0,4);(years[y]??=[]).push(t);});const ordered=Object.keys(years).sort((x,y)=>y.localeCompare(x));
 yearHost.innerHTML=ordered.length?ordered.map(y=>'<section class="yearbook-year"><h4>'+esc(y)+' <small>'+years[y].length+' JOURNEYS</small></h4><div>'+years[y].sort((x,z)=>String(z.date).localeCompare(String(x.date))).map(t=>'<button type="button" class="yearbook-ticket" data-yearbook-trip="'+esc(t.id)+'"><span>'+esc(t.date||"日付未設定")+'</span><b>'+esc(t.title||"旅の記録")+'</b><small>'+esc(t.area||"")+'</small></button>').join("")+'</div></section>').join(""):'<p class="empty-state">旅行を記録すると、ここに年ごとの旅の年表ができます。</p>';}
 const pilgrimageHost=$("#pilgrimageCollection");
 if(pilgrimageHost)pilgrimageHost.innerHTML=pilgrimage.length?pilgrimage.map(t=>'<button type="button" class="pilgrimage-item" data-yearbook-trip="'+esc(t.id)+'"><span>聖地巡礼</span><b>'+esc(t.relatedWork||"作品名未設定")+'</b><small>'+esc(t.title)+' · '+esc(t.area)+'</small></button>').join(""):'<p class="empty-state">旅行作成時に「聖地巡礼」を選ぶと、作品ごとの記録がここに集まります。</p>';
}
document.addEventListener("click",event=>{const button=event.target.closest("[data-yearbook-trip]");if(button)openTravelTicket(button.dataset.yearbookTrip);});
function renderAll(){renderFeed();renderTrips();renderDiary();renderProfile();renderJourneyCollection();renderExpenses();renderCommunityFeed();}
function openDialog(id){$(id).showModal()}function closeDialog(id){$(id).close()}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog("#"+b.dataset.close)));
$("#closeSaveSuccess").addEventListener("click",()=>closeDialog("#saveSuccessDialog"));
$("#openTrip").onclick=()=>location.assign("https://aileron-japan-travel.pages.dev/");const heroTripButton=$("#heroTrip");if(heroTripButton)heroTripButton.onclick=()=>location.assign("https://aileron-japan-travel.pages.dev/");$("#openPost").onclick=()=>{refreshTripSelect();openDialog("#postDialog")};
function refreshPostPlaces(tripId){
 const trip=trips.find(t=>t.id===tripId),host=$("#postPlaceOptions");if(!host)return;
 const places=[...new Set([...(trip?.stops||[]),...(trip?.stopLocations||[]).map(p=>p.name).filter(Boolean)])];
 host.innerHTML=places.map(name=>'<option value="'+esc(name)+'"></option>').join("");
}
function refreshTripSelect(){$("#postTripSelect").innerHTML='<option value="">旅程に紐づけない</option>'+trips.filter(t=>t.isMine).map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");refreshPostPlaces($("#postTripSelect").value);}
$("#postTripSelect").addEventListener("change",e=>refreshPostPlaces(e.target.value));
$("#tripForm").addEventListener("submit",e=>{e.preventDefault();let f=new FormData(e.currentTarget),startDate=String(f.get("date")||""),endDate=String(f.get("endDate")||"");if(startDate&&endDate&&endDate<startDate){toast("終了日は開始日以降にしてください");return;}let stops=String(f.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean),t={id:uid(),title:f.get("title"),area:f.get("area"),departurePlace:String(f.get("departurePlace")||"").trim(),date:startDate,endDate,tripType:String(f.get("tripType")||"standard"),relatedWork:String(f.get("relatedWork")||"").trim(),description:f.get("description"),visibility:f.get("visibility")||"private",budgetAmount:Number(f.get("budgetAmount")||0),budgetCurrency:String(f.get("budgetCurrency")||"JPY"),stops,actual:[],dayPlans:[],isMine:true,owner:"me",source:"native"};trips.unshift(t);selectedTrip=t.id;save();e.currentTarget.reset();closeDialog("#tripDialog");renderAll();toast("旅程を作成しました");});
$("#itineraryForm").addEventListener("submit",e=>{
 e.preventDefault();
 const form=e.currentTarget,data=new FormData(form),trip=trips.find(item=>item.id===activeItineraryTripId);
 if(!trip){toast("旅行が見つかりません");return;}
 const date=String(data.get("dayDate")||""),name=String(data.get("name")||"").trim();
 if(!date||!name){toast("日付と予定名を入力してください");return;}
 if((trip.date&&date<trip.date)||(trip.endDate&&date>trip.endDate)){toast("旅行の開始日・終了日の範囲内の日付を選んでください");return;}
 if(!Array.isArray(trip.dayPlans))trip.dayPlans=[];
 const itemId=String(data.get("itemId")||""),startTime=String(data.get("startTime")||""),endTime=String(data.get("endTime")||"");
 if(startTime&&endTime&&endTime<startTime){toast("終了時刻は開始時刻より後にしてください");return;}
 const previousDay=itemId?trip.dayPlans.find(entry=>entry.items.some(item=>item.id===itemId)):null;
 const previousItem=previousDay?.items.find(item=>item.id===itemId)||null;
 if(previousItem&&previousDay.date!==date)previousDay.items=previousDay.items.filter(item=>item.id!==itemId);
 let day=trip.dayPlans.find(item=>item.date===date);if(!day){day={date,items:[]};trip.dayPlans.push(day);}
 const item={id:itemId||uid(),name,startTime,endTime,note:String(data.get("note")||"").trim(),visited:Boolean(previousItem?.visited),sortOrder:previousItem?(previousDay===day?previousItem.sortOrder:day.items.length):day.items.length};
 if(itemId&&previousItem){const index=day.items.findIndex(entry=>entry.id===itemId);if(index>=0)day.items[index]=item;else day.items.push(item);}else day.items.push(item);
 trip.dayPlans=trip.dayPlans.filter(entry=>entry.items.length);save();
 form.elements.itemId.value="";form.elements.name.value="";form.elements.startTime.value="";form.elements.endTime.value="";form.elements.note.value="";
 $("#itinerarySaveButton").textContent="予定を追加";renderItineraryItems();renderTrips();toast(itemId?"予定を更新しました":"予定を追加しました");
});
$("#itineraryItems").addEventListener("click",e=>{
 const button=e.target.closest("button");if(!button)return;
 const trip=trips.find(item=>item.id===activeItineraryTripId);if(!trip)return;
 const action=button.dataset.itinToggle||button.dataset.itinEdit||button.dataset.itinDelete||button.dataset.itinId;if(!action)return;
 const day=trip.dayPlans.find(entry=>entry.items.some(item=>item.id===action));if(!day)return;
 const index=day.items.findIndex(item=>item.id===action),item=day.items[index];
 if(button.dataset.itinToggle){item.visited=!item.visited;save();renderItineraryItems();toast(item.visited?"訪問済みにしました":"未訪問に戻しました");return;}
 if(button.dataset.itinEdit){const form=$("#itineraryForm");form.elements.tripId.value=trip.id;form.elements.itemId.value=item.id;form.elements.dayDate.value=day.date;form.elements.name.value=item.name;form.elements.startTime.value=item.startTime||"";form.elements.endTime.value=item.endTime||"";form.elements.note.value=item.note||"";$("#itinerarySaveButton").textContent="変更を保存";form.elements.name.focus();return;}
 if(button.dataset.itinMove){const ordered=[...day.items].sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0));const current=ordered.findIndex(entry=>entry.id===item.id);const target=current+(button.dataset.itinMove==="up"?-1:1);if(target<0||target>=ordered.length)return;[ordered[current],ordered[target]]=[ordered[target],ordered[current]];ordered.forEach((entry,index)=>entry.sortOrder=index);day.items=ordered;save();renderItineraryItems();toast("日程の順番を変更しました");return;}
 if(button.dataset.itinDelete&&confirm("この予定を削除しますか？")){day.items.splice(index,1);trip.dayPlans=trip.dayPlans.filter(entry=>entry.items.length);save();renderItineraryItems();renderTrips();toast("予定を削除しました");}
});
$("#tripEditForm").addEventListener("submit",e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,t=trips.find(x=>x.id===id);if(!t){toast("編集する旅行が見つかりません");return;}const data=new FormData(f);t.title=String(data.get("title")||"").trim();t.area=String(data.get("area")||"").trim();t.departurePlace=String(data.get("departurePlace")||"").trim();t.date=String(data.get("date")||"");t.endDate=String(data.get("endDate")||"");if(t.date&&t.endDate&&t.endDate<t.date){toast("終了日は開始日以降にしてください");return;}t.description=String(data.get("description")||"");t.tripType=String(data.get("tripType")||"standard");t.relatedWork=String(data.get("relatedWork")||"").trim();t.budgetAmount=Number(data.get("budgetAmount")||0);t.budgetCurrency=String(data.get("budgetCurrency")||"JPY");t.stops=String(data.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean);t.visibility=String(data.get("visibility")||"private");save();closeDialog("#tripEditDialog");renderAll();toast("旅行を更新しました");});
$("#postForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const returnTicketId=activeTicketId||document.getElementById("ticketExperience")?._ticketTrip?.id||"";
 const formElement=e.currentTarget;
 const f=new FormData(formElement);
 if(f.get("visibility")==="public"&&(!signedInUser||!sessionToken)){toast("公開するにはGoogleログインしてください");return;}
 let file=f.get("mediaLibrary");
 if(!file||!file.size)file=f.get("mediaCamera");
 if(!file||!file.size)file=f.get("mediaVideo");
 const isVideo=Boolean(file&&file.size&&String(file.type||"").startsWith("video/"));
 if(file&&file.size){
  const allowedTypes=["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"];
  if(!allowedTypes.includes(file.type)){toast("写真はJPEG・PNG・WebP、動画はMP4・WebM・MOVに対応しています");return;}
  const maxBytes=isVideo?20*1024*1024:5*1024*1024;
  if(file.size>maxBytes){toast(isVideo?"動画1本の上限は20MBです":"写真1枚の上限は5MBです");return;}
 }
 const linkedTripId=String(f.get("tripId")||"");
 const postId=uid();
 const p={id:postId,title:f.get("title"),place:f.get("place"),story:f.get("story"),author:profile.name,date:f.get("capturedAt")||new Date().toISOString(),category:f.get("category"),visual:"v4",symbol:isVideo?"🎬":"📷",likes:0,liked:false,saved:false,visibility:f.get("visibility"),tripId:linkedTripId,mediaKey:file&&file.size?postId:null,driveFileId:null,mediaType:file&&file.size?file.type:"",cloudMediaSynced:false,approxLocation:false,comments:[]};
 if(file&&file.size){
  try{await mediaPut(postId,file);}
  catch{toast("端末内への写真保存に失敗しました");return;}
 }
 posts.unshift(p);
 if(linkedTripId){
  const linkedTrip=trips.find(x=>x.id===linkedTripId);
  if(linkedTrip){
   if(!Array.isArray(linkedTrip.actual))linkedTrip.actual=[];
   if(p.place&&!linkedTrip.actual.includes(p.place))linkedTrip.actual.push(p.place);
   selectedTrip=linkedTripId;
  }
 }
 save();
 formElement.reset();
 closeDialog("#postDialog");
 const successDialog=$("#saveSuccessDialog");
 const successTitle=$("#saveSuccessTitle");
 const successMessage=$("#saveSuccessMessage");
 const mediaKind=file&&file.size?(isVideo?"動画":"写真"):"";
 successTitle.textContent=file&&file.size?mediaKind+"を保存しました":"日記を保存しました";
 successMessage.textContent="この端末に保存しました。クラウド同期を確認しています。";
 try{
  if(!successDialog.open)successDialog.showModal();
 }catch(error){
  console.warn("保存完了ダイアログを表示できません:",error);
 }
 toast("✓ "+(file&&file.size?mediaKind+"と日記":"日記")+"を保存しました");
 renderAll();
 if(returnTicketId&&trips.some(item=>item.id===returnTicketId))restoreTicketAfterSave(returnTicketId);
 if(signedInUser&&sessionToken){
  clearTimeout(cloudSyncTimer);
  try{
   const cloudSaved=await syncCloudData();
   if(cloudSaved){
    if(isVideo){
     successMessage.textContent="動画はこの端末内に保存しました。動画のクラウド同期は未対応です。別の端末へ移す場合は、動画を含むバックアップを利用してください。";
     toast("日記を同期しました（動画はこの端末内のみ）");
    }else{
     successMessage.textContent=file&&file.size?(p.cloudMediaSynced?"日記と写真をクラウドに保存しました。別の端末でも表示できます。":"日記はクラウドに同期しました。写真はこのブラウザ内に保存されています。別端末へ移す場合はバックアップを利用してください。"):"日記をクラウドにも同期しました。";
     toast(file&&file.size?(p.cloudMediaSynced?"✓ 写真もクラウドに保存しました":"日記を同期しました（写真はこの端末内に保存）"):"✓ 日記を保存し、クラウドにも同期しました");
    }
   }else{
    successMessage.textContent="端末には保存しましたが、クラウド同期は未完了です。別の端末にはまだ反映されていません。";
    toast("端末には保存済みですが、クラウド同期は未完了です");
   }
  }catch(error){
   console.warn("日記のクラウド同期に失敗:",error);
   successMessage.textContent="端末には保存しましたが、クラウド同期を確認できませんでした。";
   toast("端末には保存済みですが、クラウド同期を確認できません");
  }
 }else{
  successMessage.textContent=file&&file.size?(isVideo?"動画と日記はこの端末に保存しました。動画はクラウド同期されません。別の端末へ移す場合はバックアップを利用してください。":"写真と日記はこの端末に保存しました。別の端末には自動で同期されません。"):"日記をこの端末に保存しました。ログインしていない場合、別の端末には自動で同期されません。";
 }
});
$("#diaryEditForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const returnTicketId=activeTicketId||document.getElementById("ticketExperience")?._ticketTrip?.id||"";
 const f=e.currentTarget,id=f.elements.id.value,p=posts.find(x=>x.id===id&&x.author===profile.name);
 if(!p){toast("編集する日記が見つかりません");return;}
 const data=new FormData(f),file=data.get("mediaReplace");
 if(file&&file.size){
  const isVideo=String(file.type||"").startsWith("video/");
  const allowed=["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"];
  if(!allowed.includes(file.type)){toast("写真はJPEG・PNG・WebP、動画はMP4・WebM・MOVに対応しています");return;}
  const maxBytes=isVideo?20*1024*1024:5*1024*1024;
  if(file.size>maxBytes){toast(isVideo?"動画1本の上限は20MBです":"写真1枚の上限は5MBです");return;}
  try{await mediaPut(p.id,file);p.mediaKey=p.id;p.mediaType=file.type;p.cloudMediaSynced=false;}
  catch{toast("端末内への保存に失敗しました");return;}
 }
 p.title=String(data.get("title")||"").trim();p.place=String(data.get("place")||"").trim();p.story=String(data.get("story")||"").trim();p.date=String(data.get("capturedAt")||"");p.visibility=String(data.get("visibility")||"private");
 save();closeDialog("#diaryEditDialog");renderAll();
 if(returnTicketId&&trips.some(item=>item.id===returnTicketId))restoreTicketAfterSave(returnTicketId);
 let synced=true;if(signedInUser&&sessionToken){clearTimeout(cloudSyncTimer);synced=await syncCloudData();}
 if(file&&file.size&&String(file.type||"").startsWith("video/"))toast(synced?"動画をこの端末に保存しました（クラウド同期未対応）":"動画は端末内保存済み。日記のクラウド同期は未完了です");
 else if(file&&file.size)toast(synced&&p.cloudMediaSynced?"写真をクラウドに更新しました":"日記を更新しました（写真はこの端末内に保存）");
 else toast("日記を更新しました");
});
const diaryTimelineElement=$("#diaryTimeline");if(diaryTimelineElement)diaryTimelineElement.addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;const id=b.dataset.editDiary||b.dataset.deleteDiary;if(!id)return;const p=posts.find(x=>x.id===id&&x.author===profile.name);if(!p)return;if(b.dataset.editDiary){const f=$("#diaryEditForm");f.elements.id.value=p.id;f.elements.title.value=p.title||"";f.elements.place.value=p.place||"";f.elements.capturedAt.value=String(p.date||"").slice(0,16);f.elements.story.value=p.story||"";f.elements.visibility.value=p.visibility||"private";openDialog("#diaryEditDialog");return;}if(b.dataset.deleteDiary&&confirm(p.mediaKey?"この日記と写真を削除しますか？":"この日記を削除しますか？")){try{await deleteDiaryEntry(p);renderAll();toast(p.mediaKey?"✓ 写真と日記を削除しました":"✓ 日記を削除しました");}catch(err){toast(err.message||"削除に失敗しました");}}});

function openProfileEditor(){const currentTicket=document.getElementById("ticketExperience");if(currentTicket?._ticketTrip?.id)activeTicketId=currentTicket._ticketTrip.id;const f=$("#profileForm"),dialog=$("#profileDialog");if(!f||!dialog){toast("プロフィール編集画面を読み込めませんでした");return;}f.elements.name.value=profile.name||"";f.elements.bio.value=profile.bio||"";f.elements.avatar.value="";f.elements.removeAvatar.checked=false;if(!dialog.open)dialog.showModal();}
$("#profileForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const returnTicketId=activeTicketId||document.getElementById("ticketExperience")?._ticketTrip?.id||"";
 const form=e.currentTarget,f=new FormData(form),old=profile.name,file=f.get("avatar"),nextName=String(f.get("name")||"").trim();
 if(!nextName){toast("表示名を入力してください");form.elements.name.focus();return;}
 const next={...profile,name:nextName.slice(0,30),bio:String(f.get("bio")||"").trim().slice(0,140)};
 try{
  if(file&&file.size){
   if(!file.type.match(/^image\/(jpeg|png|webp)$/))throw new Error("JPG・PNG・WebP画像を選択してください");
   if(file.size>5*1024*1024)throw new Error("画像は5MB以下にしてください");
   const key="profile-avatar-"+(activeAccountStorageId||"guest");
   await mediaPut(key,file);next.avatarMediaKey=key;
  }else if(f.get("removeAvatar")==="on"){
   if(profile.avatarMediaKey)await mediaDelete(profile.avatarMediaKey);
   next.avatarMediaKey="";
  }
  profile=next;
  posts.forEach(p=>{if(p.author===old)p.author=profile.name});
  save();
  if(signedInUser&&sessionToken){
   const response=await fetch(API_BASE+"/api/profile",{method:"PUT",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({name:profile.name,bio:profile.bio})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||"プロフィールのクラウド保存に失敗しました");
   signedInUser={...signedInUser,name:data.profile.name,bio:data.profile.bio};
  }
  closeDialog("#profileDialog");renderAll();
  if(returnTicketId&&trips.some(item=>item.id===returnTicketId))restoreTicketAfterSave(returnTicketId);
  toast(signedInUser?"プロフィールを保存しました":"プロフィールをこの端末に保存しました");
 }catch(error){renderAll();toast(error.message||"プロフィールを保存できませんでした");}
});
$("#privacySettings").onclick=()=>openDialog("#privacyDialog");
$("#deleteAccountButton")?.addEventListener("click",async()=>{
 if(!signedInUser||!sessionToken){toast("アカウント削除にはGoogleログインが必要です");return;}
 if(!API_BASE){toast("アカウント削除APIに接続できません");return;}
 const typed=prompt("旅ログのアカウントと保存データを削除します。続行するには DELETE と入力してください。");
 if(typed!=="DELETE"){toast("削除をキャンセルしました");return;}
 if(!confirm("旅行・日記・写真クラウドデータ・支出・ログインセッションを削除します。この操作は取り消せません。Googleアカウント自体は削除されません。続行しますか？"))return;
 const accountId=String(signedInUser.id);
 let revokeFailures=0;
 for(const [tripId,record] of Object.entries(shareRecords||{})){
  if(!record?.url)continue;
  if(!record.revokeKey){revokeFailures++;continue;}
  try{
   const token=new URL(record.url).searchParams.get("token");
   if(!token)continue;
   const response=await fetch(API_BASE+"/api/shares/"+encodeURIComponent(token),{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revokeKey:record.revokeKey})});
   if(!response.ok&&response.status!==404)revokeFailures++;
  }catch{revokeFailures++;}
 }
 if(revokeFailures){
  toast("共有リンクをすべて無効化できませんでした。通信を確認してから再度お試しください");
  return;
 }
 try{
  const response=await fetch(API_BASE+"/api/account",{method:"DELETE",headers:{authorization:"Bearer "+sessionToken,"content-type":"application/json"},body:JSON.stringify({confirmation:"DELETE"})});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||"アカウントを削除できませんでした");
  const mediaKeys=[...new Set([...posts.map(post=>post.mediaKey).filter(Boolean),profile.avatarMediaKey].filter(Boolean))];
  let localMediaFailures=0;
  for(const key of mediaKeys){try{await mediaDelete(key);}catch{localMediaFailures++;}}
  for(const key of Object.keys(LOCAL_STATE_DEFAULTS))localStorage.removeItem(accountStorageKey(accountId,key));
  localStorage.removeItem(accountStorageKey(accountId,"expense_sync_meta"));
  sessionStorage.removeItem(SESSION_KEY);
  sessionToken="";signedInUser=null;activeAccountStorageId=null;
  posts=[];trips=[];expenses=[];saved=[];following=[];blocked=[];
  profile={name:"旅好きユーザー",bio:"旅の記録を、少しずつ。"};shareRecords={};selectedTrip=null;
  renderAuth();renderAll();
  toast(localMediaFailures?"クラウドデータを削除しました。端末内メディアの一部は削除できませんでした":"旅ログのアカウントと保存データを削除しました。Googleアカウントは残っています");
 }catch(error){toast(error.message||"アカウント削除に失敗しました");}
});

function refreshExpenseTripSelect(selectedId=""){const select=$("#expenseTripSelect");const own=trips.filter(t=>t.isMine);select.innerHTML=own.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");if(selectedId&&own.some(t=>t.id===selectedId))select.value=selectedId;}
const openExpenseButton=$("#openExpense");if(openExpenseButton)openExpenseButton.onclick=()=>{const form=$("#expenseForm");if(!form)return;form.reset();form.elements.id.value="";refreshExpenseTripSelect(selectedTrip||"");if(!form.elements.tripId.options.length){toast("先に旅行を作成してください");return;}form.elements.date.value=new Date().toISOString().slice(0,10);openDialog("#expenseDialog");};
$("#expenseForm").addEventListener("submit",e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form),id=String(data.get("id")||""),tripId=String(data.get("tripId")||""),amount=Number(data.get("amount"));if(!trips.some(t=>t.id===tripId&&t.isMine)){toast("旅行を選択してください");return;}if(!Number.isSafeInteger(amount)||amount<0||amount>100000000){toast("金額を確認してください");return;}const item={id:id||uid(),tripId,date:String(data.get("date")||""),category:String(data.get("category")||"その他"),amount,currency:String(data.get("currency")||"JPY"),note:String(data.get("note")||"").trim()};if(!item.date){toast("日付を入力してください");return;}const index=expenses.findIndex(x=>x.id===id);if(index>=0)expenses[index]=item;else expenses.unshift(item);markExpenseSyncDirty(item.id);save();closeDialog("#expenseDialog");renderAll();toast(id?"支出を更新しました":"支出を記録しました");});
const expenseListElement=$("#expenseList");if(expenseListElement)expenseListElement.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const id=b.dataset.expenseEdit||b.dataset.expenseDelete,item=expenses.find(x=>x.id===id);if(!item)return;if(b.dataset.expenseEdit){const f=$("#expenseForm");refreshExpenseTripSelect(item.tripId);f.elements.id.value=item.id;f.elements.tripId.value=item.tripId;f.elements.date.value=item.date;f.elements.category.value=item.category;f.elements.amount.value=item.amount;f.elements.currency.value=item.currency||"JPY";f.elements.note.value=item.note||"";openDialog("#expenseDialog");return;}if(b.dataset.expenseDelete&&confirm("この支出を削除しますか？")){markExpenseSyncDeleted(id);expenses=expenses.filter(x=>x.id!==id);save();renderAll();toast("支出を削除しました");}});
$("#feed").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let p=posts.find(x=>x.id===b.dataset.like||x.id===b.dataset.save||x.id===b.dataset.comment||x.id===b.dataset.remix||x.id===b.dataset.report);if(b.dataset.follow){let n=b.dataset.follow;following=following.includes(n)?following.filter(x=>x!==n):[...following,n];save();renderAll();toast(following.includes(n)?"フォローしました":"フォローを解除しました");return}if(b.dataset.block){let n=b.dataset.block;if(confirm(n+"さんの投稿を非表示にしますか？")){blocked=[...new Set([...blocked,n])];save();renderAll();toast("投稿を非表示にしました")}return}if(!p)return;
if(b.dataset.like){p.liked=!p.liked;p.likes+=p.liked?1:-1;save();renderFeed()}
if(b.dataset.save){p.saved=!p.saved;saved=p.saved?[...new Set([...saved,p.id])]:saved.filter(x=>x!==p.id);save();renderAll();toast(p.saved?"保存しました":"保存を解除しました")}
if(b.dataset.comment){let c=prompt("コメントを入力（この端末内のテスト）");if(c?.trim()){p.comments=p.comments||[];p.comments.push({name:profile.name,body:c.trim(),date:new Date().toISOString()});save();renderFeed();toast("コメントを保存しました")}}
if(b.dataset.remix){let t=trips.find(x=>x.id===p.tripId);if(t){trips.unshift({...t,id:uid(),title:t.title+"（参考）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"})}else{trips.unshift({id:uid(),title:p.title+"を参考にした旅",area:p.place,description:"投稿を参考に作成",stops:[p.place],actual:[],isMine:true,owner:"me",visibility:"private"})}save();renderAll();toast("参考旅程を作成しました")}
if(b.dataset.report){let reason=prompt("通報理由を入力してください（テスト用）");if(reason?.trim())toast("通報内容をこの画面では送信せず、テスト記録として受け付けました")}
});
document.addEventListener("click",e=>{const card=e.target.closest?.(".ticket-card[data-open-ticket]");if(!card)return;e.preventDefault();openTravelTicket(card.dataset.openTicket);},true);
document.addEventListener("keydown",e=>{const card=e.target.closest?.(".ticket-card[data-open-ticket]");if(card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openTravelTicket(card.dataset.openTicket);}},true);
document.addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let t=trips.find(x=>x.id===b.dataset.selectTrip||x.id===b.dataset.ticketSelect||x.id===b.dataset.ticketEdit||x.id===b.dataset.ticketItinerary||x.id===b.dataset.editTrip||x.id===b.dataset.itinerary||x.id===b.dataset.addStop||x.id===b.dataset.copyTrip||x.id===b.dataset.archiveTrip||x.id===b.dataset.actual||x.id===b.dataset.actualPlaceTrip||x.id===b.dataset.deleteTrip||x.id===b.dataset.shareTrip||x.id===b.dataset.revokeShare);if(!t)return;
if(b.dataset.itinerary||b.dataset.ticketItinerary){openItinerary(t.id);return;}
if(b.dataset.selectTrip||b.dataset.ticketSelect){selectedTrip=t.id;renderMap();renderTrips();if(b.dataset.ticketSelect){closeTicketExperience();$("#mytrips").scrollIntoView({behavior:"smooth",block:"start"});}return;}
 if(b.dataset.editTrip||b.dataset.ticketEdit){const f=$("#tripEditForm");f.elements.id.value=t.id;f.elements.title.value=t.title||"";f.elements.area.value=t.area||"";f.elements.departurePlace.value=t.departurePlace||t.originCountry||"";f.elements.date.value=t.date||"";f.elements.endDate.value=t.endDate||"";f.elements.description.value=t.description||"";f.elements.budgetAmount.value=t.budgetAmount||"";f.elements.budgetCurrency.value=t.budgetCurrency||"JPY";f.elements.stops.value=(t.stops||[]).join(", ");f.elements.visibility.value=t.visibility||"private";openDialog("#tripEditDialog");return;}
if(b.dataset.addStop){let s=prompt("追加する立ち寄り先");if(s?.trim()){t.stops.push(s.trim());save();renderTrips();toast("行き先を追加しました")}}
if(b.dataset.archiveTrip){t.archived=!t.archived;save();renderTrips();toast(t.archived?"旅行をアーカイブしました":"旅行を一覧に戻しました");return;}
if(b.dataset.copyTrip){const copied={...t,id:uid(),title:t.title+"（コピー）",stops:[...(t.stops||[])],stopLocations:(t.stopLocations||[]).map(point=>({...point})),actual:[],dayPlans:(t.dayPlans||[]).map(day=>({...day,items:(day.items||[]).map(item=>({...item,visited:false}))})),isMine:true,owner:"me",source:"native",visibility:"private",archived:false};trips.unshift(copied);selectedTrip=copied.id;save();renderAll();toast("日程と訪問先を含む旅行を複製しました")}
if(b.dataset.actual||b.dataset.actualPlace){const place=String(b.dataset.actualPlace||prompt("実際に訪れた場所を入力",(t.stops||[]).find(x=>!(t.actual||[]).includes(x))||"")||"").trim();if(place){if(t.source==="aileron"&&!((t.stops||[]).includes(place)||(t.stopLocations||[]).some(p=>p.name===place))){toast("Aileronから取り込んだ訪問先を選択してください");return;}if(!Array.isArray(t.actual))t.actual=[];if(!t.actual.includes(place))t.actual.push(place);save();renderTrips();if(t.source==="aileron"&&signedInUser&&sessionToken){try{const response=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(t.id)+"/visited",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({name:place,visited:true})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"訪問状態を同期できませんでした");}catch(error){toast("端末内には記録しました。クラウド同期は再確認が必要です");return;}}toast("「"+place+"」を訪問済みにしました");}}
if(b.dataset.revokeShare){const record=shareRecords[t.id];if(record&&confirm("この共有URLを無効にしますか？")){try{const res=await fetch(API_BASE+"/api/shares/"+encodeURIComponent(new URL(record.url).searchParams.get("token")),{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revokeKey:record.revokeKey})});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有を停止できませんでした");delete shareRecords[t.id];save();renderTrips();toast("共有URLを無効にしました")}catch(err){toast(err.message||"共有停止に失敗しました")}}return}
if(b.dataset.shareTrip){
 if(!API_BASE){toast("共有APIはまだ未接続です。Cloudflare Workerの公開後に有効になります");return}
 const existing=shareRecords[t.id];
 if(existing){try{await navigator.clipboard.writeText(existing.url);toast("共有URLをコピーしました")}catch{prompt("共有URLをコピーしてください",existing.url)}return}
 const entries=posts.filter(p=>p.tripId===t.id&&p.author===profile.name&&p.visibility==="public").map(p=>({title:p.title,place:p.place,story:p.story,date:p.date}));
 if(!confirm("共有する内容を確認してください。旅行名・エリア・訪問先・訪問済み状態・公開設定の日記本文を共有します。写真、非公開の日記、正確な位置情報は含めません。共有URLを知っている人は閲覧できます。自宅・学校・現在地など個人の居場所が分かる内容は共有しないでください。発行しますか？"))return;
 const safeLocations=(t.stopLocations||[]).filter(point=>Number.isFinite(Number(point.latitude))&&Number.isFinite(Number(point.longitude))).map(point=>({...point,latitude:Math.round(Number(point.latitude)*10)/10,longitude:Math.round(Number(point.longitude)*10)/10}));
 const payload={trip:{title:t.title,area:t.area,date:t.date,description:t.description,tripType:t.tripType||"standard",relatedWork:t.relatedWork||"",stops:t.stops||[],visited:t.actual||[],locations:safeLocations,entries,author:profile.name}};
 try{const res=await fetch(API_BASE+"/api/shares",{method:"POST",headers:{"content-type":"application/json",...(sessionToken?{authorization:"Bearer "+sessionToken}:{})},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有リンクを作成できませんでした");shareRecords[t.id]={url:data.url,revokeKey:data.revokeKey,expiresAt:data.expiresAt};save();renderTrips();try{await navigator.clipboard.writeText(data.url);toast("共有URLを発行してコピーしました")}catch{prompt("共有URLを発行しました。コピーしてください",data.url)}}catch(err){toast(err.message||"共有URLの発行に失敗しました")}
}
 if(b.dataset.deleteTrip){
  if(!confirm("この旅程を削除しますか？\\n関連する日程・支出も削除されます。"))return;
  const tripId=t.id;
  try{
   clearTimeout(cloudSyncTimer);cloudSyncQueued=false;
   while(cloudSyncBusy)await new Promise(resolve=>setTimeout(resolve,80));
   clearTimeout(cloudSyncTimer);
   if(signedInUser&&sessionToken){
    if(!API_BASE)throw new Error("削除APIに接続できません。時間をおいて再読み込みしてください");
    const res=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(tripId),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});
    const data=await res.json();
    if(!res.ok||!data.ok||!data.deleted)throw new Error(data.error||"クラウド側の削除に失敗しました");
   }
   trips=trips.filter(x=>x.id!==tripId);
   expenses=expenses.filter(item=>item.tripId!==tripId);
   delete shareRecords[tripId];
   if(selectedTrip===tripId)selectedTrip=trips[0]?.id||null;
   save();closeTicketExperience();renderAll();toast("旅程を削除しました");
  }catch(error){toast(error.message||"旅程を削除できませんでした");}
  return;
 }
});

async function exportTabiLogBackup(){
 const button=$("#exportBackupButton");
 if(button)button.disabled=true;
 try{
  const state=currentLocalState();
  const photos={};
  const missingPhotos=[];
  const keys=[...new Set((state.posts||[]).map(post=>post.mediaKey).filter(Boolean))];
  for(const key of keys){
   const blob=await mediaGet(key);
   if(!blob){missingPhotos.push(key);continue;}
   const relatedPost=state.posts.find(post=>post.mediaKey===key);
   const type=String(blob.type||relatedPost?.mediaType||"").toLowerCase();
   const isVideo=type.startsWith("video/");
   const maxBytes=isVideo?20*1024*1024:5*1024*1024;
   if(blob.size>maxBytes)throw new Error(isVideo?"20MBを超える動画があるためバックアップを中止しました":"5MBを超える写真があるためバックアップを中止しました");
   if(!["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"].includes(type))throw new Error("対応していない形式の写真・動画があるためバックアップを中止しました");
   const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error||new Error("写真を読み込めませんでした"));
    reader.readAsDataURL(blob);
   });
   photos[key]={type,dataUrl};
  }
  if(missingPhotos.length)throw new Error("写真データが見つからない記録が"+missingPhotos.length+"件あります。不完全なバックアップを防ぐため保存を中止しました。元の端末で写真を確認してください");
  const backup={
   format:"tabi-log-backup",
   version:1,
   exportedAt:new Date().toISOString(),
   account:signedInUser?{name:signedInUser.name||"",id:signedInUser.id||""}:null,
   data:state,
   photos
  };
  const json=JSON.stringify(backup);
  const blob=new Blob([json],{type:"application/json"});
  if(blob.size>90*1024*1024)throw new Error("バックアップが90MBを超えています。写真を分けて保存する機能は未対応のため、写真の枚数を減らしてから再度お試しください");
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download="tabi-log-backup-"+new Date().toISOString().slice(0,10)+".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  toast("バックアップファイルを作成しました（写真・動画"+keys.length+"件を含む）。端末のダウンロード一覧で保存を確認してください");
 }catch(error){
  console.error("バックアップの作成に失敗:",error);
  toast(error.message||"バックアップを作成できませんでした。端末の空き容量を確認してください");
 }finally{
  if(button)button.disabled=false;
 }
}
$("#exportBackupButton")?.addEventListener("click",()=>{
 if(confirm("旅行・日記・支出・プロフィールと、端末内にある写真・動画をバックアップファイルに保存します。ファイルには個人情報が含まれるため、安全な場所で保管してください。続けますか？"))exportTabiLogBackup();
});

async function restoreTabiLogBackup(file){
  if(!file||file.size>90*1024*1024)throw new Error("バックアップファイルは90MB以下にしてください");
  const backup=JSON.parse(await file.text());
  if(backup?.format!=="tabi-log-backup"||backup.version!==1||!backup.data||typeof backup.data!=="object")throw new Error("旅ログのバックアップファイルではありません");
  if(signedInUser&&backup.account?.id!==String(signedInUser.id))throw new Error("別のGoogleアカウントのバックアップは復元できません。同じアカウントでログインしてください");
  if(!signedInUser&&backup.account)throw new Error("このバックアップはGoogleログイン中に作成されています。該当アカウントでログインしてください");
  const data=backup.data;
  for(const key of ["posts","trips","expenses","saved","following","blocked"])if(!Array.isArray(data[key]))throw new Error("バックアップのデータ形式が正しくありません");
  if(data.posts.some(item=>!item||typeof item!=="object"||Array.isArray(item)||typeof item.id!=="string")||data.trips.some(item=>!item||typeof item!=="object"||Array.isArray(item)||typeof item.id!=="string"))throw new Error("旅行または日記のデータが壊れています");
  if(!data.profile||typeof data.profile!=="object"||Array.isArray(data.profile))throw new Error("プロフィール情報を読み込めません");
  const photos=backup.photos&&typeof backup.photos==="object"&&!Array.isArray(backup.photos)?backup.photos:{};
  const invalidMediaPost=data.posts.find(post=>post.mediaKey&&typeof post.mediaKey!=="string");
  if(invalidMediaPost)throw new Error("日記のメディア参照情報が正しくありません");
  const mediaPosts=data.posts.filter(post=>post.mediaKey);
  const missingPhotoPosts=mediaPosts.filter(post=>!photos[post.mediaKey]||typeof photos[post.mediaKey].dataUrl!=="string");
  if(missingPhotoPosts.length)throw new Error("バックアップに写真・動画データが含まれていない日記が"+missingPhotoPosts.length+"件あります。写真・動画を含む完全なバックアップを選んでください");
  for(const post of mediaPosts){
    const record=photos[post.mediaKey];
    const match=record.dataUrl.match(/^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/]*={0,2})$/i);
    if(!match)throw new Error("写真・動画データの形式が正しくありません");
    const mime=match[1].toLowerCase();
    if(String(record.type||mime).toLowerCase()!==mime)throw new Error("メディアの形式情報が一致しません");
    if(match[2].length>Math.ceil((mime.startsWith("video/")?20:5)*1024*1024/3)*4)throw new Error(mime.startsWith("video/")?"20MBを超える動画が含まれています":"5MBを超える写真が含まれています");
  }
  const remappedPosts=data.posts.map(post=>({...post}));
  const restoredKeys=[];
  const stateKeys=Object.keys(currentLocalState());
  const previousStorage=new Map(stateKeys.map(key=>{const storageKey=activeAccountStorageId?accountStorageKey(activeAccountStorageId,key):"tabilog_"+key;return [storageKey,localStorage.getItem(storageKey)];}));
  const previousState=currentLocalState();
  try{
    for(const post of remappedPosts){
      const oldKey=post.mediaKey;
      if(!oldKey||!photos[oldKey]?.dataUrl)continue;
      const record=photos[oldKey];
      const match=record.dataUrl.match(/^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/]*={0,2})$/i);
      if(!match)throw new Error("写真データの形式が正しくありません");
      const mime=match[1].toLowerCase();
      if(String(record.type||mime).toLowerCase()!==mime)throw new Error("写真の形式情報が一致しません");
      const base64=match[2];
      const binary=atob(base64);
      if(binary.length>(mime.startsWith("video/")?20:5)*1024*1024)throw new Error(mime.startsWith("video/")?"20MBを超える動画が含まれています":"5MBを超える写真が含まれています");
      const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const blob=new Blob([bytes],{type:record.type||"image/jpeg"});
      const newKey="restore-"+uid();
      await mediaPut(newKey,blob);
      restoredKeys.push(newKey);
      post.mediaKey=newKey;
    }
    const restoredState={
      posts:remappedPosts,trips:data.trips,expenses:data.expenses,saved:data.saved,
      following:data.following,blocked:data.blocked,profile:data.profile,
      shares:data.shares&&typeof data.shares==="object"&&!Array.isArray(data.shares)?data.shares:{}
    };
    writeLocalState(restoredState);
    posts=restoredState.posts;trips=restoredState.trips;expenses=restoredState.expenses;
    saved=restoredState.saved;following=restoredState.following;blocked=restoredState.blocked;
    profile=restoredState.profile;shareRecords=restoredState.shares;
    selectedTrip=trips[0]?.id||null;
    renderAll();
    toast("バックアップをこの端末に復元しました。クラウド側のデータは変更していません");
  }catch(error){
    for(const [key,value] of previousStorage){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{}}
    posts=previousState.posts;trips=previousState.trips;expenses=previousState.expenses;saved=previousState.saved;
    following=previousState.following;blocked=previousState.blocked;profile=previousState.profile;shareRecords=previousState.shares;
    for(const key of restoredKeys)try{await mediaDelete(key)}catch{}
    throw error;
  }
}
$("#importBackupButton")?.addEventListener("click",()=>$("#importBackupFile")?.click());
$("#importBackupFile")?.addEventListener("change",async event=>{
 const file=event.currentTarget.files?.[0];
 if(!file)return;
 if(!confirm("現在の旅行・日記・支出・プロフィールをバックアップの内容で置き換えます。先に現在のデータもバックアップしてください。続けますか？")){event.currentTarget.value="";return;}
 const button=$("#importBackupButton");
 if(button)button.disabled=true;
 try{await restoreTabiLogBackup(file);}
 catch(error){console.error("バックアップの復元に失敗:",error);toast(error.message||"バックアップを復元できませんでした");}
 finally{if(button)button.disabled=false;event.currentTarget.value="";}
});


$("#feedSearch").addEventListener("input",renderFeed);$("#feedSort").addEventListener("change",e=>{feedSort=e.target.value;renderFeed()});$$(".chip").forEach(b=>b.addEventListener("click",()=>{$$(".chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");category=b.dataset.category;renderFeed()}));
renderAll();
if(new URLSearchParams(location.search).has("import")&&!sessionToken)toast("Aileronの旅行プランを取り込むには、Googleログインしてください。");
