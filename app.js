const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB_NAME="tabiLogMedia", STORE="media";
function openMediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function mediaPut(key,blob){const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(blob,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function mediaGet(key){const db=await openMediaDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function mediaDelete(key){if(!key)return;const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
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
 try{
  const res=await fetch(API_BASE+"/api/me",{headers:{authorization:"Bearer "+sessionToken}});
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"セッションの期限が切れています");
  signedInUser=data.user;
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
function save(){
 for(const [k,v] of Object.entries({posts,trips,expenses,saved,following,blocked,profile,shares:shareRecords}))localStorage.setItem("tabilog_"+k,JSON.stringify(v));
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
   visibility:p.visibility||"private",mediaKey:null,comments:[]
  }));
  const tripIds=new Set(trips.map(t=>t.id));
  for(const t of remoteTrips){const local=trips.find(item=>item.id===t.id);if(!local)trips.push(t);else if((!Array.isArray(local.dayPlans)||!local.dayPlans.length)&&t.dayPlans?.length)local.dayPlans=t.dayPlans;}
  const postIds=new Set(posts.map(p=>p.id));
  for(const p of remotePosts)if(!postIds.has(p.id))posts.push(p);
  // Signed-in cloud data is authoritative for expenses so deletions on another device do not reappear.
  expenses.splice(0,expenses.length,...remoteExpenses);
  if(!selectedTrip&&trips.length)selectedTrip=trips[0].id;
  for(const [k,v] of Object.entries({posts,trips,expenses}))localStorage.setItem("tabilog_"+k,JSON.stringify(v));
  cloudSyncHydrating=false;
  const payload={
   trips:trips.filter(t=>t.source==="native").slice(0,100).map(t=>({
    id:t.id,title:t.title,area:t.area,description:t.description||"",
    visibility:t.visibility||"private",start_date:t.date||"",end_date:t.endDate||"",
    budget_amount:Number(t.budgetAmount||0),budget_currency:t.budgetCurrency||"JPY",
    stops:Array.isArray(t.stops)?t.stops:[],actual:Array.isArray(t.actual)?t.actual:[],
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
  renderAll();
 }catch(error){
  console.warn("旅ログのクラウド同期に失敗:",error);
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
list.forEach(async p=>{if(p.mediaKey){try{let blob=await mediaGet(p.mediaKey);if(blob){let url=URL.createObjectURL(blob);mediaUrls[p.id]=url;let el=$("#visual-"+p.id);if(el){el.querySelector(".symbol")?.remove();let m=document.createElement(blob.type.startsWith("video/")?"video":"img");m.src=url;if(m.tagName==="VIDEO"){m.controls=true;m.muted=true}el.prepend(m);}}}catch{}}});
}
function renderTrips(){let own=trips.filter(t=>t.owner==="me"||t.source==="native"&&t.isMine);if(!own.length)own=trips.filter(t=>t.isMine);$("#tripTotal").textContent=own.length+"件";$("#tripCards").innerHTML=own.length?own.map(t=>`<article class="trip-card ${selectedTrip===t.id?"selected":""}"><h3>${esc(t.title)}</h3><p>${esc(t.area)} · ${fmt(t.date)}<br>${esc(t.description||"")}</p><div class="trip-meta"><span>予定 ${t.stops?.length||0}か所</span><span>実際 ${t.actual?.length||0}か所</span><span>${t.visibility==="public"?"公開":"非公開"}</span></div><div class="trip-tools"><button class="action" data-select-trip="${t.id}">ルートを見る</button><button class="action" data-edit-trip="${t.id}">編集</button><button class="action" data-itinerary="${t.id}">日程を管理</button><button class="action" data-add-stop="${t.id}">＋ 行き先</button><button class="action" data-copy-trip="${t.id}">コピー</button><button class="action" data-actual="${t.id}">実際に訪問</button><button class="action" data-share-trip="${t.id}">${shareRecords[t.id]?"共有リンクをコピー":"共有URLを発行"}</button>${shareRecords[t.id]?`<button class="action" data-revoke-share="${t.id}">共有を停止</button>`:""}<button class="action" data-delete-trip="${t.id}">削除</button></div></article>`).join(""):`<div class="empty-state">まだ旅程がありません。最初の旅をつくってみよう。</div>`;renderMap();}
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
  return p?.name&&Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lon)&&lon>=-180&&lon<=180;
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
    if(!entry.mediaKey)continue;
    try{const blob=await mediaGet(entry.mediaKey);if(!blob)continue;const img=document.createElement("img");img.alt=entry.title||p.name;img.src=URL.createObjectURL(blob);photoBox.append(img);}catch{}
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

function renderDiary(){let mine=posts.filter(p=>p.author===profile.name).sort((a,b)=>String(b.date).localeCompare(String(a.date)));$("#diaryTimeline").innerHTML=mine.length?mine.map(p=>`<div class="timeline-item"><div class="timeline-date">${esc(p.date||"今日")}</div><div class="timeline-line"></div><article class="timeline-card"><div class="timeline-thumb" id="diary-thumb-${p.id}">${p.mediaKey?"📷":p.symbol||"📍"}</div><div class="timeline-content"><small>📍 ${esc(p.place)}</small><h3>${esc(p.title)}</h3><p>${esc(p.story)}</p><div class="timeline-actions"><button class="action" type="button" data-edit-diary="${p.id}">編集</button><button class="action" type="button" data-delete-diary="${p.id}">削除</button></div></div></article></div>`).join(""):`<div class="empty-state">ここに日記・思い出が時系列で並びます。「日記を追加」から記録できます。</div>`;mine.forEach(async p=>{if(!p.mediaKey)return;try{const blob=await mediaGet(p.mediaKey);const thumb=$("#diary-thumb-"+p.id);if(blob&&thumb){const img=document.createElement("img");img.src=URL.createObjectURL(blob);img.alt=p.title||"旅行の写真";thumb.replaceChildren(img);}}catch(error){console.warn("写真の読み込みに失敗:",error);}});}
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
function renderAll(){renderFeed();renderTrips();renderDiary();renderProfile();renderExpenses();}
function openDialog(id){$(id).showModal()}function closeDialog(id){$(id).close()}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog("#"+b.dataset.close)));
$("#openTrip").onclick=()=>location.href="https://tabi-hikaku.pages.dev/";$("#newTrip2").onclick=()=>location.href="https://tabi-hikaku.pages.dev/";$("#heroTrip").onclick=()=>location.href="https://tabi-hikaku.pages.dev/";$("#openPost").onclick=()=>{refreshTripSelect();openDialog("#postDialog")};
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
$("#postForm").addEventListener("submit",async e=>{e.preventDefault();let f=new FormData(e.currentTarget),file=f.get("media"),mediaKey=null;if(file&&file.size){if(!["image/jpeg","image/png","image/webp"].includes(file.type)){toast("保存できるのはJPEG・PNG・WebPの写真のみです");return}if(file.size>5*1024*1024){toast("写真1枚の上限は5MBです");return}mediaKey=uid();try{await mediaPut(mediaKey,file)}catch{toast("写真の保存に失敗しました");return}}
let p={id:uid(),title:f.get("title"),place:f.get("place"),story:f.get("story"),author:profile.name,date:f.get("capturedAt")||new Date().toISOString(),category:f.get("category"),visual:"v4",symbol:file&&file.type.startsWith("video/")?"▶":"📷",likes:0,liked:false,saved:false,visibility:f.get("visibility"),tripId:f.get("tripId"),mediaKey,approxLocation:f.get("approxLocation")==="on",comments:[]};posts.unshift(p);if(p.tripId){let t=trips.find(x=>x.id===p.tripId);if(t&&!t.actual.includes(p.place))t.actual.push(p.place)}save();e.currentTarget.reset();closeDialog("#postDialog");renderAll();toast("日記・思い出を保存しました");});
$("#diaryEditForm").addEventListener("submit",e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,p=posts.find(x=>x.id===id&&x.author===profile.name);if(!p){toast("編集する日記が見つかりません");return;}const data=new FormData(f);p.title=String(data.get("title")||"").trim();p.place=String(data.get("place")||"").trim();p.story=String(data.get("story")||"").trim();p.date=String(data.get("capturedAt")||"");p.visibility=String(data.get("visibility")||"private");save();closeDialog("#diaryEditDialog");renderAll();toast("日記を更新しました");});
$("#diaryTimeline").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;const id=b.dataset.editDiary||b.dataset.deleteDiary;if(!id)return;const p=posts.find(x=>x.id===id&&x.author===profile.name);if(!p)return;if(b.dataset.editDiary){const f=$("#diaryEditForm");f.elements.id.value=p.id;f.elements.title.value=p.title||"";f.elements.place.value=p.place||"";f.elements.capturedAt.value=String(p.date||"").slice(0,16);f.elements.story.value=p.story||"";f.elements.visibility.value=p.visibility||"private";openDialog("#diaryEditDialog");return;}if(b.dataset.deleteDiary&&confirm("この日記を削除しますか？")){if(signedInUser&&sessionToken){try{const res=await fetch(API_BASE+"/api/posts/"+encodeURIComponent(p.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"クラウド側の日記を削除できませんでした");}catch(err){toast(err.message||"削除に失敗しました");return;}}posts=posts.filter(x=>x.id!==p.id);try{await mediaDelete(p.mediaKey);}catch{}save();renderAll();toast("日記を削除しました");}});

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
$("#tripCards").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let t=trips.find(x=>x.id===b.dataset.selectTrip||x.id===b.dataset.editTrip||x.id===b.dataset.itinerary||x.id===b.dataset.addStop||x.id===b.dataset.copyTrip||x.id===b.dataset.actual||x.id===b.dataset.deleteTrip||x.id===b.dataset.shareTrip||x.id===b.dataset.revokeShare);if(!t)return;
if(b.dataset.itinerary){openItinerary(t.id);return;}
if(b.dataset.selectTrip){selectedTrip=t.id;renderTrips()}
 if(b.dataset.editTrip){const f=$("#tripEditForm");f.elements.id.value=t.id;f.elements.title.value=t.title||"";f.elements.area.value=t.area||"";f.elements.date.value=t.date||"";f.elements.endDate.value=t.endDate||"";f.elements.description.value=t.description||"";f.elements.budgetAmount.value=t.budgetAmount||"";f.elements.budgetCurrency.value=t.budgetCurrency||"JPY";f.elements.stops.value=(t.stops||[]).join(", ");f.elements.visibility.value=t.visibility||"private";openDialog("#tripEditDialog");return;}
if(b.dataset.addStop){let s=prompt("追加する立ち寄り先");if(s?.trim()){t.stops.push(s.trim());save();renderTrips();toast("行き先を追加しました")}}
if(b.dataset.copyTrip){trips.unshift({...t,id:uid(),title:t.title+"（コピー）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"});save();renderAll();toast("旅程をコピーしました")}
if(b.dataset.actual){let s=prompt("実際に訪れた場所を入力",t.stops.find(x=>!t.actual.includes(x))||"");if(s?.trim()){const place=s.trim();if(t.source==="aileron"&&!t.stops.includes(place)){toast("Aileronから取り込んだ地図上の訪問先を入力してください");return;}if(!t.actual.includes(place))t.actual.push(place);save();renderTrips();if(t.source==="aileron"&&signedInUser&&sessionToken){try{const response=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(t.id)+"/visited",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+sessionToken},body:JSON.stringify({name:place,visited:true})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"訪問状態を同期できませんでした");}catch(error){toast("端末内には記録しました。クラウド同期は再確認が必要です");return;}}toast("実際の訪問記録を追加しました")}}
if(b.dataset.revokeShare){const record=shareRecords[t.id];if(record&&confirm("この共有URLを無効にしますか？")){try{const res=await fetch(API_BASE+"/api/shares/"+encodeURIComponent(new URL(record.url).searchParams.get("token")),{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revokeKey:record.revokeKey})});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有を停止できませんでした");delete shareRecords[t.id];save();renderTrips();toast("共有URLを無効にしました")}catch(err){toast(err.message||"共有停止に失敗しました")}}return}
if(b.dataset.shareTrip){
 if(!API_BASE){toast("共有APIはまだ未接続です。Cloudflare Workerの公開後に有効になります");return}
 const existing=shareRecords[t.id];
 if(existing){try{await navigator.clipboard.writeText(existing.url);toast("共有URLをコピーしました")}catch{prompt("共有URLをコピーしてください",existing.url)}return}
 const entries=posts.filter(p=>p.tripId===t.id&&p.author===profile.name&&p.visibility==="public").map(p=>({title:p.title,place:p.place,story:p.story,date:p.date}));
 const payload={trip:{title:t.title,area:t.area,date:t.date,description:t.description,stops:t.stops||[],visited:t.actual||[],locations:t.stopLocations||[],entries,author:profile.name}};
 try{const res=await fetch(API_BASE+"/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有リンクを作成できませんでした");shareRecords[t.id]={url:data.url,revokeKey:data.revokeKey,expiresAt:data.expiresAt};save();renderTrips();try{await navigator.clipboard.writeText(data.url);toast("共有URLを発行してコピーしました")}catch{prompt("共有URLを発行しました。コピーしてください",data.url)}}catch(err){toast(err.message||"共有URLの発行に失敗しました")}
}
if(b.dataset.deleteTrip&&confirm("この旅程を削除しますか？")){trips=trips.filter(x=>x.id!==t.id);expenses=expenses.filter(item=>item.tripId!==t.id);if(selectedTrip===t.id)selectedTrip=trips[0]?.id||null;save();if(signedInUser&&sessionToken){try{const res=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(t.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"クラウド側の削除に失敗しました")}catch(error){toast("端末内では削除しました。クラウド同期は次回ログイン時に確認します")}}renderAll();toast("旅程を削除しました")}
});
$("#feedSearch").addEventListener("input",renderFeed);$("#feedSort").addEventListener("change",e=>{feedSort=e.target.value;renderFeed()});$$(".chip").forEach(b=>b.addEventListener("click",()=>{$$(".chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");category=b.dataset.category;renderFeed()}));
renderAll();
if(new URLSearchParams(location.search).has("import")&&!sessionToken)toast("Aileronの旅行プランを取り込むには、Googleログインしてください。");
