const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB_NAME="tabiLogMedia", STORE="media";
function openMediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function mediaPut(key,blob){const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(blob,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function mediaGet(key){const db=await openMediaDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function mediaDelete(key){if(!key)return;const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function loadPostMedia(post){if(post?.mediaKey){const local=await mediaGet(post.mediaKey);if(local)return local;}if(!post?.driveFileId)return null;const response=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(post.driveFileId)+"?alt=media",{headers:{authorization:"Bearer "+await getDriveAccessToken()}});if(!response.ok)throw new Error("Google Driveの写真を読み込めませんでした。Google Driveを再連携してください");return response.blob();}
async function deleteDiaryEntry(p){if(p.driveFileId)await deleteDriveFile(p.driveFileId);if(signedInUser&&sessionToken){const res=await fetch(API_BASE+"/api/posts/"+encodeURIComponent(p.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"クラウド側の日記を削除できませんでした");}posts=posts.filter(x=>x.id!==p.id);await mediaDelete(p.mediaKey);save();}
const uid=()=>crypto.randomUUID();
const API_BASE=(window.TABI_LOG_API_BASE||"").replace(/\/$/,"");
const GOOGLE_CLIENT_ID=window.TABI_LOG_GOOGLE_CLIENT_ID||"";
let driveTokenClient=null,driveAccessToken="",driveTokenExpiresAt=0,driveRootFolderId="",driveTripFolders={};
const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.file";
function requestDriveToken(prompt=""){return new Promise((resolve,reject)=>{if(!window.google?.accounts?.oauth2){reject(new Error("Google Drive認証を読み込めません"));return;}driveTokenClient=window.google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:DRIVE_SCOPE,callback:response=>{if(response?.error){reject(new Error("Google Driveの認証に失敗しました: "+response.error));return;}driveAccessToken=response.access_token||"";driveTokenExpiresAt=Date.now()+Math.max(0,Number(response.expires_in||3600)-60)*1000;if(!driveAccessToken){reject(new Error("Google Driveの認証トークンを取得できません"));return;}resolve(driveAccessToken);},error_callback:error=>reject(new Error(error?.message||"Google Drive認証を完了できませんでした"))});driveTokenClient.requestAccessToken({prompt});});}
async function getDriveAccessToken(){if(driveAccessToken&&Date.now()<driveTokenExpiresAt)return driveAccessToken;return requestDriveToken("");}
async function driveApi(path,options={}){const token=await getDriveAccessToken();const response=await fetch("https://www.googleapis.com/drive/v3/"+path,{...options,headers:{authorization:"Bearer "+token,...(options.headers||{})}});if(!response.ok){let detail="";try{detail=(await response.json()).error?.message||"";}catch{}throw new Error(detail||"Google Drive APIエラー ("+response.status+")");}if(response.status===204)return null;return response.json();}
async function ensureDriveRootFolder(){if(driveRootFolderId)return driveRootFolderId;const q=encodeURIComponent("name='Tabi Log' and mimeType='application/vnd.google-apps.folder' and trashed=false");const found=await driveApi("files?q="+q+"&pageSize=20&fields=files(id,name)");driveRootFolderId=found.files?.[0]?.id||"";if(!driveRootFolderId){const created=await driveApi("files?fields=id",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Tabi Log",mimeType:"application/vnd.google-apps.folder"})});driveRootFolderId=created.id;}return driveRootFolderId;}
async function ensureDriveTripFolder(tripId){const key=tripId||"unassigned";if(driveTripFolders[key])return driveTripFolders[key];const root=await ensureDriveRootFolder();const trip=trips.find(t=>t.id===tripId);const folderName=(trip?.title||"旅行記録")+"_"+String(tripId||"unassigned").slice(0,8);const q=encodeURIComponent("name='"+folderName.replace(/'/g,"\\'")+"' and mimeType='application/vnd.google-apps.folder' and '"+root+"' in parents and trashed=false");const found=await driveApi("files?q="+q+"&pageSize=20&fields=files(id,name)");let id=found.files?.[0]?.id;if(!id){const created=await driveApi("files?fields=id",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:folderName,mimeType:"application/vnd.google-apps.folder",parents:[root]})});id=created.id;}driveTripFolders[key]=id;return id;}
async function uploadPhotoToDrive(post,blob){if(!blob||!["image/jpeg","image/png","image/webp"].includes(blob.type))throw new Error("Google Driveに保存できるのはJPEG・PNG・WebPの写真です");if(blob.size>5*1024*1024)throw new Error("写真は5MB以下にしてください");const folder=await ensureDriveTripFolder(post.tripId);const safeName=(post.title||"旅行の写真").replace(/[\\/:*?""<>|]/g,"_").slice(0,70);const created=await driveApi("files?fields=id",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:safeName+"_"+post.id.slice(0,8),mimeType:blob.type,parents:[folder]})});const fileId=created.id;try{const token=await getDriveAccessToken();const uploaded=await fetch("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(fileId)+"?uploadType=media",{method:"PATCH",headers:{authorization:"Bearer "+token,"content-type":blob.type},body:blob});if(!uploaded.ok)throw new Error("Google Driveへの写真アップロードに失敗しました");if(signedInUser&&sessionToken){const saved=await fetch(API_BASE+"/api/media/"+encodeURIComponent(post.id),{method:"PUT",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({fileId,mediaType:blob.type,size:blob.size})});const data=await saved.json();if(!saved.ok||!data.ok)throw new Error(data.error||"写真の保存情報を同期できませんでした");}return fileId;}catch(error){try{await driveApi("files/"+encodeURIComponent(fileId),{method:"DELETE"});}catch{}throw error;}}
async function deleteDriveFile(fileId){if(!fileId)return;const token=await getDriveAccessToken();const response=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(fileId),{method:"DELETE",headers:{authorization:"Bearer "+token}});if(!response.ok&&response.status!==404)throw new Error("Google Drive上の写真を削除できませんでした");}
async function connectGoogleDrive(){try{await requestDriveToken("consent");await ensureDriveRootFolder();toast("Google Driveと連携しました");if(signedInUser)await syncCloudData();renderAuth();}catch(error){toast(error.message||"Google Drive連携に失敗しました");}}
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
  status.innerHTML='<span class="auth-name">'+esc(signedInUser.name||"Googleユーザー")+'</span> <button type="button" class="auth-signout" id="driveConnect">Google Driveを連携</button> <button type="button" class="auth-signout" id="googleSignOut">ログアウト</button>';
  $("#driveConnect").onclick=connectGoogleDrive;
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
 try{
  const res=await fetch(API_BASE+"/api/me",{headers:{authorization:"Bearer "+sessionToken}});
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"セッションの期限が切れています");
  signedInUser=data.user;
  activateAccountStorage(signedInUser);
  await syncCloudData();
  await processPendingImport();
 }catch{
  sessionToken="";
  sessionStorage.removeItem(SESSION_KEY);
  signedInUser=null;
 }
 renderAuth();
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
  activateAccountStorage(signedInUser);
  renderAuth();
  await syncCloudData();
  await processPendingImport();
  toast("Googleログインしました");
 }catch(error){
  toast(error.message||"ログインに失敗しました");
 }
}
async function logoutFromApp(){
 if(driveAccessToken&&window.google?.accounts?.oauth2){try{window.google.accounts.oauth2.revoke(driveAccessToken,()=>{});}catch{}}
 driveAccessToken="";driveTokenExpiresAt=0;driveRootFolderId="";driveTripFolders={};
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
let cloudSyncTimer=null,cloudSyncBusy=false,cloudSyncHydrating=false,cloudSyncQueued=false,activeItineraryTripId=null;
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
function save(){
 writeLocalState(currentLocalState());
 if(signedInUser&&!cloudSyncHydrating){
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>syncCloudData(),1200);
 }
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
   id:t.id,title:t.title,area:t.area,date:t.start_date||"",endDate:t.end_date||"",
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
   visibility:p.visibility||"private",mediaKey:null,driveFileId:p.media_key||null,mediaType:p.media_type||"",cloudMediaSynced:Boolean(p.media_key),comments:[]
  }));
  const tripIds=new Set(trips.map(t=>t.id));
  for(const t of remoteTrips){
   const local=trips.find(item=>item.id===t.id);
   if(!local){trips.push(t);continue;}
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
  for(const p of remotePosts){const local=posts.find(item=>item.id===p.id);if(!local)posts.push(p);else if(p.mediaType){local.mediaType=p.mediaType;local.driveFileId=p.driveFileId||local.driveFileId||null;local.cloudMediaSynced=Boolean(local.driveFileId);}}
  // Signed-in cloud data is authoritative for expenses so deletions on another device do not reappear.
  const firstCloudSyncKey="tabilog_account_"+encodeURIComponent(String(signedInUser.id))+"_cloud_initialized";
  const isFirstCloudSync=localStorage.getItem(firstCloudSyncKey)!=="1";
  const mergedExpenses=isFirstCloudSync?[...remoteExpenses,...expenses.filter(local=>!remoteExpenses.some(remoteItem=>remoteItem.id===local.id)&&trips.some(t=>t.id===local.tripId&&t.source==="native"))]:remoteExpenses;
  expenses.splice(0,expenses.length,...mergedExpenses);
  if(!selectedTrip&&trips.length)selectedTrip=trips[0].id;
  writeLocalState(currentLocalState());
  cloudSyncHydrating=false;
  const payload={
   trips:trips.filter(t=>t.source==="native").slice(0,100).map(t=>({
    id:t.id,title:t.title,area:t.area,description:t.description||"",
    visibility:t.visibility||"private",start_date:t.date||"",end_date:t.endDate||"",
    budget_amount:Number(t.budgetAmount||0),budget_currency:t.budgetCurrency||"JPY",
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
  // Move device-local photos to the user's private Google Drive folder when connected.
  if(driveAccessToken){
   for(const post of posts){
    if(!post.mediaKey||post.cloudMediaSynced)continue;
    const blob=await mediaGet(post.mediaKey);
    if(!blob)continue;
    if(!["image/jpeg","image/png","image/webp"].includes(blob.type))continue;
    const previousDriveFileId=post.driveFileId||null;
    const newDriveFileId=await uploadPhotoToDrive(post,blob);
    post.driveFileId=newDriveFileId;
    post.mediaType=blob.type;
    post.cloudMediaSynced=true;
    if(previousDriveFileId&&previousDriveFileId!==newDriveFileId)await deleteDriveFile(previousDriveFileId);
   }
  }
  localStorage.setItem(firstCloudSyncKey,"1");
  writeLocalState(currentLocalState());
  renderAll();
  return true;
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
function renderTrips(){let own=trips.filter(t=>t.owner==="me"||t.source==="native"&&t.isMine);if(!own.length)own=trips.filter(t=>t.isMine);$("#tripTotal").textContent=own.length+"件";$("#tripCards").innerHTML=own.length?own.map(t=>{const places=[...new Set([...(Array.isArray(t.stopLocations)?t.stopLocations:[]).map(p=>p.name),...(Array.isArray(t.stops)?t.stops:[])].filter(Boolean))];const visited=Array.isArray(t.actual)?t.actual:[];return `<article class="trip-card ${selectedTrip===t.id?"selected":""}"><h3>${esc(t.title)}</h3><p>${esc(t.area)} · ${fmt(t.date)}${t.endDate?" – "+fmt(t.endDate):""}<br>${esc(t.description||"")}</p><div class="trip-meta"><span>予定 ${places.length}か所</span><span>訪問済み ${visited.length}か所</span><span>Aileron連携</span></div><div class="trip-tools"><button class="action" type="button" data-select-trip="${t.id}">地図と訪問先を見る</button><button class="action" type="button" data-share-trip="${t.id}">${shareRecords[t.id]?"共有リンクをコピー":"旅行を共有"}</button>${shareRecords[t.id]?`<button class="action" type="button" data-revoke-share="${t.id}">共有を停止</button>`:""}</div>${places.length?`<div class="trip-visit-list"><span class="trip-visit-label">訪問記録</span>${places.map(name=>`<button type="button" class="stop-pill ${visited.includes(name)?"is-visited":""}" data-actual-place="${esc(name)}" data-actual-place-trip="${t.id}" ${visited.includes(name)?"disabled":""}>${visited.includes(name)?"✓ ":"＋ "}${esc(name)}</button>`).join("")}</div>`:""}</article>`}).join(""):`<div class="empty-state">Aileronから旅行プランを取り込むと、ここに旅が表示されます。</div>`;renderMap();}
function renderItineraryItems(){
 const trip=trips.find(item=>item.id===activeItineraryTripId),host=$("#itineraryItems");
 if(!trip||!host){if(host)host.innerHTML='<div class="empty-state">旅行が見つかりません。</div>';return;}
 const days=[...(trip.dayPlans||[])].sort((a,b)=>a.date.localeCompare(b.date));
 const count=days.reduce((sum,day)=>sum+(day.items||[]).length,0);$("#itineraryCount").textContent=count+"件";
 host.innerHTML=days.length?days.map(day=>{
  const items=[...(day.items||[])].sort((a,b)=>(a.startTime||"99:99").localeCompare(b.startTime||"99:99")||a.sortOrder-b.sortOrder);
  return `<section class="itinerary-day"><h4>${esc(new Date(day.date+"T00:00:00").toLocaleDateString("ja-JP",{month:"long",day:"numeric",weekday:"short"}))}</h4>${items.map(item=>`<article class="itinerary-item ${item.visited?"is-visited":""}"><div class="itinerary-time">${esc(item.startTime||"時間未設定")}${item.endTime?" – "+esc(item.endTime):""}</div><div class="itinerary-item-main"><b>${esc(item.name)}</b><p>${esc(item.note||"メモなし")}</p><span>${item.visited?"訪問済み":"予定"}</span></div><div class="itinerary-item-actions"><button type="button" class="action" data-itin-toggle="${item.id}">${item.visited?"未訪問に戻す":"訪問済みにする"}</button><button type="button" class="action" data-itin-edit="${item.id}">編集</button><button type="button" class="action" data-itin-delete="${item.id}">削除</button></div></article>`).join("")}</section>`;
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
  const addPhoto=document.createElement("button");addPhoto.type="button";addPhoto.className="map-pin-add-photo";addPhoto.textContent="📷 この場所に写真を追加";
  addPhoto.addEventListener("click",()=>{
   selectedTrip=t.id;
   refreshTripSelect();
   const form=$("#postForm");
   form.elements.tripId.value=t.id;
   refreshPostPlaces(t.id);
   form.elements.place.value=p.name;
   form.elements.title.value=p.name+"の写真";
   form.elements.story.value="";
   routeLeafletMap.closePopup();
   openDialog("#postDialog");
  });
  popup.append(addPhoto);
  marker.bindPopup(popup);
  marker.on("popupopen",async()=>{
   photoBox.replaceChildren();
   for(const entry of diary){
    if(!entry.mediaKey&&!entry.mediaType)continue;
    try{const blob=await loadPostMedia(entry);if(!blob)continue;const item=document.createElement("div");item.className="map-pin-photo-item";const img=document.createElement(blob.type.startsWith("video/")?"video":"img");img.alt=entry.title||p.name;img.src=URL.createObjectURL(blob);if(img.tagName==="VIDEO"){img.controls=true;img.muted=true;img.playsInline=true;}item.append(img);const remove=document.createElement("button");remove.type="button";remove.className="map-pin-photo-delete";remove.textContent="写真を削除";remove.addEventListener("click",async()=>{if(!confirm("この写真を削除しますか？\nこの写真に紐づく日記も削除されます。"))return;remove.disabled=true;try{await deleteDiaryEntry(entry);renderAll();toast("✓ 写真を削除しました");}catch(error){remove.disabled=false;toast(error.message||"削除できませんでした");}});item.append(remove);photoBox.append(item);}catch{}
   }
  });
  const pill=document.createElement("button");pill.type="button";pill.className="stop-pill";pill.textContent=(visited?"✓ ":"")+p.name;
  pill.addEventListener("click",()=>{routeLeafletMap.setView(point,13);marker.openPopup();});
  if(list)list.append(pill);
 });
 if(valid.length>1)L.polyline(bounds,{color:"#c49a5e",weight:4,opacity:.85,dashArray:"7 7"}).addTo(routeMapLayer);
 routeLeafletMap.fitBounds(bounds,{padding:[28,28],maxZoom:12});
 setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),100);
 setTimeout(()=>routeLeafletMap?.invalidateSize({pan:false}),450);
}
window.addEventListener("resize",()=>{
 if(routeLeafletMap)setTimeout(()=>routeLeafletMap.invalidateSize({pan:false}),100);
});
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

function renderDiary(){let mine=posts.filter(p=>p.author===profile.name).sort((a,b)=>String(b.date).localeCompare(String(a.date)));$("#diaryTimeline").innerHTML=mine.length?mine.map(p=>`<div class="timeline-item"><div class="timeline-date">${esc(p.date||"今日")}</div><div class="timeline-line"></div><article class="timeline-card"><div class="timeline-thumb" id="diary-thumb-${p.id}">${p.mediaKey||p.mediaType?"📷":p.symbol||"📍"}</div><div class="timeline-content"><small>📍 ${esc(p.place)}</small><h3>${esc(p.title)}</h3><p>${esc(p.story)}</p><div class="timeline-actions"><button class="action" type="button" data-edit-diary="${p.id}">編集</button><button class="action" type="button" data-delete-diary="${p.id}">削除</button></div></div></article></div>`).join(""):`<div class="empty-state">ここに日記・思い出が時系列で並びます。「日記を追加」から記録できます。</div>`;mine.forEach(async p=>{if(!p.mediaKey&&!p.mediaType)return;try{const blob=await loadPostMedia(p);const thumb=$("#diary-thumb-"+p.id);if(blob&&thumb){const media=document.createElement(blob.type.startsWith("video/")?"video":"img");media.src=URL.createObjectURL(blob);media.alt=p.title||"旅行の思い出";if(media.tagName==="VIDEO"){media.controls=true;media.muted=true;media.playsInline=true;}thumb.replaceChildren(media);}}catch(error){console.warn("写真の読み込みに失敗:",error);}});}
function renderProfile(){let mine=posts.filter(p=>p.author===profile.name);$("#profileName").textContent=profile.name;$("#profileBio").textContent=profile.bio;$("#profileAvatar").textContent=(profile.name||"旅").slice(0,1);$("#profilePostCount").textContent=mine.length;$("#profileTripCount").textContent=trips.filter(t=>t.isMine).length;if($("#followingCount"))$("#followingCount").textContent=0;$("#statTrips").textContent=trips.filter(t=>t.isMine).length;$("#statPosts").textContent=mine.length;$("#statSaved").textContent=saved.length;}
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
function renderAll(){renderFeed();renderTrips();renderDiary();renderProfile();renderExpenses();renderCommunityFeed();}
function openDialog(id){$(id).showModal()}function closeDialog(id){$(id).close()}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog("#"+b.dataset.close)));
$("#closeSaveSuccess").addEventListener("click",()=>closeDialog("#saveSuccessDialog"));
$("#openTrip").onclick=()=>location.assign("https://aileron-japan-travel.pages.dev/");$("#newTrip2").onclick=()=>location.assign("https://aileron-japan-travel.pages.dev/");$("#heroTrip").onclick=()=>location.assign("https://aileron-japan-travel.pages.dev/");$("#openPost").onclick=()=>{refreshTripSelect();openDialog("#postDialog")};
function refreshPostPlaces(tripId){
 const trip=trips.find(t=>t.id===tripId),host=$("#postPlaceOptions");if(!host)return;
 const places=[...new Set([...(trip?.stops||[]),...(trip?.stopLocations||[]).map(p=>p.name).filter(Boolean)])];
 host.innerHTML=places.map(name=>'<option value="'+esc(name)+'"></option>').join("");
}
function refreshTripSelect(){$("#postTripSelect").innerHTML='<option value="">旅程に紐づけない</option>'+trips.filter(t=>t.isMine).map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");refreshPostPlaces($("#postTripSelect").value);}
$("#postTripSelect").addEventListener("change",e=>refreshPostPlaces(e.target.value));
$("#tripForm").addEventListener("submit",e=>{e.preventDefault();let f=new FormData(e.currentTarget),startDate=String(f.get("date")||""),endDate=String(f.get("endDate")||"");if(startDate&&endDate&&endDate<startDate){toast("終了日は開始日以降にしてください");return;}let stops=String(f.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean),t={id:uid(),title:f.get("title"),area:f.get("area"),date:startDate,endDate,description:f.get("description"),visibility:f.get("visibility")||"private",budgetAmount:Number(f.get("budgetAmount")||0),budgetCurrency:String(f.get("budgetCurrency")||"JPY"),stops,actual:[],dayPlans:[],isMine:true,owner:"me",source:"native"};trips.unshift(t);selectedTrip=t.id;save();e.currentTarget.reset();closeDialog("#tripDialog");renderAll();toast("旅程を作成しました");});
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
 const item={id:itemId||uid(),name,startTime,endTime,note:String(data.get("note")||"").trim(),visited:Boolean(previousItem?.visited),sortOrder:previousItem?.sortOrder??day.items.length};
 if(itemId&&previousItem){const index=day.items.findIndex(entry=>entry.id===itemId);if(index>=0)day.items[index]=item;else day.items.push(item);}else day.items.push(item);
 trip.dayPlans=trip.dayPlans.filter(entry=>entry.items.length);save();
 form.elements.itemId.value="";form.elements.name.value="";form.elements.startTime.value="";form.elements.endTime.value="";form.elements.note.value="";
 $("#itinerarySaveButton").textContent="予定を追加";renderItineraryItems();renderTrips();toast(itemId?"予定を更新しました":"予定を追加しました");
});
$("#itineraryItems").addEventListener("click",e=>{
 const button=e.target.closest("button");if(!button)return;
 const trip=trips.find(item=>item.id===activeItineraryTripId);if(!trip)return;
 const action=button.dataset.itinToggle||button.dataset.itinEdit||button.dataset.itinDelete;if(!action)return;
 const day=trip.dayPlans.find(entry=>entry.items.some(item=>item.id===action));if(!day)return;
 const index=day.items.findIndex(item=>item.id===action),item=day.items[index];
 if(button.dataset.itinToggle){item.visited=!item.visited;save();renderItineraryItems();toast(item.visited?"訪問済みにしました":"未訪問に戻しました");return;}
 if(button.dataset.itinEdit){const form=$("#itineraryForm");form.elements.tripId.value=trip.id;form.elements.itemId.value=item.id;form.elements.dayDate.value=day.date;form.elements.name.value=item.name;form.elements.startTime.value=item.startTime||"";form.elements.endTime.value=item.endTime||"";form.elements.note.value=item.note||"";$("#itinerarySaveButton").textContent="変更を保存";form.elements.name.focus();return;}
 if(button.dataset.itinDelete&&confirm("この予定を削除しますか？")){day.items.splice(index,1);trip.dayPlans=trip.dayPlans.filter(entry=>entry.items.length);save();renderItineraryItems();renderTrips();toast("予定を削除しました");}
});
$("#tripEditForm").addEventListener("submit",e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,t=trips.find(x=>x.id===id);if(!t){toast("編集する旅行が見つかりません");return;}const data=new FormData(f);t.title=String(data.get("title")||"").trim();t.area=String(data.get("area")||"").trim();t.date=String(data.get("date")||"");t.endDate=String(data.get("endDate")||"");if(t.date&&t.endDate&&t.endDate<t.date){toast("終了日は開始日以降にしてください");return;}t.description=String(data.get("description")||"");t.budgetAmount=Number(data.get("budgetAmount")||0);t.budgetCurrency=String(data.get("budgetCurrency")||"JPY");t.stops=String(data.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean);t.visibility=String(data.get("visibility")||"private");save();closeDialog("#tripEditDialog");renderAll();toast("旅行を更新しました");});
$("#postForm").addEventListener("submit",async e=>{e.preventDefault();let f=new FormData(e.currentTarget);if(f.get("visibility")==="public"&&(!signedInUser||!sessionToken)){toast("公開するにはGoogleログインしてください");return;}let file=f.get("mediaLibrary");if(!file||!file.size)file=f.get("mediaCamera");if(file&&file.size){const allowedTypes=["image/jpeg","image/png","image/webp"];if(!allowedTypes.includes(file.type)){toast("保存できる形式はJPEG・PNG・WebPです");return}if(file.size>5*1024*1024){toast("写真1枚の上限は5MBです");return}}
const linkedTripId=String(f.get("tripId")||"");const postId=uid();let p={id:postId,title:f.get("title"),place:f.get("place"),story:f.get("story"),author:profile.name,date:f.get("capturedAt")||new Date().toISOString(),category:f.get("category"),visual:"v4",symbol:"📷",likes:0,liked:false,saved:false,visibility:f.get("visibility"),tripId:linkedTripId,mediaKey:file&&file.size?postId:null,driveFileId:null,mediaType:file&&file.size?file.type:"",cloudMediaSynced:false,approxLocation:false,comments:[]};if(file&&file.size){try{await mediaPut(postId,file)}catch{toast("端末内への写真・動画保存に失敗しました");return}}
posts.unshift(p);if(linkedTripId){const linkedTrip=trips.find(x=>x.id===linkedTripId);if(linkedTrip){if(!Array.isArray(linkedTrip.actual))linkedTrip.actual=[];if(p.place&&!linkedTrip.actual.includes(p.place))linkedTrip.actual.push(p.place);selectedTrip=linkedTripId;}}save();e.currentTarget.reset();closeDialog("#postDialog");renderAll();
let cloudSaved=false;if(signedInUser&&sessionToken){clearTimeout(cloudSyncTimer);cloudSaved=await syncCloudData();if(!cloudSaved)toast("端末には保存しましたが、クラウド同期は未完了です。ログイン状態と通信を確認してください");}
if(file&&file.size){$("#saveSuccessTitle").textContent="写真を保存しました";$("#saveSuccessMessage").textContent=p.driveFileId?"Google Driveにも保存しました。同じGoogleアカウントで別端末から確認できます。":"日記はクラウドに保存しました。写真を別端末でも見るには、Google Drive連携が必要です。";$("#saveSuccessDialog").showModal();}else{toast("✓ 日記を保存しました");}});
$("#diaryEditForm").addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,p=posts.find(x=>x.id===id&&x.author===profile.name);if(!p){toast("編集する日記が見つかりません");return;}const data=new FormData(f),file=data.get("mediaReplace");if(file&&file.size){const allowed=["image/jpeg","image/png","image/webp"];if(!allowed.includes(file.type)){toast("保存できる形式はJPEG・PNG・WebPです");return;}if(file.size>5*1024*1024){toast("写真1枚の上限は5MBです");return;}try{await mediaPut(p.id,file);p.mediaKey=p.id;p.mediaType=file.type;p.cloudMediaSynced=false;}catch{toast("端末内への保存に失敗しました");return;}}p.title=String(data.get("title")||"").trim();p.place=String(data.get("place")||"").trim();p.story=String(data.get("story")||"").trim();p.date=String(data.get("capturedAt")||"");p.visibility=String(data.get("visibility")||"private");save();closeDialog("#diaryEditDialog");renderAll();let synced=true;if(signedInUser&&sessionToken){clearTimeout(cloudSyncTimer);synced=await syncCloudData();}toast(file&&file.size?(synced?"写真・動画を更新しました":"端末には保存しました。クラウド同期は未完了です"):"日記を更新しました");});
$("#diaryTimeline").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;const id=b.dataset.editDiary||b.dataset.deleteDiary;if(!id)return;const p=posts.find(x=>x.id===id&&x.author===profile.name);if(!p)return;if(b.dataset.editDiary){const f=$("#diaryEditForm");f.elements.id.value=p.id;f.elements.title.value=p.title||"";f.elements.place.value=p.place||"";f.elements.capturedAt.value=String(p.date||"").slice(0,16);f.elements.story.value=p.story||"";f.elements.visibility.value=p.visibility||"private";openDialog("#diaryEditDialog");return;}if(b.dataset.deleteDiary&&confirm(p.mediaKey?"この日記と写真を削除しますか？":"この日記を削除しますか？")){try{await deleteDiaryEntry(p);renderAll();toast(p.mediaKey?"✓ 写真と日記を削除しました":"✓ 日記を削除しました");}catch(err){toast(err.message||"削除に失敗しました");}}});

$("#editProfile").onclick=()=>{let f=$("#profileForm");f.elements.name.value=profile.name;f.elements.bio.value=profile.bio;openDialog("#profileDialog")};
$("#profileForm").addEventListener("submit",e=>{e.preventDefault();let f=new FormData(e.currentTarget),old=profile.name;profile={name:f.get("name"),bio:f.get("bio")};posts.forEach(p=>{if(p.author===old)p.author=profile.name});save();closeDialog("#profileDialog");renderAll();toast("プロフィールを更新しました")});
$("#privacySettings").onclick=()=>openDialog("#privacyDialog");
function refreshExpenseTripSelect(selectedId=""){const select=$("#expenseTripSelect");const own=trips.filter(t=>t.isMine);select.innerHTML=own.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");if(selectedId&&own.some(t=>t.id===selectedId))select.value=selectedId;}
$("#openExpense").onclick=()=>{const form=$("#expenseForm");form.reset();form.elements.id.value="";refreshExpenseTripSelect(selectedTrip||"");if(!form.elements.tripId.options.length){toast("先に旅行を作成してください");return;}form.elements.date.value=new Date().toISOString().slice(0,10);openDialog("#expenseDialog");};
$("#expenseForm").addEventListener("submit",e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form),id=String(data.get("id")||""),tripId=String(data.get("tripId")||""),amount=Number(data.get("amount"));if(!trips.some(t=>t.id===tripId&&t.isMine)){toast("旅行を選択してください");return;}if(!Number.isSafeInteger(amount)||amount<0||amount>100000000){toast("金額を確認してください");return;}const item={id:id||uid(),tripId,date:String(data.get("date")||""),category:String(data.get("category")||"その他"),amount,currency:String(data.get("currency")||"JPY"),note:String(data.get("note")||"").trim()};if(!item.date){toast("日付を入力してください");return;}const index=expenses.findIndex(x=>x.id===id);if(index>=0)expenses[index]=item;else expenses.unshift(item);save();closeDialog("#expenseDialog");renderAll();toast(id?"支出を更新しました":"支出を記録しました");});
$("#expenseList").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const id=b.dataset.expenseEdit||b.dataset.expenseDelete,item=expenses.find(x=>x.id===id);if(!item)return;if(b.dataset.expenseEdit){const f=$("#expenseForm");refreshExpenseTripSelect(item.tripId);f.elements.id.value=item.id;f.elements.tripId.value=item.tripId;f.elements.date.value=item.date;f.elements.category.value=item.category;f.elements.amount.value=item.amount;f.elements.currency.value=item.currency||"JPY";f.elements.note.value=item.note||"";openDialog("#expenseDialog");return;}if(b.dataset.expenseDelete&&confirm("この支出を削除しますか？")){expenses=expenses.filter(x=>x.id!==id);save();renderAll();toast("支出を削除しました");}});
$("#feed").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let p=posts.find(x=>x.id===b.dataset.like||x.id===b.dataset.save||x.id===b.dataset.comment||x.id===b.dataset.remix||x.id===b.dataset.report);if(b.dataset.follow){let n=b.dataset.follow;following=following.includes(n)?following.filter(x=>x!==n):[...following,n];save();renderAll();toast(following.includes(n)?"フォローしました":"フォローを解除しました");return}if(b.dataset.block){let n=b.dataset.block;if(confirm(n+"さんの投稿を非表示にしますか？")){blocked=[...new Set([...blocked,n])];save();renderAll();toast("投稿を非表示にしました")}return}if(!p)return;
if(b.dataset.like){p.liked=!p.liked;p.likes+=p.liked?1:-1;save();renderFeed()}
if(b.dataset.save){p.saved=!p.saved;saved=p.saved?[...new Set([...saved,p.id])]:saved.filter(x=>x!==p.id);save();renderAll();toast(p.saved?"保存しました":"保存を解除しました")}
if(b.dataset.comment){let c=prompt("コメントを入力（この端末内のテスト）");if(c?.trim()){p.comments=p.comments||[];p.comments.push({name:profile.name,body:c.trim(),date:new Date().toISOString()});save();renderFeed();toast("コメントを保存しました")}}
if(b.dataset.remix){let t=trips.find(x=>x.id===p.tripId);if(t){trips.unshift({...t,id:uid(),title:t.title+"（参考）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"})}else{trips.unshift({id:uid(),title:p.title+"を参考にした旅",area:p.place,description:"投稿を参考に作成",stops:[p.place],actual:[],isMine:true,owner:"me",visibility:"private"})}save();renderAll();toast("参考旅程を作成しました")}
if(b.dataset.report){let reason=prompt("通報理由を入力してください（テスト用）");if(reason?.trim())toast("通報内容をこの画面では送信せず、テスト記録として受け付けました")}
});
$("#tripCards").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let t=trips.find(x=>x.id===b.dataset.selectTrip||x.id===b.dataset.editTrip||x.id===b.dataset.itinerary||x.id===b.dataset.addStop||x.id===b.dataset.copyTrip||x.id===b.dataset.actual||x.id===b.dataset.actualPlaceTrip||x.id===b.dataset.deleteTrip||x.id===b.dataset.shareTrip||x.id===b.dataset.revokeShare);if(!t)return;
if(b.dataset.itinerary){openItinerary(t.id);return;}
if(b.dataset.selectTrip){selectedTrip=t.id;renderTrips()}
 if(b.dataset.editTrip){const f=$("#tripEditForm");f.elements.id.value=t.id;f.elements.title.value=t.title||"";f.elements.area.value=t.area||"";f.elements.date.value=t.date||"";f.elements.endDate.value=t.endDate||"";f.elements.description.value=t.description||"";f.elements.budgetAmount.value=t.budgetAmount||"";f.elements.budgetCurrency.value=t.budgetCurrency||"JPY";f.elements.stops.value=(t.stops||[]).join(", ");f.elements.visibility.value=t.visibility||"private";openDialog("#tripEditDialog");return;}
if(b.dataset.addStop){let s=prompt("追加する立ち寄り先");if(s?.trim()){t.stops.push(s.trim());save();renderTrips();toast("行き先を追加しました")}}
if(b.dataset.copyTrip){trips.unshift({...t,id:uid(),title:t.title+"（コピー）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"});save();renderAll();toast("旅程をコピーしました")}
if(b.dataset.actual||b.dataset.actualPlace){const place=String(b.dataset.actualPlace||prompt("実際に訪れた場所を入力",(t.stops||[]).find(x=>!(t.actual||[]).includes(x))||"")||"").trim();if(place){if(t.source==="aileron"&&!((t.stops||[]).includes(place)||(t.stopLocations||[]).some(p=>p.name===place))){toast("Aileronから取り込んだ訪問先を選択してください");return;}if(!Array.isArray(t.actual))t.actual=[];if(!t.actual.includes(place))t.actual.push(place);save();renderTrips();if(t.source==="aileron"&&signedInUser&&sessionToken){try{const response=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(t.id)+"/visited",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({name:place,visited:true})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"訪問状態を同期できませんでした");}catch(error){toast("端末内には記録しました。クラウド同期は再確認が必要です");return;}}toast("「"+place+"」を訪問済みにしました");}}
if(b.dataset.revokeShare){const record=shareRecords[t.id];if(record&&confirm("この共有URLを無効にしますか？")){try{const res=await fetch(API_BASE+"/api/shares/"+encodeURIComponent(new URL(record.url).searchParams.get("token")),{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revokeKey:record.revokeKey})});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有を停止できませんでした");delete shareRecords[t.id];save();renderTrips();toast("共有URLを無効にしました")}catch(err){toast(err.message||"共有停止に失敗しました")}}return}
if(b.dataset.shareTrip){
 if(!API_BASE){toast("共有APIはまだ未接続です。Cloudflare Workerの公開後に有効になります");return}
 const existing=shareRecords[t.id];
 if(existing){try{await navigator.clipboard.writeText(existing.url);toast("共有URLをコピーしました")}catch{prompt("共有URLをコピーしてください",existing.url)}return}
 const entries=posts.filter(p=>p.tripId===t.id&&p.author===profile.name&&p.visibility==="public").map(p=>({title:p.title,place:p.place,story:p.story,date:p.date}));
 const payload={trip:{title:t.title,area:t.area,date:t.date,description:t.description,stops:t.stops||[],visited:t.actual||[],locations:t.stopLocations||[],entries,author:profile.name}};
 try{const res=await fetch(API_BASE+"/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有リンクを作成できませんでした");shareRecords[t.id]={url:data.url,revokeKey:data.revokeKey,expiresAt:data.expiresAt};save();renderTrips();try{await navigator.clipboard.writeText(data.url);toast("共有URLを発行してコピーしました")}catch{prompt("共有URLを発行しました。コピーしてください",data.url)}}catch(err){toast(err.message||"共有URLの発行に失敗しました")}
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
   save();renderAll();toast("旅程を削除しました");
  }catch(error){toast(error.message||"旅程を削除できませんでした");}
  return;
 }
});
$("#feedSearch").addEventListener("input",renderFeed);$("#feedSort").addEventListener("change",e=>{feedSort=e.target.value;renderFeed()});$$(".chip").forEach(b=>b.addEventListener("click",()=>{$$(".chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");category=b.dataset.category;renderFeed()}));
renderAll();
if(new URLSearchParams(location.search).has("import")&&!sessionToken)toast("Aileronの旅行プランを取り込むには、Googleログインしてください。");
