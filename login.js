(function applyVineTrackLoginPolish(){
  document.body.classList.add('vt-login');
  if(!document.querySelector('link[data-vt-polish]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='polish.css';
    link.dataset.vtPolish='true';
    document.head.appendChild(link);
  }
})();

const params=new URLSearchParams(location.search);
const requestedNext=params.get('next')||'/app.html';
const next=(requestedNext.startsWith('/')&&!requestedNext.startsWith('//'))?requestedNext:'/app.html';
const amazonBtn=document.getElementById('amazonBtn');
const authError=document.getElementById('authError');

amazonBtn.href='/auth/amazon?next='+encodeURIComponent(next);

const amazonError=params.get('amazon_error');
if(amazonError){
  authError.textContent=amazonError;
}

(async function checkSession(){
  try{
    const r=await fetch('/api/auth/me',{cache:'no-store'});
    const data=await r.json();
    if(data.authenticated) location.replace(next);
  }catch(e){}
})();
