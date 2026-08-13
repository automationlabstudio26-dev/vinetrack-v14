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

(function exposePublishedChromeExtension(){
  const storeUrl='https://chromewebstore.google.com/detail/vinetrack-for-chrome/mfgohljjhgoeilbhiopkjdmodmkdknkj';

  const heroSecondary=document.querySelector('.hero-actions .secondary');
  if(heroSecondary){
    heroSecondary.href=storeUrl;
    heroSecondary.target='_blank';
    heroSecondary.rel='noopener noreferrer';
    heroSecondary.textContent='Get Chrome extension';
  }

  const navActions=document.querySelector('.nav-actions');
  if(navActions&&!navActions.querySelector('[data-vt-chrome-store]')){
    const link=document.createElement('a');
    link.className='text-link';
    link.href=storeUrl;
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='Chrome extension';
    link.dataset.vtChromeStore='true';
    navActions.prepend(link);
  }

  document.querySelectorAll('.hero-badges .eyebrow').forEach(el=>{el.textContent='VineTrack v17 · Live';});
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
