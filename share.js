const root=document.querySelector("#shareContent");
const api=(window.TABI_LOG_API_BASE||"").replace(/\/$/,"");
const token=new URLSearchParams(location.search).get("token");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=s=>{if(!s)return "";const d=new Date(s);return Number.isNaN(d.getTime())?esc(s):d.toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric"})};
async function load(){
 if(!token){root.innerHTML='<div class="share-error">共有URLが正しくありません。</div>';return}
 if(!api){root.innerHTML='<div class="share-error">共有機能のサーバー設定がまだ完了していません。時間をおいて再度お試しください。</div>';return}
 try{
  const res=await fetch(api+"/api/shares/"+encodeURIComponent(token));
  const data=await res.json();
  if(!res.ok||!data.ok)throw new Error(data.error||"この共有記録は表示できません");
  const t=data.trip;
  document.title=(t.title||"旅の記録")+" — 旅ログ";
  root.innerHTML='<h1>'+esc(t.title)+'</h1><div class="share-meta">'+esc(t.area)+' '+(t.date?'· '+date(t.date):'')+(t.author?' · '+esc(t.author):'')+'</div><p class="share-description">'+esc(t.description||"")+'</p>'+
   ((t.stops||[]).length?'<section class="share-section"><h2>旅の予定</h2><div class="share-stops">'+t.stops.map(x=>'<span class="share-stop">'+esc(x)+'</span>').join("")+'</div></section>':'')+
   ((t.visited||[]).length?'<section class="share-section"><h2>訪れた場所</h2><div class="share-stops">'+t.visited.map(x=>'<span class="share-stop">✓ '+esc(x)+'</span>').join("")+'</div></section>':'')+
   ((t.entries||[]).length?'<section class="share-section"><h2>旅の日記</h2>'+t.entries.map(x=>'<article class="share-entry"><small>'+esc(date(x.date))+' '+(x.place?'· '+esc(x.place):'')+'</small><h3>'+esc(x.title)+'</h3><p>'+esc(x.story)+'</p></article>').join("")+'</section>':'');
 }catch(e){root.innerHTML='<div class="share-error">'+esc(e.message||"読み込みに失敗しました")+'</div>'}
}
load();
