(function(){
  let auth={user:null};
  try{
    const raw=document.getElementById('vinetrackAuthData')?.textContent||'';
    auth=JSON.parse(raw);
  }catch(e){ auth={user:null}; }
  window.VINETRACK_AUTH=auth;
  const user=auth.user;
  if(!user)return;
  const first=(user.name||'VineTrack').trim().split(/\s+/)[0]||'VineTrack';
  const initials=(user.name||'V').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'V';
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
  set('accountName',user.name||'VineTrack user');
  set('accountEmail',user.email||'Signed in');
  set('accountAvatar',initials);
  const title=document.getElementById('pageSubtitle');
  if(title && title.textContent==='See what needs your attention.') title.textContent=`Welcome back, ${first}. See what needs your attention.`;
  const logout=document.getElementById('logoutBtn');
  if(logout) logout.addEventListener('click',async()=>{
    logout.disabled=true;
    try{ await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); }
    finally{ window.location.href='/'; }
  });
})();
