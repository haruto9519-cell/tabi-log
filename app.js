const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DB_NAME="tabiLogMedia", STORE="media";
function openMediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function mediaPut(key,blob){const db=await openMediaDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(blob,key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function mediaGet(key){const db=await openMediaDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
const uid=()=>crypto.randomUUID();
const API_BASE=(window.TABI_LOG_API_BASE||"").replace(/\/$/,"");
const GOOGLE_CLIENT_ID=window.TABI_LOG_GOOGLE_CLIENT_ID||"";
const SESSION_KEY="tabiLogSession";
let sessionToken=sessionStorage.getItem(SESSION_KEY)||"", signedInUser=null, googleInitialized=false;
function renderAuth(){
 const host=$("#googleLogin"),status=$("#authStatus");
 if(!host||!status)return;
 host.innerHTML="";
 if(signedInUser){
  status.innerHTML='<span class="auth-name">'+esc(signedInUser.name||"Googleユーザー")+'</span> <button type="button" class="auth-signout" id="googleSignOut">ログアウト</button>';
  $("#googleSignOut").onclick=logoutFromApp;
  return;
 }
 status.textContent="";
 if(window.google?.accounts?.id&&GOOGLE_CLIENT_ID){
  window.google.accounts.id.renderButton(host,{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"ja"});
 }else{
  host.innerHTML='<span class="auth-loading">Googleログインを読み込み中…</span>';
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
let posts=read("posts",seedPosts),trips=read("trips",seedTrips),saved=read("saved",[]),following=read("following",[]),blocked=read("blocked",[]),profile=read("profile",{name:"旅好きユーザー",bio:"旅の記録を、少しずつ。"}),selectedTrip=trips[0]?.id||null,category="すべて",feedSort="recommend",mediaUrls={};
let cloudSyncTimer=null,cloudSyncBusy=false,cloudSyncHydrating=false,cloudSyncQueued=false;
function save(){
 for(const [k,v] of Object.entries({posts,trips,saved,following,blocked,profile,shares:shareRecords}))localStorage.setItem("tabilog_"+k,JSON.stringify(v));
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
   description:t.description||"",visibility:t.visibility||"private",
   stops:Array.isArray(t.stops)?t.stops:[],actual:Array.isArray(t.actual)?t.actual:[],
   isMine:true,owner:"me",source:"native"
  }));
  const remotePosts=(remote.posts||[]).map(p=>({
   id:p.id,tripId:p.trip_id||"",title:p.title,story:p.story,place:p.place_name,
   author:profile.name,date:p.captured_at||p.created_at||new Date().toISOString(),
   category:"旅",visual:"v4",symbol:"📍",likes:0,liked:false,saved:false,
   visibility:p.visibility||"private",mediaKey:null,comments:[]
  }));
  const tripIds=new Set(trips.map(t=>t.id));
  for(const t of remoteTrips)if(!tripIds.has(t.id))trips.push(t);
  const postIds=new Set(posts.map(p=>p.id));
  for(const p of remotePosts)if(!postIds.has(p.id))posts.push(p);
  if(!selectedTrip&&trips.length)selectedTrip=trips[0].id;
  for(const [k,v] of Object.entries({posts,trips}))localStorage.setItem("tabilog_"+k,JSON.stringify(v));
  cloudSyncHydrating=false;
  const payload={
   trips:trips.filter(t=>t.isMine||t.source==="native").slice(0,100).map(t=>({
    id:t.id,title:t.title,area:t.area,description:t.description||"",
    visibility:t.visibility||"private",start_date:t.date||"",end_date:t.endDate||"",
    stops:Array.isArray(t.stops)?t.stops:[],actual:Array.isArray(t.actual)?t.actual:[]
   })),
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
function renderTrips(){let own=trips.filter(t=>t.owner==="me"||t.source==="native"&&t.isMine);if(!own.length)own=trips.filter(t=>t.isMine);$("#tripTotal").textContent=own.length+"件";$("#tripCards").innerHTML=own.length?own.map(t=>`<article class="trip-card ${selectedTrip===t.id?"selected":""}"><h3>${esc(t.title)}</h3><p>${esc(t.area)} · ${fmt(t.date)}<br>${esc(t.description||"")}</p><div class="trip-meta"><span>予定 ${t.stops?.length||0}か所</span><span>実際 ${t.actual?.length||0}か所</span><span>${t.visibility==="public"?"公開":"非公開"}</span></div><div class="trip-tools"><button class="action" data-select-trip="${t.id}">ルートを見る</button><button class="action" data-edit-trip="${t.id}">編集</button><button class="action" data-add-stop="${t.id}">＋ 行き先</button><button class="action" data-copy-trip="${t.id}">コピー</button><button class="action" data-actual="${t.id}">実際に訪問</button><button class="action" data-share-trip="${t.id}">${shareRecords[t.id]?"共有リンクをコピー":"共有URLを発行"}</button>${shareRecords[t.id]?`<button class="action" data-revoke-share="${t.id}">共有を停止</button>`:""}<button class="action" data-delete-trip="${t.id}">削除</button></div></article>`).join(""):`<div class="empty-state">まだ旅程がありません。最初の旅をつくってみよう。</div>`;renderMap();}
function renderMap(){let t=trips.find(x=>x.id===selectedTrip);$("#mapTitle").textContent=t?t.title:"旅のルート";$("#mapPins").innerHTML="";$("#mapStopList").innerHTML="";if(!t)return;let coords=[[15,70],[48,27],[80,64],[64,82],[28,20],[88,22]];(t.stops||[]).forEach((s,i)=>{let c=coords[i%coords.length],pin=document.createElement("div");pin.className="pin";pin.style.left=c[0]+"%";pin.style.top=c[1]+"%";pin.innerHTML=`<span>${i+1}</span>`;$("#mapPins").append(pin);let pill=document.createElement("span");pill.className="stop-pill";pill.textContent=(t.actual||[]).includes(s)?"✓ "+s:s;$("#mapStopList").append(pill);});}
function renderDiary(){let mine=posts.filter(p=>p.author===profile.name).sort((a,b)=>String(b.date).localeCompare(String(a.date)));$("#diaryTimeline").innerHTML=mine.length?mine.map(p=>`<div class="timeline-item"><div class="timeline-date">${esc(p.date||"今日")}</div><div class="timeline-line"></div><article class="timeline-card"><div class="timeline-thumb">${p.mediaKey?"📷":p.symbol||"📍"}</div><div><small>📍 ${esc(p.place)}</small><h3>${esc(p.title)}</h3><p>${esc(p.story)}</p></div></article></div>`).join(""):`<div class="empty-state">ここに日記・思い出が時系列で並びます。「日記を追加」から記録できます。</div>`;}
function renderProfile(){let mine=posts.filter(p=>p.author===profile.name);$("#profileName").textContent=profile.name;$("#profileBio").textContent=profile.bio;$("#profileAvatar").textContent=(profile.name||"旅").slice(0,1);$("#profilePostCount").textContent=mine.length;$("#profileTripCount").textContent=trips.filter(t=>t.isMine).length;if($("#followingCount"))$("#followingCount").textContent=0;$("#statTrips").textContent=trips.filter(t=>t.isMine).length;$("#statPosts").textContent=mine.length;$("#statSaved").textContent=saved.length;}
function renderAll(){renderFeed();renderTrips();renderDiary();renderProfile();}
function openDialog(id){$(id).showModal()}function closeDialog(id){$(id).close()}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeDialog("#"+b.dataset.close)));
$("#openTrip").onclick=()=>openDialog("#tripDialog");$("#newTrip2").onclick=()=>openDialog("#tripDialog");$("#heroTrip").onclick=()=>openDialog("#tripDialog");$("#openPost").onclick=()=>{refreshTripSelect();openDialog("#postDialog")};
function refreshTripSelect(){$("#postTripSelect").innerHTML='<option value="">旅程に紐づけない</option>'+trips.filter(t=>t.isMine).map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");}
$("#tripForm").addEventListener("submit",e=>{e.preventDefault();let f=new FormData(e.currentTarget),stops=String(f.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean),t={id:uid(),title:f.get("title"),area:f.get("area"),date:f.get("date"),description:f.get("description"),visibility:f.get("visibility"),stops,actual:[],isMine:true,owner:"me",source:"native"};trips.unshift(t);selectedTrip=t.id;save();e.currentTarget.reset();closeDialog("#tripDialog");renderAll();toast("旅程を作成しました");});
$("#tripEditForm").addEventListener("submit",e=>{e.preventDefault();const f=e.currentTarget,id=f.elements.id.value,t=trips.find(x=>x.id===id);if(!t){toast("編集する旅行が見つかりません");return;}const data=new FormData(f);t.title=String(data.get("title")||"").trim();t.area=String(data.get("area")||"").trim();t.date=String(data.get("date")||"");t.description=String(data.get("description")||"");t.stops=String(data.get("stops")||"").split(/[,、]/).map(s=>s.trim()).filter(Boolean);t.visibility=String(data.get("visibility")||"private");save();closeDialog("#tripEditDialog");renderAll();toast("旅行を更新しました");});
$("#postForm").addEventListener("submit",async e=>{e.preventDefault();let f=new FormData(e.currentTarget),file=f.get("media"),mediaKey=null;if(file&&file.size){if(file.size>5*1024*1024){toast("テスト版のファイル上限は5MBです");return}mediaKey=uid();try{await mediaPut(mediaKey,file)}catch{toast("メディア保存に失敗しました");return}}
let p={id:uid(),title:f.get("title"),place:f.get("place"),story:f.get("story"),author:profile.name,date:f.get("capturedAt")||new Date().toISOString(),category:f.get("category"),visual:"v4",symbol:file&&file.type.startsWith("video/")?"▶":"📷",likes:0,liked:false,saved:false,visibility:f.get("visibility"),tripId:f.get("tripId"),mediaKey,approxLocation:f.get("approxLocation")==="on",comments:[]};posts.unshift(p);if(p.tripId){let t=trips.find(x=>x.id===p.tripId);if(t&&!t.actual.includes(p.place))t.actual.push(p.place)}save();e.currentTarget.reset();closeDialog("#postDialog");renderAll();toast("日記・思い出を保存しました");});
$("#editProfile").onclick=()=>{let f=$("#profileForm");f.elements.name.value=profile.name;f.elements.bio.value=profile.bio;openDialog("#profileDialog")};
$("#profileForm").addEventListener("submit",e=>{e.preventDefault();let f=new FormData(e.currentTarget),old=profile.name;profile={name:f.get("name"),bio:f.get("bio")};posts.forEach(p=>{if(p.author===old)p.author=profile.name});save();closeDialog("#profileDialog");renderAll();toast("プロフィールを更新しました")});
$("#privacySettings").onclick=()=>openDialog("#privacyDialog");
$("#feed").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let p=posts.find(x=>x.id===b.dataset.like||x.id===b.dataset.save||x.id===b.dataset.comment||x.id===b.dataset.remix||x.id===b.dataset.report);if(b.dataset.follow){let n=b.dataset.follow;following=following.includes(n)?following.filter(x=>x!==n):[...following,n];save();renderAll();toast(following.includes(n)?"フォローしました":"フォローを解除しました");return}if(b.dataset.block){let n=b.dataset.block;if(confirm(n+"さんの投稿を非表示にしますか？")){blocked=[...new Set([...blocked,n])];save();renderAll();toast("投稿を非表示にしました")}return}if(!p)return;
if(b.dataset.like){p.liked=!p.liked;p.likes+=p.liked?1:-1;save();renderFeed()}
if(b.dataset.save){p.saved=!p.saved;saved=p.saved?[...new Set([...saved,p.id])]:saved.filter(x=>x!==p.id);save();renderAll();toast(p.saved?"保存しました":"保存を解除しました")}
if(b.dataset.comment){let c=prompt("コメントを入力（この端末内のテスト）");if(c?.trim()){p.comments=p.comments||[];p.comments.push({name:profile.name,body:c.trim(),date:new Date().toISOString()});save();renderFeed();toast("コメントを保存しました")}}
if(b.dataset.remix){let t=trips.find(x=>x.id===p.tripId);if(t){trips.unshift({...t,id:uid(),title:t.title+"（参考）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"})}else{trips.unshift({id:uid(),title:p.title+"を参考にした旅",area:p.place,description:"投稿を参考に作成",stops:[p.place],actual:[],isMine:true,owner:"me",visibility:"private"})}save();renderAll();toast("参考旅程を作成しました")}
if(b.dataset.report){let reason=prompt("通報理由を入力してください（テスト用）");if(reason?.trim())toast("通報内容をこの画面では送信せず、テスト記録として受け付けました")}
});
$("#tripCards").addEventListener("click",async e=>{let b=e.target.closest("button");if(!b)return;let t=trips.find(x=>x.id===b.dataset.selectTrip||x.id===b.dataset.editTrip||x.id===b.dataset.addStop||x.id===b.dataset.copyTrip||x.id===b.dataset.actual||x.id===b.dataset.deleteTrip||x.id===b.dataset.shareTrip||x.id===b.dataset.revokeShare);if(!t)return;
if(b.dataset.selectTrip){selectedTrip=t.id;renderTrips()}
 if(b.dataset.editTrip){const f=$("#tripEditForm");f.elements.id.value=t.id;f.elements.title.value=t.title||"";f.elements.area.value=t.area||"";f.elements.date.value=t.date||"";f.elements.description.value=t.description||"";f.elements.stops.value=(t.stops||[]).join(", ");f.elements.visibility.value=t.visibility||"private";openDialog("#tripEditDialog");return;}
if(b.dataset.addStop){let s=prompt("追加する立ち寄り先");if(s?.trim()){t.stops.push(s.trim());save();renderTrips();toast("行き先を追加しました")}}
if(b.dataset.copyTrip){trips.unshift({...t,id:uid(),title:t.title+"（コピー）",stops:[...t.stops],actual:[],isMine:true,owner:"me",visibility:"private"});save();renderAll();toast("旅程をコピーしました")}
if(b.dataset.actual){let s=prompt("実際に訪れた場所を入力",t.stops.find(x=>!t.actual.includes(x))||"");if(s?.trim()){if(!t.actual.includes(s.trim()))t.actual.push(s.trim());save();renderTrips();toast("実際の訪問記録を追加しました")}}
if(b.dataset.revokeShare){const record=shareRecords[t.id];if(record&&confirm("この共有URLを無効にしますか？")){try{const res=await fetch(API_BASE+"/api/shares/"+encodeURIComponent(new URL(record.url).searchParams.get("token")),{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({revokeKey:record.revokeKey})});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有を停止できませんでした");delete shareRecords[t.id];save();renderTrips();toast("共有URLを無効にしました")}catch(err){toast(err.message||"共有停止に失敗しました")}}return}
if(b.dataset.shareTrip){
 if(!API_BASE){toast("共有APIはまだ未接続です。Cloudflare Workerの公開後に有効になります");return}
 const existing=shareRecords[t.id];
 if(existing){try{await navigator.clipboard.writeText(existing.url);toast("共有URLをコピーしました")}catch{prompt("共有URLをコピーしてください",existing.url)}return}
 const entries=posts.filter(p=>p.tripId===t.id&&p.author===profile.name).map(p=>({title:p.title,place:p.place,story:p.story,date:p.date}));
 const payload={trip:{title:t.title,area:t.area,date:t.date,description:t.description,stops:t.stops||[],visited:t.actual||[],entries,author:profile.name}};
 try{const res=await fetch(API_BASE+"/api/shares",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"共有リンクを作成できませんでした");shareRecords[t.id]={url:data.url,revokeKey:data.revokeKey,expiresAt:data.expiresAt};save();renderTrips();try{await navigator.clipboard.writeText(data.url);toast("共有URLを発行してコピーしました")}catch{prompt("共有URLを発行しました。コピーしてください",data.url)}}catch(err){toast(err.message||"共有URLの発行に失敗しました")}
}
if(b.dataset.deleteTrip&&confirm("この旅程を削除しますか？")){trips=trips.filter(x=>x.id!==t.id);if(selectedTrip===t.id)selectedTrip=trips[0]?.id||null;save();if(signedInUser&&sessionToken){try{const res=await fetch(API_BASE+"/api/trips/"+encodeURIComponent(t.id),{method:"DELETE",headers:{authorization:"Bearer "+sessionToken}});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||"クラウド側の削除に失敗しました")}catch(error){toast("端末内では削除しました。クラウド同期は次回ログイン時に確認します")}}renderAll();toast("旅程を削除しました")}
});
$("#feedSearch").addEventListener("input",renderFeed);$("#feedSort").addEventListener("change",e=>{feedSort=e.target.value;renderFeed()});$$(".chip").forEach(b=>b.addEventListener("click",()=>{$$(".chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");category=b.dataset.category;renderFeed()}));
renderAll();
