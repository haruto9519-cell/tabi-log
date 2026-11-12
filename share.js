const root=document.querySelector("#shareContent");
const api=(window.TABI_LOG_API_BASE||"").replace(/\/$/,"");
const token=new URLSearchParams(location.search).get("token");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=s=>{if(!s)return "";const d=new Date(s);return Number.isNaN(d.getTime())?esc(s):d.toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric"})};
function drawShareCard(t){
 const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=630;
 const c=canvas.getContext("2d");
 const bg=c.createLinearGradient(0,0,1200,630);bg.addColorStop(0,"#10263d");bg.addColorStop(1,"#1d4054");c.fillStyle=bg;c.fillRect(0,0,1200,630);
 c.fillStyle="#d7ad6c";c.fillRect(0,0,1200,9);
 c.fillStyle="#d7ad6c";c.font="bold 20px Arial,sans-serif";c.fillText("MY TRAVEL STORY",76,82);
 c.fillStyle="#ffffff";c.font="bold 54px Arial,sans-serif";
 const title=String(t.title||"旅の記録");c.fillText(title.length>19?title.slice(0,18)+"…":title,76,155);
 c.fillStyle="#d8e3e8";c.font="24px Arial,sans-serif";c.fillText(String(t.area||""),78,202);if(t.tripType==="pilgrimage"){c.fillStyle="#d7ad6c";c.font="bold 18px Arial,sans-serif";c.fillText("PILGRIMAGE · "+String(t.relatedWork||"聖地巡礼").slice(0,34),78,245);}
 c.strokeStyle="rgba(215,173,108,.9)";c.lineWidth=5;c.setLineDash([12,10]);c.beginPath();c.moveTo(105,345);c.lineTo(700,345);c.stroke();c.setLineDash([]);
 const stops=(t.locations||[]).length?(t.locations||[]).map(x=>x.name):(t.stops||[]);
 const n=Math.max(1,Math.min(6,stops.length));
 for(let i=0;i<n;i++){const x=n===1?400:110+i*(570/(n-1));c.fillStyle="#d7ad6c";c.beginPath();c.arc(x,345,17,0,Math.PI*2);c.fill();c.strokeStyle="#ffffff";c.lineWidth=3;c.stroke();c.fillStyle="#10263d";c.font="bold 17px Arial,sans-serif";c.textAlign="center";c.fillText(String(i+1),x,351);}
 c.textAlign="left";c.fillStyle="#ffffff";c.font="bold 24px Arial,sans-serif";c.fillText("VISITED PLACES",78,430);
 c.fillStyle="#d8e3e8";c.font="20px Arial,sans-serif";
 const stopText=stops.slice(0,5).join("  ·  ");c.fillText(stopText.length>46?stopText.slice(0,45)+"…":stopText,78,472);
 c.fillStyle="rgba(255,255,255,.08)";c.fillRect(790,70,340,490);
 c.fillStyle="#d7ad6c";c.font="bold 18px Arial,sans-serif";c.fillText("PLAN YOUR NEXT TRIP",830,130);
 c.fillStyle="#ffffff";c.font="bold 30px Arial,sans-serif";c.fillText("Aileron",830,180);
 c.fillStyle="#d8e3e8";c.font="18px Arial,sans-serif";c.fillText("aileron-japan-travel.pages.dev",830,216);
 c.fillStyle="#d7ad6c";c.font="bold 18px Arial,sans-serif";c.fillText("SAVE YOUR MEMORIES",830,315);
 c.fillStyle="#ffffff";c.font="bold 30px Arial,sans-serif";c.fillText("Tabi Log",830,365);
 c.fillStyle="#d8e3e8";c.font="18px Arial,sans-serif";c.fillText("tabi-log.pages.dev",830,401);
 c.fillStyle="#d7ad6c";c.fillRect(830,455,230,2);
 c.fillStyle="#d8e3e8";c.font="16px Arial,sans-serif";c.fillText("YOUR JOURNEY, YOUR MEMORY",830,495);
 c.fillStyle="rgba(255,255,255,.6)";c.font="15px Arial,sans-serif";c.fillText("Shared with Aileron Travel × Tabi Log",78,570);
 return canvas;
}
function setupShareTools(t){
 const host=document.createElement("section");host.className="share-section share-card-tools";
 host.innerHTML='<h2>SNSに投稿する</h2><p>カード画像を保存し、投稿文に2つのサービスURLを添えて共有できます。</p><div class="share-actions"><button type="button" class="btn navy" id="downloadShareCard">シェアカード画像を保存</button><button type="button" class="btn gold" id="copyShareCaption">投稿文とURLをコピー</button></div><p class="share-note">写真はプライベートな記録として扱い、共有ページやシェアカードには含めません。写真を共有したい場合も、共有URLの閲覧者には公開されない設計です。</p>';
 root.append(host);
 const canvas=drawShareCard(t);
 host.querySelector("#downloadShareCard").addEventListener("click",()=>{
  canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="tabi-log-share-card.png";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);},"image/png");
 });
 host.querySelector("#copyShareCaption").addEventListener("click",async()=>{
  const caption=(t.tripType==="pilgrimage"?"作品の舞台を巡る旅を記録しました。\n":"こんな旅をしてきました。\n")+(t.title||"旅の記録")+"｜"+(t.area||"")+(t.relatedWork?"\n作品："+t.relatedWork:"")+"\n\nこの旅のプランを作る： https://aileron-japan-travel.pages.dev/\n旅の写真・記録を見る： "+location.href;
  try{await navigator.clipboard.writeText(caption);host.querySelector("#copyShareCaption").textContent="コピーしました";}catch{prompt("投稿文をコピーしてください",caption);}
 });
}
function renderSharedMap(locations){
 if(!Array.isArray(locations)||!locations.length)return "";
 return '<section class="share-section"><h2>旅のルート</h2><div id="sharedTripMap" class="shared-trip-map"></div></section>';
}
function mountSharedMap(locations){
 const host=document.querySelector("#sharedTripMap");if(!host||!window.L)return;
 const map=L.map(host,{scrollWheelZoom:false}).setView([36.2,138.25],5);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 const pts=[];
 locations.forEach((p,i)=>{const ll=[Number(p.latitude),Number(p.longitude)];if(!ll.every(Number.isFinite))return;pts.push(ll);L.marker(ll).bindPopup((i+1)+". "+esc(p.name)).addTo(map);});
 if(pts.length>1)L.polyline(pts,{color:"#c49a5e",weight:4,dashArray:"7 7"}).addTo(map);
 if(pts.length)map.fitBounds(pts,{padding:[25,25],maxZoom:12});
}
async function load(){
 if(!token){root.innerHTML='<div class="share-error">共有URLが正しくありません。</div>';return}
 if(!api){root.innerHTML='<div class="share-error">共有機能のサーバー設定がまだ完了していません。</div>';return}
 try{
  const res=await fetch(api+"/api/shares/"+encodeURIComponent(token));
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"この共有記録は表示できません");
  const t=data.trip;
  document.title=(t.title||"旅の記録")+" — 旅ログ";
  root.innerHTML='<h1>'+esc(t.title)+'</h1><div class="share-meta">'+esc(t.area)+' '+(t.date?'· '+date(t.date):'')+(t.author?' · '+esc(t.author):'')+'</div>'+(t.tripType==='pilgrimage'?'<div class="share-pilgrimage"><b>聖地巡礼</b><span>'+esc(t.relatedWork||'作品名未設定')+'</span></div>':'')+'<p class="share-description">'+esc(t.description||"")'</p>'+
   ((t.stops||[]).length?'<section class="share-section"><h2>旅の予定</h2><div class="share-stops">'+t.stops.map(x=>'<span class="share-stop">'+esc(x)+'</span>').join("")+'</div></section>':'')+
   ((t.visited||[]).length?'<section class="share-section"><h2>訪れた場所</h2><div class="share-stops">'+t.visited.map(x=>'<span class="share-stop">✓ '+esc(x)+'</span>').join("")+'</div></section>':'')+
   renderSharedMap(t.locations||[]) +
   ((t.entries||[]).length?'<section class="share-section"><h2>旅の日記</h2>'+t.entries.map(x=>'<article class="share-entry"><small>'+esc(date(x.date))+' '+(x.place?'· '+esc(x.place):'')+'</small><h3>'+esc(x.title)+'</h3><p>'+esc(x.story)+'</p></article>').join("")+'</section>':'')+
   '<section class="share-section share-service-links"><h2>この旅を参考に、次の旅へ</h2><a class="btn navy" href="https://aileron-japan-travel.pages.dev/" target="_blank" rel="noopener">Aileronで旅行プランを作る</a> <a class="btn gold" href="https://tabi-log.pages.dev/" target="_blank" rel="noopener">Tabi Logで旅を記録する</a></section>';
  setupShareTools(t);
  mountSharedMap(t.locations||[]);
 }catch(e){root.innerHTML='<div class="share-error">'+esc(e.message||"読み込みに失敗しました")+'</div>'}
}
load();
