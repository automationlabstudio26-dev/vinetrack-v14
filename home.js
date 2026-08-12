(function applyVineTrackLandingPolish(){
  document.body.classList.add('vt-landing');
  if(!document.querySelector('link[data-vt-polish]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='polish.css';
    link.dataset.vtPolish='true';
    document.head.appendChild(link);
  }
})();

(async function(){
  try{
    const r=await fetch('/api/auth/me',{cache:'no-store'});
    const data=await r.json();
    if(!data.authenticated)return;
    const first=(data.user?.name||'').trim().split(/\s+/)[0];
    const setLink=(id,text)=>{const el=document.getElementById(id);if(el){el.href='/app.html';el.textContent=text;}};
    setLink('headerCta','Open dashboard');setLink('heroCta','Open my dashboard');setLink('bottomCta','Continue in VineTrack');
    const signin=document.getElementById('signinLink');if(signin){signin.href='/app.html';signin.textContent=first?`Hi, ${first}`:'My account';}
  }catch(e){}
})();
