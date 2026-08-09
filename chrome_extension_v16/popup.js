const $=id=>document.getElementById(id);
const EXT_VERSION='1.3.0';

function show(text,type=''){$('syncMessage').textContent=text;$('syncMessage').className='message '+type;}
function originPattern(base){try{const u=new URL(base);return u.origin+'/*';}catch{return '';}}
function isAmazonVine(url){try{const u=new URL(url);return /(^|\.)amazon\./i.test(u.hostname)&&(/\/vine(?:[/?#]|$)/i.test(u.pathname)||/\/vine\//i.test(u.pathname));}catch{return false;}}
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab||null;}
async function getStored(){return chrome.storage.local.get(['vinetrackBaseUrl','vinetrackExtensionToken','vinetrackUser','vinetrackLastSync']);}

async function requestSitePermission(base){
  const pattern=originPattern(base);if(!pattern)return false;
  try{return await chrome.permissions.request({origins:[pattern]});}catch{return false;}
}
async function api(base,token,path,options={}){
  const headers={...(options.headers||{}),Authorization:`Bearer ${token}`};
  const r=await fetch(base+path,{...options,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||'VineTrack request failed.');
  return data;
}
async function verifyVineTrackOrigin(base){
  try{const r=await fetch(base+'/health',{cache:'no-store'});const d=await r.json();return r.ok&&(/^VineTrack (?:Beta v1[4-6]|v17)/).test(String(d.app||''));}catch{return false;}
}

async function connect(){
  show('');$('connectBtn').disabled=true;
  try{
    const stored=await getStored();let base=stored.vinetrackBaseUrl||'';
    if(!base){
      const tab=await activeTab();
      if(!tab?.url||!/^https?:/i.test(tab.url))throw new Error('Open VineTrack in a normal browser tab, then click Connect VineTrack again.');
      base=new URL(tab.url).origin;
    }
    if(!await requestSitePermission(base))throw new Error('Chrome needs permission to connect this extension to your VineTrack website.');
    if(!await verifyVineTrackOrigin(base)){
      const tab=await activeTab();
      if(tab?.url&&/^https?:/i.test(tab.url)){
        const candidate=new URL(tab.url).origin;
        if(candidate!==base&&await requestSitePermission(candidate)&&await verifyVineTrackOrigin(candidate))base=candidate;
        else throw new Error('Open your live VineTrack page, then click Connect VineTrack.');
      }else throw new Error('Open your live VineTrack page, then click Connect VineTrack.');
    }
    const redirectUri=chrome.identity.getRedirectURL('vinetrack');
    const state=crypto.randomUUID().replaceAll('-','')+Date.now().toString(36);
    const authUrl=base+'/extension/connect?'+new URLSearchParams({redirect_uri:redirectUri,state}).toString();
    const redirected=await chrome.identity.launchWebAuthFlow({url:authUrl,interactive:true});
    if(!redirected)throw new Error('Connection was cancelled.');
    const u=new URL(redirected);const params=new URLSearchParams(u.hash.slice(1));
    if(params.get('state')!==state)throw new Error('Connection security check failed.');
    const token=params.get('token')||'';if(!token.startsWith('vte_'))throw new Error('VineTrack did not return a valid extension connection.');
    const me=await api(base,token,'/api/extension/me');
    await chrome.storage.local.set({vinetrackBaseUrl:base,vinetrackExtensionToken:token,vinetrackUser:me.user||{}});
    show('Connected. You can now open Amazon Vine and sync with one click.','ok');
    await refresh();
  }catch(err){show(err.message||'Could not connect VineTrack.','error');}
  finally{$('connectBtn').disabled=false;}
}

function extractionFunction(){
  const pageUrl=location.href;
  const isVine=/amazon\.[^/]+\/vine\//i.test(pageUrl)||/\/vine(?:[/?#]|$)/i.test(pageUrl);
  if(!isVine)return {error:'Open an Amazon Vine page first.',items:[],pageUrl};
  const anchors=[...document.querySelectorAll('a[href*="/dp/"],a[href*="/gp/product/"]')];
  const seen=new Set(),items=[];
  const dateRx=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/i;
  const statusRx=/(awaiting review|review item|reviewed|approved|pending|rejected|ordered|order details|not yet reviewed)/i;
  const clean=t=>String(t||'').replace(/\s+/g,' ').trim();
  for(const a of anchors){
    const href=a.href||'',m=href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);if(!m)continue;
    const asin=m[1].toUpperCase();if(seen.has(asin))continue;
    const container=a.closest('.vvp-item-tile,.vvp-orders-table--row,.vvp-reviews-table--row,.a-box-group,.a-box,.a-row')||a.parentElement;
    const text=clean(container?.innerText||'');let name=clean(a.textContent);
    if(name.length<4){const img=a.querySelector('img')||container?.querySelector('img[alt]');name=clean(img?.alt);}
    if(name.length<4){const titleEl=container?.querySelector('.vvp-item-product-title-container,.vvp-item-product-title,h2,h3');name=clean(titleEl?.textContent);}
    if(!name||/^(details|see details|review item|order details)$/i.test(name))continue;
    const image=(a.querySelector('img')||container?.querySelector('img'))?.src||'',statusMatch=text.match(statusRx),dateMatch=text.match(dateRx);
    items.push({asin,name:name.slice(0,500),link:`${location.origin}/dp/${asin}`,image,reviewStatus:statusMatch?statusMatch[0]:'',orderDate:dateMatch?dateMatch[0]:'',pageType:location.pathname.includes('reviews')?'Vine reviews':location.pathname.includes('orders')?'Vine orders':'Vine page',sourceUrl:pageUrl});
    seen.add(asin);if(items.length>=100)break;
  }
  return {items,pageUrl};
}

async function syncNow(){
  show('Reading the Vine items visible on this page…');$('syncNow').disabled=true;
  try{
    const cfg=await getStored();if(!cfg.vinetrackBaseUrl||!cfg.vinetrackExtensionToken)throw new Error('Connect VineTrack first.');
    const tab=await activeTab();if(!tab?.id||!isAmazonVine(tab.url||''))throw new Error('Open an Amazon Vine Orders or Reviews page first.');
    let result;try{const out=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractionFunction});result=out?.[0]?.result;}catch{throw new Error('Chrome could not read this Vine page. Refresh the page and try again.');}
    if(result?.error)throw new Error(result.error);
    if(!result?.items?.length)throw new Error('No visible Vine products were detected. Try the Vine Orders or Reviews page.');
    const data=await api(cfg.vinetrackBaseUrl,cfg.vinetrackExtensionToken,'/api/vine-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:result.items,pageUrl:result.pageUrl,extensionVersion:EXT_VERSION})});
    const accepted=Number(data.accepted||result.items.length);const at=new Date().toISOString();await chrome.storage.local.set({vinetrackLastSync:{at,accepted}});
    show(`${accepted} Vine item${accepted===1?'':'s'} synced. Opening VineTrack to finish the import…`,'ok');
    chrome.tabs.create({url:cfg.vinetrackBaseUrl+'/app.html?sync=import'});
    await refresh();
  }catch(err){show(err.message||'Could not sync this Vine page.','error');}
  finally{await refresh();}
}

async function disconnect(){
  const cfg=await getStored();
  try{if(cfg.vinetrackBaseUrl&&cfg.vinetrackExtensionToken)await api(cfg.vinetrackBaseUrl,cfg.vinetrackExtensionToken,'/api/extension/disconnect-self',{method:'POST'});}catch{}
  await chrome.storage.local.remove(['vinetrackExtensionToken','vinetrackUser','vinetrackLastSync']);show('Disconnected.','ok');await refresh();
}

async function refresh(){
  const cfg=await getStored(),tab=await activeTab();let connected=false,user=cfg.vinetrackUser||{};
  if(cfg.vinetrackBaseUrl&&cfg.vinetrackExtensionToken){
    try{const me=await api(cfg.vinetrackBaseUrl,cfg.vinetrackExtensionToken,'/api/extension/me');connected=true;user=me.user||user;await chrome.storage.local.set({vinetrackUser:user});}
    catch{await chrome.storage.local.remove(['vinetrackExtensionToken','vinetrackUser']);}
  }
  $('statusBadge').textContent=connected?'Connected':'Not connected';$('statusBadge').className='badge '+(connected?'connected':'');
  $('accountName').textContent=connected?(user.name||'VineTrack account'):'Not connected';$('accountEmail').textContent=connected?(user.email||'Connected to VineTrack'):'Open VineTrack and connect once.';
  $('connectBtn').hidden=connected;$('openVineTrack').hidden=!cfg.vinetrackBaseUrl;$('disconnectBtn').hidden=!connected;
  const vine=isAmazonVine(tab?.url||'');$('vineBadge').textContent=vine?'Vine detected':'Not detected';$('vineBadge').className='dot-badge '+(vine?'detected':'');$('amazonState').textContent=vine?'Amazon Vine detected':'Open Amazon Vine';$('amazonHint').textContent=vine?'Ready to sync the products visible on this page.':'Go to your Vine Orders or Reviews page.';
  $('syncNow').disabled=!(connected&&vine);
  if(cfg.vinetrackLastSync?.at){const d=new Date(cfg.vinetrackLastSync.at);$('lastSync').textContent=`${d.toLocaleString()} · ${cfg.vinetrackLastSync.accepted||0} items`; }else $('lastSync').textContent='Never';
}

$('connectBtn').addEventListener('click',connect);$('syncNow').addEventListener('click',syncNow);$('disconnectBtn').addEventListener('click',disconnect);$('openVineTrack').addEventListener('click',async()=>{const cfg=await getStored();if(cfg.vinetrackBaseUrl)chrome.tabs.create({url:cfg.vinetrackBaseUrl+'/app.html'});});
refresh();
