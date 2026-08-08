const $=id=>document.getElementById(id);
let mode='login';
const params=new URLSearchParams(location.search);
const requestedNext=params.get('next')||'/app.html';
const next=(requestedNext.startsWith('/')&&!requestedNext.startsWith('//'))?requestedNext:'/app.html';

async function checkSession(){
  try{
    const r=await fetch('/api/auth/me',{cache:'no-store'});
    const data=await r.json();
    if(data.authenticated)location.replace(next);
  }catch(e){}
}
checkSession();

function setMode(nextMode){
  mode=nextMode;
  const register=mode==='register';
  $('loginTab').classList.toggle('active',!register);
  $('registerTab').classList.toggle('active',register);
  $('loginTab').setAttribute('aria-selected',String(!register));
  $('registerTab').setAttribute('aria-selected',String(register));
  $('nameField').classList.toggle('hidden',!register);
  $('privacyField').classList.toggle('hidden',!register);
  $('formTitle').textContent=register?'Create your VineTrack account':'Sign in to VineTrack';
  $('formSubtitle').textContent=register?'Start the free public beta in under a minute.':'Continue to your private review workspace.';
  $('submitBtn').textContent=register?'Create free beta account':'Sign in';
  $('password').autocomplete=register?'new-password':'current-password';
  $('authError').textContent='';
}
$('loginTab').onclick=()=>setMode('login');
$('registerTab').onclick=()=>setMode('register');
$('togglePassword').onclick=()=>{
  const show=$('password').type==='password';
  $('password').type=show?'text':'password';
  $('togglePassword').textContent=show?'Hide':'Show';
  $('togglePassword').setAttribute('aria-label',show?'Hide password':'Show password');
};
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('email').value.trim();
  const password=$('password').value;
  const name=$('name').value.trim();
  if(!email||!password){$('authError').textContent='Enter your email and password.';return;}
  if(mode==='register'&&!name){$('authError').textContent='Enter your name.';return;}
  if(password.length<8){$('authError').textContent='Password must be at least 8 characters.';return;}
  if(mode==='register'&&!$('privacyAck').checked){$('authError').textContent='Please confirm how beta data is stored.';return;}
  $('submitBtn').disabled=true;$('authError').textContent='';
  try{
    const endpoint=mode==='register'?'/api/auth/register':'/api/auth/login';
    const payload=mode==='register'?{name,email,password}:{email,password};
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Could not continue. Please try again.');
    location.replace(next);
  }catch(err){$('authError').textContent=err.message||'Could not continue. Please try again.';}
  finally{$('submitBtn').disabled=false;}
});

if(params.get('mode')==='register')setMode('register');
