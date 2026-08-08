const USER_SCOPE=String(document.body?.dataset?.userId||'guest');
const storageKey=name=>`vinetrack_u${USER_SCOPE}_${name}`;
const KEY=storageKey('products_v2');
const OLD_KEY=storageKey('products_v1');
const SETTINGS=storageKey('settings_v1');
const LEGACY_KEYS={products:'vinetrack_products_v2',productsOld:'vinetrack_products_v1',settings:'vinetrack_settings_v1',filters:'vinetrack_saved_filters_v1',ui:'vinetrack_ui_v1',health:'vinetrack_health_v1',feedback:'vinetrack_inapp_feedback_v1'};
const MIGRATION_MARKER=storageKey('legacy_migrated_v12');
if(!localStorage.getItem(MIGRATION_MARKER)){
  const pairs=[[LEGACY_KEYS.products,KEY],[LEGACY_KEYS.productsOld,OLD_KEY],[LEGACY_KEYS.settings,SETTINGS],[LEGACY_KEYS.filters,storageKey('saved_filters_v1')],[LEGACY_KEYS.ui,storageKey('ui_v1')],[LEGACY_KEYS.health,storageKey('health_v1')],[LEGACY_KEYS.feedback,storageKey('inapp_feedback_v1')]];
  pairs.forEach(([from,to])=>{if(!localStorage.getItem(to)&&localStorage.getItem(from))localStorage.setItem(to,localStorage.getItem(from));});
  localStorage.setItem(MIGRATION_MARKER,new Date().toISOString());
}
const statuses=['Ordered','Awaiting delivery','Testing','Ready to review','Draft ready','Submitted','Pending approval','Approved','Rejected','Needs resubmission','Archived'];
let products=JSON.parse(localStorage.getItem(KEY)||localStorage.getItem(OLD_KEY)||'[]');
const $=id=>document.getElementById(id);

function save(){localStorage.setItem(KEY,JSON.stringify(products));renderAll();}
function switchView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  $(view).classList.add('active-view');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const titles={dashboard:['Dashboard','See what needs your attention.'],add:['Add Product','Create a new Vine product record.'],products:['My Products','Search, filter and update your products.'],sync:['Amazon Sync','Bring visible Vine items into VineTrack with an explicit browser-companion sync.'],review:['Review Assistant','Turn genuine testing notes into an editable draft.'],activity:['Activity & Calendar','See progress, target dates and local reminders.'],session:['Review Session','Work through the right products in priority order.'],feedback:['Send Feedback','Tell us what would make VineTrack more useful.'],settings:['Settings','Manage preferences, backups and browser-local data.']};
  $('pageTitle').textContent=titles[view][0];$('pageSubtitle').textContent=titles[view][1];
}

document.querySelectorAll('.nav-btn[data-view]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.view));
document.querySelectorAll('[data-go]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.go));

$('productForm').addEventListener('submit',e=>{
  e.preventDefault();
  const newName=$('name').value.trim();const newLink=$('link').value.trim();
  const duplicate=products.find(p=>(newLink&&p.link&&p.link.toLowerCase()===newLink.toLowerCase())||(newName&&p.name&&p.name.toLowerCase()===newName.toLowerCase()));
  if(duplicate&&!confirm(`A similar product already exists: ${duplicate.name}. Save another record anyway?`))return;
  const category=$('category').value;products.unshift({id:crypto.randomUUID(),name:newName,link:newLink,category,ownership:$('ownership').value,status:$('status').value,orderDate:$('orderDate').value,deliveryDate:$('deliveryDate').value,targetDate:$('targetDate').value,value:$('value').value,tags:$('tags').value.split(',').map(x=>x.trim()).filter(Boolean),notes:$('notes').value.trim(),pros:$('pros').value.trim(),cons:$('cons').value.trim(),listingText:'',reviewTitle:'',reviewText:'',originalDraft:'',generatedCount:0,submittedAt:'',createdAt:new Date().toISOString(),testingChecklist:buildDefaultChecklist(category),photoChecklist:buildDefaultPhotoChecklist(),reviewHistory:[],reviewLifecycle:''});
  save();e.target.reset();switchView('products');
});

function renderDashboard(){
  const total=products.length;const count=s=>products.filter(p=>p.status===s).length;
  $('statTotal').textContent=total;$('statAwaiting').textContent=count('Awaiting delivery');$('statTesting').textContent=count('Testing');$('statReady').textContent=count('Ready to review');$('statSubmitted').textContent=products.filter(isSubmittedLike).length;const assisted=products.reduce((n,p)=>n+Number(p.generatedCount||0),0);$('statTimeSaved').textContent=assisted?`${assisted*6} min`:'0 min';
  const pct=total?Math.round(products.filter(isSubmittedLike).length/total*100):0;$('completionText').textContent=pct+'%';$('completionBar').style.width=pct+'%';
  const now=new Date();const attention=products.filter(p=>p.targetDate&&!isSubmittedLike(p)&&p.status!=='Archived'&&((new Date(p.targetDate)-now)/86400000)<=3);
  $('attentionList').innerHTML=attention.length?attention.map(p=>`<div class="list-item"><span>${escapeHtml(p.name)}</span><strong>${p.targetDate}</strong></div>`).join(''):'No products need attention.';$('attentionList').classList.toggle('empty',!attention.length);
  renderRollingRates();
  const recent=products.slice(0,5);$('recentList').innerHTML=recent.length?recent.map(p=>`<div class="list-item"><span>${escapeHtml(p.name)}</span><span>${p.status}</span></div>`).join(''):'No products yet.';$('recentList').classList.toggle('empty',!recent.length);
}

function renderProducts(){
  const q=$('searchInput').value.toLowerCase();const sf=$('statusFilter').value;const tf=($('tagFilter')?.value||'').toLowerCase();const smart=$('smartFilter')?.value||'';const now=new Date();const filtered=products.filter(p=>{const tags=(p.tags||[]).join(' ').toLowerCase();let ok=(!q||p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)||tags.includes(q))&&(!sf||p.status===sf)&&(!tf||tags.includes(tf));if(!ok)return false;if(smart==='missing-notes')return !String(p.notes||'').trim();if(smart==='testing-14'){const d=parseDate(p.deliveryDate||p.createdAt);return p.status==='Testing'&&d&&(now-d)/86400000>=14;}if(smart==='ready')return p.status==='Ready to review';if(smart==='review-now')return smartBucket(p)==='Review Now';if(smart==='test-today')return smartBucket(p)==='Test Today';if(smart==='submitted-30'){const d=parseDate(p.submittedAt);return d&&(now-d)/86400000<=30;}return true;});
  const wrap=$('productsList');wrap.innerHTML='';if(!filtered.length){wrap.innerHTML='<div class="panel muted">No matching products.</div>';return;}
  filtered.forEach(p=>{
    const node=$('productCardTemplate').content.cloneNode(true);
    node.querySelector('.product-card').dataset.id=p.id;
    node.querySelector('.status-pill').textContent=p.status;node.querySelector('.product-name').textContent=p.name;node.querySelector('.product-meta').textContent=[p.category,p.targetDate?`Target ${p.targetDate}`:'No target date',p.value?`£${Number(p.value).toFixed(2)}`:'',p.ownership?`Ownership: ${p.ownership}`:'',p.amazonStatusText?`Amazon: ${p.amazonStatusText}`:''].filter(Boolean).join(' • ');node.querySelector('.product-notes').innerHTML=(p.notes?escapeHtml(p.notes):'No testing notes yet.')+((p.tags||[]).length?'<div>'+p.tags.map(t=>`<span class="tag-chip">${escapeHtml(t)}</span>`).join('')+'</div>':'');
    const sel=node.querySelector('.status-select');statuses.forEach(s=>{const o=document.createElement('option');o.value=o.textContent=s;o.selected=s===p.status;sel.appendChild(o)});sel.onchange=()=>{p.status=sel.value;if(['Draft ready','Submitted','Pending approval','Approved','Rejected','Needs resubmission'].includes(p.status)){p.reviewLifecycle=p.status;if(p.status==='Submitted'&&!p.submittedAt)p.submittedAt=new Date().toISOString();appendReviewHistory(p,p.status,'Status changed from My Products');}save();};
    node.querySelector('.review-btn').onclick=()=>loadReviewProduct(p.id,true);
    const link=node.querySelector('.amazon-link');if(p.link)link.href=p.link;else link.style.display='none';
    node.querySelector('.delete-btn').onclick=()=>{if(confirm('Delete this product?')){products=products.filter(x=>x.id!==p.id);save();}};
    wrap.appendChild(node);
  });
}

function renderReviewProducts(){
  const select=$('reviewProduct');const current=select.value;select.innerHTML='<option value="">Choose a product</option>';
  products.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.appendChild(o)});
  if(products.some(p=>p.id===current))select.value=current;
}
function renderAll(){renderDashboard();renderProducts();renderReviewProducts();renderActivity();updateAmazonReviewButton();checkLocalReminders();}
function selectedReviewProduct(){return products.find(p=>p.id===$('reviewProduct').value);}
function updateAmazonReviewButton(){
  const btn=$('openAmazonReview');
  if(!btn)return;
  const p=selectedReviewProduct();
  btn.disabled=!(p&&p.link);
  btn.title=p&&p.link?'Open the saved Amazon page in a new tab':'Add and save an Amazon product link first';
}


function parseDate(value){
  if(!value)return null;
  const d=new Date(value.length===10?value+'T12:00:00':value);
  return Number.isNaN(d.getTime())?null:d;
}
function startOfWeek(date){const d=new Date(date);const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d;}
function isoDay(date){return date.toISOString().slice(0,10);}
function weekLabel(date){return date.toLocaleDateString(undefined,{day:'numeric',month:'short'});}
function activityBuckets(weeks=8){
  const now=startOfWeek(new Date());
  return Array.from({length:weeks},(_,i)=>{const start=new Date(now);start.setDate(start.getDate()-(weeks-1-i)*7);const end=new Date(start);end.setDate(end.getDate()+7);return {start,end,label:weekLabel(start),added:0,submitted:0};}).map(bucket=>{
    products.forEach(p=>{
      const created=parseDate(p.createdAt||p.orderDate);if(created&&created>=bucket.start&&created<bucket.end)bucket.added++;
      const submitted=parseDate(p.submittedAt||(isSubmittedLike(p)?p.targetDate:null));if(submitted&&submitted>=bucket.start&&submitted<bucket.end)bucket.submitted++;
    });return bucket;
  });
}
function renderBarChart(target,buckets,compact=false){
  if(!target)return;const max=Math.max(1,...buckets.flatMap(b=>[b.added,b.submitted]));
  target.innerHTML=buckets.map(b=>`<div class="chart-column" title="Week of ${b.label}: ${b.added} added, ${b.submitted} submitted"><div class="bar-pair"><span class="bar added" style="height:${Math.max(b.added?8:0,b.added/max*100)}%"></span><span class="bar submitted" style="height:${Math.max(b.submitted?8:0,b.submitted/max*100)}%"></span></div>${compact?'':`<small>${b.label}</small>`}</div>`).join('');
}
function renderActivity(){
  renderBarChart($('miniActivityChart'),activityBuckets(6),true);
  renderBarChart($('activityChart'),activityBuckets(8),false);
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const thisMonth=d=>d&&d.getMonth()===month&&d.getFullYear()===year;
  const added=products.filter(p=>thisMonth(parseDate(p.createdAt||p.orderDate))).length;
  const submitted=products.filter(p=>isSubmittedLike(p)&&thisMonth(parseDate(p.submittedAt||p.targetDate))).length;
  const pending=products.filter(p=>!isSubmittedLike(p)&&p.status!=='Archived').length;
  const durations=products.map(p=>{const a=parseDate(p.deliveryDate),b=parseDate(p.submittedAt);return a&&b&&b>=a?Math.round((b-a)/86400000):null;}).filter(v=>v!==null);
  if($('activityAdded'))$('activityAdded').textContent=added;
  if($('activitySubmitted'))$('activitySubmitted').textContent=submitted;
  if($('activityPending'))$('activityPending').textContent=pending;
  if($('activityAverage'))$('activityAverage').textContent=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0;
  renderCalendar();renderReminderList();
}
function renderCalendar(){
  const el=$('calendarList');if(!el)return;const range=$('calendarRange')?.value||'30';const now=new Date();now.setHours(0,0,0,0);
  const items=products.filter(p=>p.targetDate&&!isSubmittedLike(p)&&p.status!=='Archived').map(p=>({...p,date:parseDate(p.targetDate)})).filter(p=>p.date).filter(p=>range==='all'||p.date-now<=Number(range)*86400000).sort((a,b)=>a.date-b.date);
  el.innerHTML=items.length?items.map(p=>{const days=Math.ceil((p.date-now)/86400000);const label=days<0?`${Math.abs(days)} day${Math.abs(days)!==1?'s':''} overdue`:days===0?'Due today':days===1?'Due tomorrow':`Due in ${days} days`;return `<div class="calendar-item ${days<0?'overdue':days<=3?'soon':''}"><div class="calendar-date"><strong>${p.date.getDate()}</strong><span>${p.date.toLocaleDateString(undefined,{month:'short'})}</span></div><div><strong>${escapeHtml(p.name)}</strong><p>${escapeHtml(p.status)} • ${label}</p></div><button class="link-btn calendar-review" data-id="${p.id}">Open</button></div>`;}).join(''):'<p class="muted">No upcoming target dates.</p>';
  el.querySelectorAll('.calendar-review').forEach(btn=>btn.onclick=()=>loadReviewProduct(btn.dataset.id,true));
}
function reminderMessages(){
  const now=new Date();now.setHours(0,0,0,0);const messages=[];
  const pending=products.filter(p=>!isSubmittedLike(p)&&p.status!=='Archived');
  const ready=pending.filter(p=>p.status==='Ready to review');if(ready.length)messages.push(`${ready.length} product${ready.length!==1?'s are':' is'} ready to review.`);
  const overdue=pending.filter(p=>{const d=parseDate(p.targetDate);return d&&d<now;});if(overdue.length)messages.push(`${overdue.length} target review date${overdue.length!==1?'s are':' is'} overdue.`);
  const stale=pending.filter(p=>{const d=parseDate(p.deliveryDate||p.createdAt);return d&&(now-d)/86400000>=14&&p.status!=='Ready to review';});if(stale.length)messages.push(`${stale.length} product${stale.length!==1?'s have':' has'} been open for at least 14 days.`);
  if(pending.length)messages.push(`${pending.length} review${pending.length!==1?'s are':' is'} still pending.`);
  return messages;
}
function renderReminderList(){const el=$('reminderList');if(!el)return;const msgs=reminderMessages();el.innerHTML=msgs.length?msgs.map(m=>`<div class="list-item"><span>${escapeHtml(m)}</span></div>`).join(''):'<p class="muted">Nothing needs a reminder.</p>';}
async function enableNotifications(){
  if(!('Notification' in window)){alert('Browser notifications are not supported here. The in-app reminder list will still work.');return;}
  const permission=await Notification.requestPermission();
  localStorage.setItem(storageKey('notifications'),permission);
  alert(permission==='granted'?'Browser reminders enabled. Keep VineTrack open to receive them.':'Notifications were not enabled. In-app reminders remain available.');
}
function checkLocalReminders(){
  if(!('Notification' in window)||window.Notification.permission!=='granted')return;
  const msgs=reminderMessages();if(!msgs.length)return;
  const today=new Date().toISOString().slice(0,10);if(localStorage.getItem(storageKey('last_notification'))===today)return;
  new window.Notification('VineTrack reminder',{body:msgs.slice(0,2).join(' ')});localStorage.setItem(storageKey('last_notification'),today);
}

$('searchInput').oninput=renderProducts;$('statusFilter').onchange=renderProducts;$('tagFilter').oninput=renderProducts;$('smartFilter').onchange=renderProducts;

function rollingRate(days){
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
  const relevant=products.filter(p=>{const d=parseDate(p.deliveryDate||p.createdAt||p.orderDate);return d&&d>=cutoff;});
  const submitted=relevant.filter(p=>isSubmittedLike(p)).length;
  return {total:relevant.length,submitted,pct:relevant.length?Math.round(submitted/relevant.length*100):0};
}
function rateLabel(v){if(!v.total)return 'No activity';if(v.pct>=80)return 'Healthy';if(v.pct>=60)return 'Needs attention';return 'At risk';}
function renderRollingRates(){[30,60,90].forEach(days=>{const v=rollingRate(days);const a=$('rate'+days),b=$('rate'+days+'Label');if(a)a.textContent=v.pct+'%';if(b)b.textContent=`${rateLabel(v)} • ${v.submitted}/${v.total}`;});}
function reviewQuality(){
  const text=$('reviewOutput')?.value.trim()||'';const tested=$('reviewTested')?.value.trim()||'';const pros=$('reviewPros')?.value.trim()||'';const cons=$('reviewCons')?.value.trim()||'';const accuracy=$('reviewAccuracy')?.value.trim()||'';const audience=$('reviewAudience')?.value.trim()||'';let score=0;const tips=[];
  if(tested.length>=30)score+=25;else tips.push('Add a specific test method or usage period.');
  if(pros.length>=15)score+=20;else tips.push('Add at least one specific positive observation.');
  if(cons.length>=10)score+=15;else tips.push('Mention a limitation when one was genuinely observed.');
  if(accuracy.length>=10)score+=15;else tips.push('State whether the listing matched the received product.');
  if(audience.length>=3)score+=10;else tips.push('Say who the product may suit.');
  if(text.split(/\s+/).filter(Boolean).length>=40)score+=10;else tips.push('The review may be too short to explain the experience clearly.');
  if(!/(seller|delivery driver|courier|refund|customer service)/i.test(text))score+=5;else tips.push('Keep seller, delivery and customer-service issues out of the product review.');
  return {score:Math.min(100,score),tips};
}
function updateReviewMetrics(){
  const text=$('reviewOutput')?.value||'';const words=text.trim()?text.trim().split(/\s+/).length:0;const chars=text.length;const mins=words?Math.max(1,Math.ceil(words/220)):0;const q=reviewQuality();
  if($('wordCount'))$('wordCount').textContent=words;if($('charCount'))$('charCount').textContent=chars;if($('readingTime'))$('readingTime').textContent=mins+' min';if($('qualityScore'))$('qualityScore').textContent=q.score+'/100';if($('qualityTips'))$('qualityTips').textContent=q.tips.length?q.tips.slice(0,3).join(' '):'Review looks well supported by the details you entered.';
}
function listingClaims(text){
  return String(text||'')
    .split(/\n|•|;|\|/)
    .map(s=>s.replace(/^[-–—*\d.()\s]+/,'').trim())
    .filter(s=>s.length>2)
    .slice(0,8);
}
function prepareFieldsFromListing(){
  const p=selectedReviewProduct();
  const raw=$('reviewListing').value.trim();
  if(!p){alert('Choose a saved product first.');return;}
  if(!raw){alert('Paste the listing title and key feature bullets first.');return;}
  const claims=listingClaims(raw);
  if(!claims.length){alert('I could not identify any listing features. Put each feature on a new line or separate them with semicolons.');return;}
  p.listingText=raw;
  const featureText=claims.map(c=>`• Test whether the listing claim “${c}” matches your actual use.`).join('\n');
  if(!$('reviewTested').value.trim()) $('reviewTested').value=`Use the product in normal conditions and check the following:\n${featureText}\n• Note setup, ease of use, build quality, performance, comfort or fit where relevant, and any safety or instruction issues.`;
  if(!$('reviewPros').value.trim()) $('reviewPros').value=claims.slice(0,5).map(c=>`After testing, note whether “${c}” worked well and give a specific example.`).join('\n');
  if(!$('reviewCons').value.trim()) $('reviewCons').value=claims.slice(0,5).map(c=>`After testing, note any limitation or difference related to “${c}”.`).join('\n');
  if(!$('reviewAccuracy').value.trim()) $('reviewAccuracy').value=`Compare the received product with these listing claims: ${claims.join('; ')}. Replace this prompt with what genuinely matched and what differed.`;
  save();
  alert('Neutral testing prompts were prepared from the pasted listing. Replace them with your genuine observations before generating a review.');
}
$('prepareFromListing').onclick=prepareFieldsFromListing;


function loadReviewProduct(id,go=false){
  const p=products.find(x=>x.id===id);if(!p)return;
  $('reviewProduct').value=p.id;$('reviewListing').value=p.listingText||'';$('reviewTested').value=p.notes||'';$('reviewPros').value=p.pros||'';$('reviewCons').value=p.cons||'';$('reviewTitleOutput').value=p.reviewTitle||'';$('reviewOutput').value=p.reviewText||'';$('originalDraft').value=p.originalDraft||p.reviewText||'';
  updateAmazonReviewButton();updateReviewMetrics();updateDraftComparison();updateReviewGuide();
  if(go)switchView('review');
}
$('reviewProduct').onchange=e=>{if(e.target.value)loadReviewProduct(e.target.value);else{updateAmazonReviewButton();updateReviewGuide();}};

function cleanSentence(text){const t=String(text||'').trim().replace(/\s+/g,' ');if(!t)return'';return /[.!?]$/.test(t)?t:t+'.';}
function sentenceList(text){return String(text||'').split(/\n|;|\.(?=\s|$)/).map(s=>s.trim()).filter(Boolean);}
function joinNatural(items){if(!items.length)return'';if(items.length===1)return items[0];if(items.length===2)return items[0]+' and '+items[1];return items.slice(0,-1).join(', ')+', and '+items.at(-1);}
function titleCaseStart(text){
  const t=String(text||'').trim().replace(/[.!?]+$/,'');
  return t?t.charAt(0).toUpperCase()+t.slice(1):'';
}
function titlePhrase(text){
  let t=String(text||'').trim()
    .replace(/^[•\-–—*\d.)\s]+/,'')
    .replace(/^(after testing,?\s*(note|check)\s*(whether|any)?|i (found|liked|noticed|thought|felt|would say)|the (main )?(positive|advantage|benefit|drawback|negative|limitation)s? (was|were|is|are)|this product (is|was|has)|it (is|was|has))\s*/i,'')
    .replace(/[.!?]+$/,'')
    .replace(/\s+/g,' ');
  if(!t || /replace this prompt|test whether|give a specific example|note any limitation/i.test(t)) return '';
  const words=t.split(' ');
  if(words.length>10)t=words.slice(0,10).join(' ');
  return t.charAt(0).toUpperCase()+t.slice(1);
}
function productType(name,listing){
  const raw=String(name||'').trim() || String(listing||'').split(/[;\n]/)[0].trim();
  if(!raw)return 'product';
  const cleaned=raw.replace(/\b(amazon|vine|new|premium|professional|official|202[0-9])\b/gi,'').replace(/\s+/g,' ').trim();
  const words=cleaned.split(' ').filter(Boolean);
  return words.slice(-3).join(' ') || 'product';
}
function sentenceCase(text){const t=String(text||'').trim();return t?t.charAt(0).toLowerCase()+t.slice(1):'';}
function makeTitle(pros,cons,rating,name,listing){
  const firstPro=titlePhrase(sentenceList(pros)[0]);
  const firstCon=titlePhrase(sentenceList(cons)[0]);
  const item=productType(name,listing);
  const stars=Number(rating);
  let title='';
  if(stars===5){
    title=firstPro?firstPro:`Excellent ${item} that delivers as expected`;
  }else if(stars===4){
    title=firstPro&&firstCon?`${firstPro}, but ${sentenceCase(firstCon)}`:firstPro?`${firstPro}, with minor room for improvement`:`A very good ${item} with small limitations`;
  }else if(stars===3){
    title=firstPro&&firstCon?`${firstPro}, but ${sentenceCase(firstCon)}`:firstCon?`Useful ${item}, but ${sentenceCase(firstCon)}`:`A mixed but generally useful experience`;
  }else if(stars===2){
    title=firstCon?`Useful idea, but ${sentenceCase(firstCon)}`:`This ${item} needs significant improvement`;
  }else if(stars===1){
    title=firstCon?`Disappointing because ${sentenceCase(firstCon)}`:`This ${item} did not meet expectations`;
  }else if(firstPro&&firstCon){
    title=`${firstPro}, but ${sentenceCase(firstCon)}`;
  }else title=firstPro||firstCon||`My experience with this ${item}`;
  title=title.replace(/\s+/g,' ').replace(/\s+,/g,',').trim();
  if(title.length>80) title=title.slice(0,77).replace(/\s+\S*$/,'')+'…';
  return titleCaseStart(title);
}
function generateDraft(){
  const tested=$('reviewTested').value.trim(),pros=$('reviewPros').value.trim(),cons=$('reviewCons').value.trim(),accuracy=$('reviewAccuracy').value.trim(),audience=$('reviewAudience').value.trim(),tone=$('reviewTone').value,length=$('reviewLength').value,rating=$('reviewRating').value;
  if(!tested&&!pros&&!cons){alert('Please add genuine testing notes, pros, or cons first.');return;}
  const product=products.find(p=>p.id===$('reviewProduct').value);const name=product?.name||'this product';
  const introBase=tested?`I tested ${name} by ${tested.charAt(0).toLowerCase()+tested.slice(1)}`:`I used ${name} in normal day-to-day conditions`;
  let parts=[cleanSentence(introBase)];
  const proItems=sentenceList(pros),conItems=sentenceList(cons);
  if(proItems.length){const prefix=tone==='friendly'?'What I liked most was ':'The main positives were ';parts.push(cleanSentence(prefix+joinNatural(proItems.map(x=>x.replace(/[.!?]+$/,'')))));}
  if(conItems.length){const prefix=tone==='concise'?'Limitations: ':'There were also a few limitations: ';parts.push(cleanSentence(prefix+joinNatural(conItems.map(x=>x.replace(/[.!?]+$/,'')))));}
  if(accuracy)parts.push(cleanSentence('The product listing was '+accuracy.charAt(0).toLowerCase()+accuracy.slice(1)));
  if(audience)parts.push(cleanSentence(`I think it would be most suitable for ${audience}`));
  if(rating)parts.push(cleanSentence(`Based on my own experience, I chose ${rating} out of 5 stars`));
  if(length==='short')parts=parts.slice(0,3);
  if(length==='detailed'&&tested)parts.splice(1,0,'I focused on practical performance, ease of use, and whether the item matched the description.');
  $('reviewTitleOutput').value=makeTitle(pros,cons,rating,name,$('reviewListing').value);
  $('reviewOutput').value=parts.join('\n\n');
  $('originalDraft').value=$('reviewOutput').value;const current=selectedReviewProduct();if(current){current.originalDraft=$('reviewOutput').value;current.generatedCount=Number(current.generatedCount||0)+1;}
  updateAmazonReviewButton();updateReviewMetrics();updateDraftComparison();
}
$('generateReview').onclick=generateDraft;['reviewOutput','reviewTested','reviewPros','reviewCons','reviewAccuracy','reviewAudience'].forEach(id=>$(id).addEventListener('input',()=>{updateReviewMetrics();updateReviewGuide();}));
$('copyReview').onclick=async()=>{const text=[$('reviewTitleOutput').value,$('reviewOutput').value].filter(Boolean).join('\n\n');if(!text){alert('Generate a draft first.');return;}try{await navigator.clipboard.writeText(text);alert('Review copied.');}catch{alert('Copy failed. Select and copy the text manually.');}};
$('saveReview').onclick=()=>{const p=products.find(x=>x.id===$('reviewProduct').value);if(!p){alert('Select a saved product first.');return;}p.listingText=$('reviewListing').value.trim();p.notes=$('reviewTested').value.trim();p.pros=$('reviewPros').value.trim();p.cons=$('reviewCons').value.trim();p.reviewTitle=$('reviewTitleOutput').value.trim();p.reviewText=$('reviewOutput').value.trim();p.originalDraft=$('originalDraft').value||p.originalDraft||'';p.notes=$('reviewTested').value.trim();p.pros=$('reviewPros').value.trim();p.cons=$('reviewCons').value.trim();if(!isSubmittedLike(p)){p.status='Draft ready';p.reviewLifecycle='Draft ready';}appendReviewHistory(p,p.reviewLifecycle||'Draft ready','Draft saved');save();alert('Draft saved to this product.');};
$('reviewNextProduct').onclick=openNextReviewProduct;

$('openAmazonReview').onclick=()=>{
  const p=selectedReviewProduct();
  if(!p||!p.link){alert('This product does not have a saved Amazon link. Add the link in the product record first.');return;}
  window.open(p.link,'_blank','noopener,noreferrer');
};


$('openVineHome').onclick=()=>window.open('https://www.amazon.co.uk/vine/vine-items','_blank','noopener,noreferrer');
$('openAmazonReviews').onclick=()=>window.open('https://www.amazon.co.uk/gp/profile','_blank','noopener,noreferrer');
$('enableReminders').onclick=enableNotifications;
$('activityReminderBtn').onclick=enableNotifications;
$('calendarRange').onchange=renderCalendar;
$('copyTitle').onclick=async()=>{const text=$('reviewTitleOutput').value.trim();if(!text){alert('Generate a title first.');return;}try{await navigator.clipboard.writeText(text);alert('Title copied.');}catch{alert('Copy failed. Select and copy the title manually.');}};
$('markSubmitted').onclick=()=>{const p=selectedReviewProduct();if(!p){alert('Select a saved product first.');return;}p.listingText=$('reviewListing').value.trim();p.notes=$('reviewTested').value.trim();p.pros=$('reviewPros').value.trim();p.cons=$('reviewCons').value.trim();p.reviewTitle=$('reviewTitleOutput').value.trim();p.reviewText=$('reviewOutput').value.trim();p.originalDraft=$('originalDraft').value||p.originalDraft||'';p.status='Submitted';p.reviewLifecycle='Submitted';p.submittedAt=new Date().toISOString();appendReviewHistory(p,'Submitted','Marked submitted from Review Assistant');save();updateReviewGuide();alert('Marked as submitted and saved to review history.');};

$('exportBtn').onclick=()=>{const headers=['Product Name','Amazon Link','Category','Tags','Ownership','Status','Order Date','Delivery Date','Target Review Date','Value','Testing Notes','Pros','Cons','Review Title','Review Draft'];const rows=products.map(p=>[p.name,p.link,p.category,(p.tags||[]).join('; '),p.ownership||'',p.status,p.orderDate,p.deliveryDate,p.targetDate,p.value,p.notes,p.pros,p.cons,p.reviewTitle,p.reviewText]);const csv=[headers,...rows].map(r=>r.map(v=>'"'+String(v||'').replaceAll('"','""')+'"').join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vinetrack-products.csv';a.click();URL.revokeObjectURL(a.href);};

$('demoDataBtn').onclick=()=>{if(products.length&&!confirm('Add demo data to your existing records?'))return;products=[{id:crypto.randomUUID(),name:'Portable desk lamp',link:'https://www.amazon.co.uk/',category:'Office',status:'Testing',orderDate:'2026-07-20',deliveryDate:'2026-07-22',targetDate:'2026-08-02',value:'19.99',notes:'using it for five evenings at my desk, checking brightness levels, battery life and clamp stability',pros:'Bright at the highest setting; compact design; clamp stayed secure',cons:'The charging cable is shorter than expected',listingText:'',listingText:'',reviewTitle:'',reviewText:'',submittedAt:'',createdAt:new Date().toISOString()},{id:crypto.randomUUID(),name:'Silicone baking mat',link:'https://www.amazon.co.uk/',category:'Kitchen',status:'Ready to review',orderDate:'2026-07-18',deliveryDate:'2026-07-20',targetDate:'2026-07-31',value:'8.99',notes:'using it for cookies and roasted vegetables',pros:'Easy to clean; food released without sticking',cons:'There was a slight smell on first use',listingText:'',listingText:'',reviewTitle:'',reviewText:'',submittedAt:'',createdAt:new Date().toISOString()},{id:crypto.randomUUID(),name:'Cable organiser clips',link:'https://www.amazon.co.uk/',category:'Electronics',status:'Submitted',orderDate:'2026-07-10',deliveryDate:'2026-07-12',targetDate:'2026-07-20',value:'6.99',notes:'testing them on a desk and bedside table',pros:'Good adhesive; easy to position',cons:'Very thin cables can slip',listingText:'',listingText:'',reviewTitle:'',reviewText:'',submittedAt:'',createdAt:new Date().toISOString()}];save();};


$('backupData').onclick=()=>{const payload={version:8,exportedAt:new Date().toISOString(),products,settings:JSON.parse(localStorage.getItem(SETTINGS)||'{}')};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vinetrack-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);};
$('restoreData').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.products))throw new Error('Invalid backup');if(!confirm(`Restore ${data.products.length} products? This replaces current local data.`))return;products=data.products;localStorage.setItem(KEY,JSON.stringify(products));if(data.settings)localStorage.setItem(SETTINGS,JSON.stringify(data.settings));if(data.savedFilters)localStorage.setItem(FILTERS_KEY,JSON.stringify(data.savedFilters));if(data.ui)localStorage.setItem(UI_KEY,JSON.stringify(data.ui));if(data.health)localStorage.setItem(HEALTH_KEY,JSON.stringify(data.health));if(data.feedback)localStorage.setItem(FEEDBACK_KEY,JSON.stringify(data.feedback));loadV11Settings();applyUi();renderAll();alert('Backup restored.');}catch(err){alert('Could not restore this backup file.');}finally{e.target.value='';}};
const settings=JSON.parse(localStorage.getItem(SETTINGS)||'{}');const accountUser=window.VINETRACK_AUTH?.user||{};$('userName').value=settings.name||accountUser.name||'';$('userEmail').value=settings.email||accountUser.email||'';$('saveSettings').onclick=()=>{const old=JSON.parse(localStorage.getItem(SETTINGS)||'{}');localStorage.setItem(SETTINGS,JSON.stringify({...old,name:$('userName').value.trim(),email:$('userEmail').value.trim()}));alert('Settings saved.');};$('clearData').onclick=()=>{if(confirm('Delete all VineTrack data from this browser?')){products=[];localStorage.removeItem(KEY);localStorage.removeItem(OLD_KEY);save();}};
function escapeHtml(s){return String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
products=products.map(p=>({...p,status:p.status==='Review submitted'?'Submitted':(p.status||'Ordered'),tags:Array.isArray(p.tags)?p.tags:[],ownership:p.ownership||'',originalDraft:p.originalDraft||'',generatedCount:Number(p.generatedCount||0),reviewHistory:Array.isArray(p.reviewHistory)?p.reviewHistory:[]}));

// VineTrack v9 local-only enhancements
const FILTERS_KEY=storageKey('saved_filters_v1');
const UI_KEY=storageKey('ui_v1');
const templates={
 electronics:{notes:'Test setup, charging, battery life, controls, connectivity, performance, heat, sound and build quality.',pros:'Record specific strengths such as reliable connection, useful controls, battery performance or sturdy construction.',cons:'Record genuine limitations such as unclear instructions, weak range, short cable, noise, heat or inconsistent operation.'},
 kitchen:{notes:'Test normal cooking or preparation, capacity, stability, handling, cleaning, storage and material quality.',pros:'Record specific strengths such as even results, easy cleaning, comfortable handling or accurate capacity.',cons:'Record genuine limitations such as staining, difficult cleaning, weak handles, inaccurate sizing or storage problems.'},
 clothing:{notes:'Test fit, comfort, material feel, stitching, movement, sizing accuracy and washing results where appropriate.',pros:'Record specific strengths such as accurate fit, comfort, good stitching or fabric quality.',cons:'Record genuine limitations such as sizing differences, shrinkage, loose stitching, transparency or discomfort.'},
 beauty:{notes:'Test packaging, instructions, ease of application, texture, scent, comfort and normal short-term performance. Avoid medical claims.',pros:'Record specific strengths such as easy application, pleasant texture, secure packaging or clear instructions.',cons:'Record genuine limitations such as awkward packaging, strong scent, residue, unclear directions or poor value.'},
 home:{notes:'Test setup, dimensions, stability, build quality, ease of use, cleaning, storage and whether it suits the intended space.',pros:'Record specific strengths such as sturdy design, convenient size, easy setup or practical storage.',cons:'Record genuine limitations such as unstable parts, misleading dimensions, difficult assembly or awkward storage.'}
};
function showDuplicateWarning(){const name=$('name').value.trim().toLowerCase(),link=$('link').value.trim().toLowerCase();const hit=products.find(p=>(link&&String(p.link||'').toLowerCase()===link)||(name&&String(p.name||'').toLowerCase()===name));const box=$('duplicateWarning');if(hit){box.hidden=false;box.textContent=`Possible duplicate: “${hit.name}” is already saved (${hit.status}).`;}else box.hidden=true;}
$('name').addEventListener('input',showDuplicateWarning);$('link').addEventListener('input',showDuplicateWarning);
$('applyTemplate').onclick=()=>{const key=$('testingTemplate').value;const t=templates[key];if(!t){alert('Choose a testing template first.');return;}const categoryMap={electronics:'Electronics',kitchen:'Kitchen',clothing:'Clothing',beauty:'Beauty',home:'Home'};if(categoryMap[key])$('category').value=categoryMap[key];if(!$('notes').value.trim()||confirm('Replace the current testing notes with this template?'))$('notes').value=t.notes;if(!$('pros').value.trim()||confirm('Replace the current pros prompt?'))$('pros').value=t.pros;if(!$('cons').value.trim()||confirm('Replace the current cons prompt?'))$('cons').value=t.cons;refreshTestPackPreview();};
function loadSavedFilters(){const select=$('savedFilter');const items=JSON.parse(localStorage.getItem(FILTERS_KEY)||'[]');select.innerHTML='<option value="">Saved filters</option>'+items.map((f,i)=>`<option value="${i}">${escapeHtml(f.name)}</option>`).join('');}
$('saveCurrentFilter').onclick=()=>{const name=prompt('Name this filter:');if(!name)return;const items=JSON.parse(localStorage.getItem(FILTERS_KEY)||'[]');items.push({name,status:$('statusFilter').value,smart:$('smartFilter').value,tag:$('tagFilter').value,search:$('searchInput').value});localStorage.setItem(FILTERS_KEY,JSON.stringify(items));loadSavedFilters();};
$('savedFilter').onchange=e=>{if(e.target.value==='')return;const f=JSON.parse(localStorage.getItem(FILTERS_KEY)||'[]')[Number(e.target.value)];if(!f)return;$('statusFilter').value=f.status||'';$('smartFilter').value=f.smart||'';$('tagFilter').value=f.tag||'';$('searchInput').value=f.search||'';renderProducts();};
$('deleteSavedFilter').onclick=()=>{const idx=$('savedFilter').value;if(idx===''){alert('Choose a saved filter first.');return;}const items=JSON.parse(localStorage.getItem(FILTERS_KEY)||'[]');items.splice(Number(idx),1);localStorage.setItem(FILTERS_KEY,JSON.stringify(items));loadSavedFilters();};
function normaliseWords(text){return String(text||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(Boolean);}
function updateDraftComparison(){const original=$('originalDraft')?.value||'';const finalText=$('reviewOutput')?.value||'';$('finalReviewMirror').value=finalText;if(!original){$('editPercent').textContent='0% changed';return;}const a=normaliseWords(original),b=normaliseWords(finalText);const max=Math.max(a.length,b.length,1);let same=0;const counts={};a.forEach(w=>counts[w]=(counts[w]||0)+1);b.forEach(w=>{if(counts[w]){same++;counts[w]--;}});const changed=Math.round((1-same/max)*100);$('editPercent').textContent=`${Math.max(0,changed)}% changed`; }
$('reviewOutput').addEventListener('input',updateDraftComparison);
function applyUi(){const ui=JSON.parse(localStorage.getItem(UI_KEY)||'{}');$('appearance').value=ui.appearance||'light';$('density').value=ui.density||'comfortable';let dark=ui.appearance==='dark'||(ui.appearance==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.body.classList.toggle('dark-theme',dark);document.body.classList.toggle('compact-density',ui.density==='compact');document.body.classList.toggle('large-density',ui.density==='large');}
$('appearance').onchange=$('density').onchange=()=>{localStorage.setItem(UI_KEY,JSON.stringify({appearance:$('appearance').value,density:$('density').value}));applyUi();};
const oldSaveSettings=$('saveSettings').onclick;$('saveSettings').onclick=()=>{oldSaveSettings();localStorage.setItem(UI_KEY,JSON.stringify({appearance:$('appearance').value,density:$('density').value}));applyUi();};
const oldBackup=$('backupData').onclick;$('backupData').onclick=()=>{const payload={version:13,exportedAt:new Date().toISOString(),products,settings:JSON.parse(localStorage.getItem(SETTINGS)||'{}'),savedFilters:JSON.parse(localStorage.getItem(FILTERS_KEY)||'[]'),ui:JSON.parse(localStorage.getItem(UI_KEY)||'{}'),health:JSON.parse(localStorage.getItem(HEALTH_KEY)||'{}'),feedback:JSON.parse(localStorage.getItem(FEEDBACK_KEY)||'[]')};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='vinetrack-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);};
loadSavedFilters();applyUi();updateDraftComparison();

// VineTrack v11 paid-value preview enhancements
const HEALTH_KEY=storageKey('health_v1');
const FEEDBACK_KEY=storageKey('inapp_feedback_v1');
const PLUS_FEATURES=new Set(['review-health','smart-queue','testing-packs','review-history','guided-session','advanced-analytics']);
function currentPlan(){try{return JSON.parse(localStorage.getItem(SETTINGS)||'{}').plan||'beta'}catch{return 'beta'}}
function hasFeature(feature){return currentPlan()==='beta'||currentPlan()==='plus'||!PLUS_FEATURES.has(feature);}
const DEFAULT_PHOTOS=['Packaging','Product overview','Size / scale','Feature in use','Problem / defect (if any)'];
const TESTING_PACKS={
  Electronics:['Setup and instructions','Charging / battery life','Controls and connectivity','Performance in normal use','Heat, sound and build quality'],
  Kitchen:['Normal cooking / preparation','Capacity and sizing','Stability and handling','Cleaning after use','Material quality and storage'],
  Beauty:['Packaging and instructions','Application and texture','Scent and comfort','Normal short-term performance','Residue, cleanup and value'],
  Clothing:['Fit and sizing accuracy','Comfort and movement','Material feel','Stitching / construction','Washing result where appropriate'],
  Home:['Setup or assembly','Dimensions and fit for space','Stability and build quality','Ease of daily use','Cleaning and storage'],
  Office:['Setup and ergonomics','Dimensions and desk fit','Controls / adjustability','Daily-use durability','Storage and cable management'],
  Other:['Setup and instructions','Main advertised function','Ease of normal use','Build / material quality','Any limitations or unexpected behaviour']
};
function buildDefaultChecklist(category){return (TESTING_PACKS[category]||TESTING_PACKS.Other).map(label=>({label,done:false}));}
function buildDefaultPhotoChecklist(){return DEFAULT_PHOTOS.map(label=>({label,done:false}));}
function normaliseChecklist(items,fallback){if(Array.isArray(items)&&items.length)return items.map(x=>typeof x==='string'?{label:x,done:false}:{label:String(x.label||''),done:!!x.done}).filter(x=>x.label);return fallback();}
function normaliseProduct(p){
  const status=p.status==='Review submitted'?'Submitted':(p.status||'Ordered');
  return {...p,status,category:p.category||'Other',name:p.name||'Untitled product',tags:Array.isArray(p.tags)?p.tags:[],ownership:p.ownership||'',originalDraft:p.originalDraft||'',generatedCount:Number(p.generatedCount||0),testingChecklist:normaliseChecklist(p.testingChecklist,()=>buildDefaultChecklist(p.category||'Other')),photoChecklist:normaliseChecklist(p.photoChecklist,buildDefaultPhotoChecklist),reviewHistory:Array.isArray(p.reviewHistory)?p.reviewHistory:[],reviewLifecycle:p.reviewLifecycle||(status==='Submitted'?'Submitted':status==='Approved'?'Approved':'')};
}
function isSubmittedLike(p){return ['Submitted','Pending approval','Approved'].includes(p?.status);}
function isClosed(p){return isSubmittedLike(p)||p?.status==='Archived';}
function daysSince(value){const d=parseDate(value);if(!d)return 0;return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));}
function checklistProgress(items){const total=(items||[]).length,done=(items||[]).filter(x=>x.done).length;return {done,total,pct:total?Math.round(done/total*100):0};}
function targetUrgency(p){const d=parseDate(p.targetDate);if(!d)return 0;const days=Math.ceil((d-new Date())/86400000);if(days<0)return 35;if(days<=3)return 25;if(days<=7)return 12;return 0;}
function smartScore(p){
  if(p.status==='Archived'||p.status==='Approved'||p.status==='Pending approval'||p.status==='Submitted')return -999;
  let score=0;
  if(['Rejected','Needs resubmission'].includes(p.status))score+=140;
  if(p.status==='Draft ready')score+=120;
  if(p.status==='Ready to review')score+=110;
  if(p.status==='Testing')score+=55;
  if(p.status==='Awaiting delivery')score+=10;
  score+=Math.min(45,daysSince(p.deliveryDate||p.createdAt)*2);
  score+=targetUrgency(p);
  const tp=checklistProgress(p.testingChecklist);if(tp.total&&tp.done===tp.total)score+=25;
  if(String(p.notes||'').trim().length>=25)score+=10;
  return score;
}
function smartBucket(p){const s=smartScore(p);if(s<0)return 'Closed';if(['Rejected','Needs resubmission','Draft ready','Ready to review'].includes(p.status)||s>=105)return 'Review Now';if(p.status==='Testing'||s>=55)return 'Test Today';return 'Waiting';}
function smartQueueItems(){return products.filter(p=>smartScore(p)>=0).sort((a,b)=>smartScore(b)-smartScore(a));}
function healthData(){const base={total:0,reviewed:0,target:90,evaluationDate:''};try{return {...base,...JSON.parse(localStorage.getItem(HEALTH_KEY)||'{}')}}catch{return base}}
function renderHealth(){
  if(!$('healthRate'))return;const h=healthData();const total=Math.max(0,Number(h.total)||0),reviewed=Math.max(0,Math.min(total,Number(h.reviewed)||0)),target=Math.max(1,Math.min(100,Number(h.target)||90));const rate=total?Math.round(reviewed/total*100):0;const needed=Math.max(0,Math.ceil(total*target/100)-reviewed);const date=parseDate(h.evaluationDate);const days=date?Math.ceil((date-new Date())/86400000):null;
  $('healthRate').textContent=rate+'%';$('healthReviewed').textContent=reviewed;$('healthReviewedLabel').textContent=`of ${total} items`;$('healthNeeded').textContent=needed;$('healthTargetLabel').textContent=`Target ${target}%`;$('healthBar').style.width=Math.min(100,rate)+'%';
  $('healthStatus').textContent=!total?'Add your Vine figures':rate>=target?'On track':rate>=Math.max(0,target-10)?'Needs attention':'High priority';$('healthStatus').className=rate>=target?'health-good':rate>=Math.max(0,target-10)?'health-warn':'health-risk';
  $('healthDays').textContent=days===null?'—':days<0?`${Math.abs(days)}d overdue`:`${days}d`;$('healthDateLabel').textContent=date?`Evaluation ${date.toLocaleDateString()}`:'No date set';
  $('healthAdvice').textContent=!total?'Enter the totals shown in your Vine evaluation-period dashboard.':needed===0?`You are at or above your selected ${target}% target.`:`Complete about ${needed} of the current outstanding reviews to reach your selected ${target}% target, assuming the item total does not change.`;
}
function renderSmartQueue(){
  const el=$('smartQueue');if(!el)return;const items=smartQueueItems().slice(0,8);if(!items.length){el.innerHTML='<p class="muted">Nothing is waiting for review or testing.</p>';return;}
  const groups=['Review Now','Test Today','Waiting'];el.innerHTML=groups.map(group=>{const rows=items.filter(p=>smartBucket(p)===group);if(!rows.length)return'';return `<div class="queue-group"><h3>${group}</h3>${rows.map(p=>`<button class="queue-row" data-queue-id="${p.id}"><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.status)} • ${daysSince(p.deliveryDate||p.createdAt)} days open</small></span><b>${Math.max(0,smartScore(p))}</b></button>`).join('')}</div>`}).join('');
  el.querySelectorAll('[data-queue-id]').forEach(btn=>btn.onclick=()=>loadReviewProduct(btn.dataset.queueId,true));
}
function renderChecklist(targetId,items,product,type,progressId){
  const el=$(targetId);if(!el)return;const prog=checklistProgress(items);if($(progressId))$(progressId).textContent=`${prog.done}/${prog.total}`;if(!product){el.innerHTML='<span class="muted">Select a product first.</span>';return;}
  el.innerHTML=(items||[]).map((it,i)=>`<label class="check-row"><input type="checkbox" data-check-type="${type}" data-check-index="${i}" ${it.done?'checked':''}><span>${escapeHtml(it.label)}</span></label>`).join('');
  el.querySelectorAll('input').forEach(input=>input.onchange=()=>{const list=type==='test'?product.testingChecklist:product.photoChecklist;list[Number(input.dataset.checkIndex)].done=input.checked;localStorage.setItem(KEY,JSON.stringify(products));renderSmartQueue();const p=checklistProgress(list);if($(progressId))$(progressId).textContent=`${p.done}/${p.total}`;updateReviewGuide();});
}
function renderReviewPrep(){const p=selectedReviewProduct();renderChecklist('testingChecklistUI',p?.testingChecklist||[],p,'test','testingProgress');renderChecklist('photoChecklistUI',p?.photoChecklist||[],p,'photo','photoProgress');renderLifecycle();updateReviewGuide();}
function appendReviewHistory(p,status,note=''){
  p.reviewHistory=Array.isArray(p.reviewHistory)?p.reviewHistory:[];
  const snapshot={at:new Date().toISOString(),status:status||p.status,note:String(note||''),title:String(p.reviewTitle||''),text:String(p.reviewText||'')};
  const last=p.reviewHistory.at(-1);if(last&&last.status===snapshot.status&&last.title===snapshot.title&&last.text===snapshot.text&&last.note===snapshot.note)return;
  p.reviewHistory.push(snapshot);if(p.reviewHistory.length>30)p.reviewHistory=p.reviewHistory.slice(-30);
}
function renderLifecycle(){const p=selectedReviewProduct();if(!$('reviewLifecycle'))return;if(!p){$('reviewHistoryList').innerHTML='No review history yet.';return;}const stage=p.reviewLifecycle||(['Rejected','Needs resubmission','Approved','Pending approval','Submitted','Draft ready'].includes(p.status)?p.status:'Draft ready');$('reviewLifecycle').value=stage;$('reviewStatusNote').value='';$('lifecycleUpdated').textContent=p.reviewHistory?.length?`${p.reviewHistory.length} saved version${p.reviewHistory.length===1?'':'s'}`:'';const hist=(p.reviewHistory||[]).slice().reverse().slice(0,6);$('reviewHistoryList').innerHTML=hist.length?hist.map(h=>`<div class="history-item"><strong>${escapeHtml(h.status)}</strong><span>${new Date(h.at).toLocaleString()}</span>${h.note?`<small>${escapeHtml(h.note)}</small>`:''}</div>`).join(''):'No review history yet.';}
function saveLifecycleUpdate(){const p=selectedReviewProduct();if(!p){alert('Select a saved product first.');return;}const stage=$('reviewLifecycle').value,note=$('reviewStatusNote').value.trim();p.reviewLifecycle=stage;p.status=stage;if(stage==='Submitted'&&!p.submittedAt)p.submittedAt=new Date().toISOString();if(stage==='Approved')p.approvedAt=new Date().toISOString();if(stage==='Rejected')p.rejectedAt=new Date().toISOString();p.reviewTitle=$('reviewTitleOutput').value.trim();p.reviewText=$('reviewOutput').value.trim();appendReviewHistory(p,stage,note);save();renderReviewPrep();}
function refreshTestPackPreview(){const key=$('testingTemplate')?.value;const category={electronics:'Electronics',kitchen:'Kitchen',clothing:'Clothing',beauty:'Beauty',home:'Home'}[key];const el=$('testPackPreview');if(!el)return;el.innerHTML=category?`<strong>${category} checklist:</strong> ${(TESTING_PACKS[category]||[]).map(x=>escapeHtml(x)).join(' • ')}`:'Choose a testing template to preview its neutral checklist.';}

function updateReviewGuide(){
  const p=selectedReviewProduct();
  const summary=$('reviewProductSummary');
  if(summary){
    if(!p)summary.textContent='Choose a product to begin.';
    else{
      const delivered=p.deliveryDate?Math.max(0,Math.floor((Date.now()-new Date(p.deliveryDate).getTime())/86400000)):null;
      summary.textContent=[p.name,p.category,p.status,delivered!==null?`${delivered} day${delivered===1?'':'s'} since delivery`:null].filter(Boolean).join(' • ');
    }
  }
  const test=p?checklistProgress(p.testingChecklist):{total:0,done:0};
  const observed=Boolean($('reviewTested')?.value.trim()&&($('reviewPros')?.value.trim()||$('reviewCons')?.value.trim()));
  const drafted=Boolean($('reviewOutput')?.value.trim());
  const finished=Boolean(p&&['Submitted','Pending approval','Approved'].includes(p.reviewLifecycle||p.status));
  const complete={test:Boolean(p&&test.total&&test.done===test.total),observe:observed,draft:drafted,finish:finished};
  let current='test';
  if(complete.test)current='observe';
  if(complete.test&&complete.observe)current='draft';
  if(complete.test&&complete.observe&&complete.draft)current='finish';
  document.querySelectorAll('[data-review-step]').forEach(el=>{
    const key=el.dataset.reviewStep;el.classList.toggle('is-complete',complete[key]);el.classList.toggle('is-current',Boolean(p)&&key===current&&!complete[key]);
  });
}
function openNextReviewProduct(){
  const current=selectedReviewProduct();if(!current){alert('Select a saved product first.');return;}
  $('saveReview').click();
  const queue=smartQueueItems().filter(p=>p.id!==current.id);
  const next=queue[0]||products.find(p=>p.id!==current.id&&!isSubmittedLike(p));
  if(next){loadReviewProduct(next.id);document.querySelector('[data-focus-step="test"]')?.scrollIntoView({behavior:'smooth',block:'start'});}
  else alert('No other open products are waiting.');
}
// Review Session
let reviewSession={ids:[],index:0,processed:0,ready:0,needsTesting:0};
function startReviewSession(){reviewSession={ids:smartQueueItems().map(p=>p.id),index:0,processed:0,ready:0,needsTesting:0};switchView('session');renderSession();}
function currentSessionProduct(){return products.find(p=>p.id===reviewSession.ids[reviewSession.index]);}
function renderSession(){const p=currentSessionProduct();const empty=$('sessionEmpty'),work=$('sessionWorkspace'),summary=$('sessionSummary');if(!p){empty.hidden=true;work.hidden=true;summary.hidden=false;summary.innerHTML=`<h3>Review session complete</h3><div class="session-summary-grid"><div><strong>${reviewSession.processed}</strong><span>products processed</span></div><div><strong>${reviewSession.ready}</strong><span>ready to review</span></div><div><strong>${reviewSession.needsTesting}</strong><span>need more testing</span></div><div><strong>${reviewSession.processed*6} min</strong><span>estimated admin time saved</span></div></div><button id="sessionSummaryRestart" class="primary-btn" type="button">Start another session</button>`;$('sessionSummaryRestart').onclick=startReviewSession;return;}summary.hidden=true;empty.hidden=true;work.hidden=false;const total=reviewSession.ids.length;$('sessionCounter').textContent=`${reviewSession.index+1} of ${total}`;$('sessionProgress').style.width=`${Math.round((reviewSession.index)/Math.max(1,total)*100)}%`;$('sessionBucket').textContent=smartBucket(p);$('sessionName').textContent=p.name;$('sessionMeta').textContent=[p.category,p.status,p.targetDate?`Target ${p.targetDate}`:''].filter(Boolean).join(' • ');$('sessionNotes').value=p.notes||'';$('sessionPros').value=p.pros||'';$('sessionCons').value=p.cons||'';$('sessionTestingComplete').checked=['Ready to review','Draft ready','Rejected','Needs resubmission'].includes(p.status)||checklistProgress(p.testingChecklist).pct===100;$('sessionOpenAmazon').disabled=!p.link;renderChecklist('sessionTestingChecklist',p.testingChecklist,p,'test',null);renderChecklist('sessionPhotoChecklist',p.photoChecklist,p,'photo',null);}
function saveSessionProduct(mode){const p=currentSessionProduct();if(!p)return;p.notes=$('sessionNotes').value.trim();p.pros=$('sessionPros').value.trim();p.cons=$('sessionCons').value.trim();if(mode==='needs'){p.status='Testing';reviewSession.needsTesting++;}else if($('sessionTestingComplete').checked&&!isSubmittedLike(p)){p.status='Ready to review';reviewSession.ready++;}reviewSession.processed++;localStorage.setItem(KEY,JSON.stringify(products));reviewSession.index++;renderAll();renderSession();}
function draftSessionProduct(){const p=currentSessionProduct();if(!p)return;p.notes=$('sessionNotes').value.trim();p.pros=$('sessionPros').value.trim();p.cons=$('sessionCons').value.trim();if($('sessionTestingComplete').checked&&!isSubmittedLike(p))p.status='Ready to review';localStorage.setItem(KEY,JSON.stringify(products));loadReviewProduct(p.id,true);}

// In-app feedback local capture
function feedbackPayload(){return {at:new Date().toISOString(),useful:$('fbUseful')?.value.trim()||'',missing:$('fbMissing')?.value.trim()||'',worthPaying:$('fbWorthPaying')?.value.trim()||'',wouldPay:$('fbWouldPay')?.value||'',recommend:$('fbRecommend')?.value||'',email:$('fbEmail')?.value.trim()||'',app:'VineTrack Beta v15'};}
function feedbackText(p){return `VineTrack Beta v15 feedback\nMost useful: ${p.useful||'-'}\nMissing/confusing: ${p.missing||'-'}\nWorth paying for: ${p.worthPaying||'-'}\nWould pay: ${p.wouldPay||'-'}\nRecommend (0-10): ${p.recommend||'-'}\nEmail: ${p.email||'-'}\nDate: ${p.at}`;}
async function saveFeedbackLocal(e){e.preventDefault();const p=feedbackPayload();const all=JSON.parse(localStorage.getItem(FEEDBACK_KEY)||'[]');all.push(p);localStorage.setItem(FEEDBACK_KEY,JSON.stringify(all));$('feedbackMessage').textContent='Saving feedback…';try{const r=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});if(!r.ok)throw new Error('feedback endpoint unavailable');$('feedbackMessage').textContent='Thank you — your feedback was sent and also saved locally.';}catch{$('feedbackMessage').textContent='Feedback is saved locally, but this copy of VineTrack is not connected to the hosted feedback collector. Use Copy or Download to share it.';}}
async function copyFeedbackLocal(){const p=feedbackPayload();try{await navigator.clipboard.writeText(feedbackText(p));$('feedbackMessage').textContent='Feedback copied. Paste it into WhatsApp, email, or your preferred message.';}catch{$('feedbackMessage').textContent='Clipboard access was blocked. Use Download feedback instead.';}}
function downloadFeedbackLocal(){const p=feedbackPayload(),blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`vinetrack-feedback-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);$('feedbackMessage').textContent='Feedback downloaded.';}

// Upgrade settings persistence while keeping v10 fields compatible
function saveSettingsV11(){const old=JSON.parse(localStorage.getItem(SETTINGS)||'{}');const data={...old,name:$('userName').value.trim(),email:$('userEmail').value.trim(),plan:$('planPreview').value,defaultReviewTarget:Number($('defaultReviewTarget').value)||90};localStorage.setItem(SETTINGS,JSON.stringify(data));localStorage.setItem(UI_KEY,JSON.stringify({appearance:$('appearance').value,density:$('density').value}));applyUi();alert('Settings saved.');}
function loadV11Settings(){const s=JSON.parse(localStorage.getItem(SETTINGS)||'{}');if($('planPreview'))$('planPreview').value=s.plan||'beta';if($('defaultReviewTarget'))$('defaultReviewTarget').value=s.defaultReviewTarget||90;const h=healthData();if(!h.target&&s.defaultReviewTarget){h.target=s.defaultReviewTarget;localStorage.setItem(HEALTH_KEY,JSON.stringify(h));}}

// Hook advanced UI controls
$('editHealthBtn').onclick=()=>{const h=healthData();$('healthTotalInput').value=h.total||'';$('healthReviewedInput').value=h.reviewed||'';$('healthTargetInput').value=h.target||90;$('healthDateInput').value=h.evaluationDate||'';$('healthEditor').hidden=false;};
$('cancelHealth').onclick=()=>$('healthEditor').hidden=true;
$('saveHealth').onclick=()=>{const h={total:Number($('healthTotalInput').value)||0,reviewed:Number($('healthReviewedInput').value)||0,target:Number($('healthTargetInput').value)||90,evaluationDate:$('healthDateInput').value};if(h.reviewed>h.total){alert('Reviews completed cannot be greater than items in the evaluation period.');return;}localStorage.setItem(HEALTH_KEY,JSON.stringify(h));$('healthEditor').hidden=true;renderHealth();};
$('startSessionBtn').onclick=startReviewSession;$('restartSession').onclick=startReviewSession;
$('sessionOpenAmazon').onclick=()=>{const p=currentSessionProduct();if(p?.link)window.open(p.link,'_blank','noopener,noreferrer');};
$('sessionSaveNext').onclick=()=>saveSessionProduct('save');$('sessionNeedsTesting').onclick=()=>saveSessionProduct('needs');$('sessionSkip').onclick=()=>{reviewSession.index++;renderSession();};$('sessionDraftReview').onclick=draftSessionProduct;
$('saveLifecycle').onclick=saveLifecycleUpdate;
$('testingTemplate').addEventListener('change',refreshTestPackPreview);
$('inAppFeedbackForm').addEventListener('submit',saveFeedbackLocal);$('copyInAppFeedback').onclick=copyFeedbackLocal;$('downloadInAppFeedback').onclick=downloadFeedbackLocal;$('floatingFeedback').onclick=()=>switchView('feedback');
$('saveSettings').onclick=saveSettingsV11;

// Extend existing render/load behavior without losing v10 features
const v10RenderAll=renderAll;renderAll=function(){products=products.map(normaliseProduct);v10RenderAll();renderHealth();renderSmartQueue();renderReviewPrep();};
const v10LoadReviewProduct=loadReviewProduct;loadReviewProduct=function(id,go=false){v10LoadReviewProduct(id,go);renderReviewPrep();};
const v10RenderProducts=renderProducts;renderProducts=function(){v10RenderProducts();document.querySelectorAll('.product-card').forEach(card=>{const name=card.querySelector('.product-name')?.textContent;const id=card.dataset.id;const p=products.find(x=>x.id===id);const q=card.querySelector('.queue-pill');if(p&&q){const bucket=smartBucket(p);q.textContent=bucket==='Closed'?'':bucket;q.className='queue-pill '+bucket.toLowerCase().replaceAll(' ','-');}});};



// VineTrack v15 — Chrome extension Amazon Vine sync
let pendingSyncBatches=[];
function syncText(id,text){const el=$(id);if(el)el.textContent=text;}
function extractAsinFromLink(link){const m=String(link||'').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);return m?m[1].toUpperCase():'';}
function normaliseImportedDate(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}
function syncedDuplicate(item){
  const asin=(item.asin||extractAsinFromLink(item.link)).toUpperCase();
  const link=String(item.link||'').split('?')[0].toLowerCase();
  const name=String(item.name||'').trim().toLowerCase();
  return products.find(p=>{
    const pAsin=String(p.amazonAsin||extractAsinFromLink(p.link)).toUpperCase();
    const pLink=String(p.link||'').split('?')[0].toLowerCase();
    return (asin&&pAsin===asin)||(link&&pLink===link)||(name&&String(p.name||'').trim().toLowerCase()===name);
  });
}
function productFromSyncedItem(item){
  const asin=(item.asin||extractAsinFromLink(item.link)).toUpperCase();
  return normaliseProduct({
    id:crypto.randomUUID(),name:String(item.name||'Amazon Vine item').trim(),link:item.link||'',category:'Other',ownership:'',status:'Ordered',
    orderDate:normaliseImportedDate(item.orderDate),deliveryDate:'',targetDate:'',value:'',tags:['vine-sync'],notes:'',pros:'',cons:'',listingText:'',reviewTitle:'',reviewText:'',originalDraft:'',generatedCount:0,submittedAt:'',createdAt:new Date().toISOString(),testingChecklist:buildDefaultChecklist('Other'),photoChecklist:buildDefaultPhotoChecklist(),reviewHistory:[],reviewLifecycle:'',
    amazonAsin:asin,amazonStatusText:item.reviewStatus||'',amazonSourcePage:item.sourceUrl||'',amazonPageType:item.pageType||'',lastSyncedAt:new Date().toISOString()
  });
}
async function loadChromeExtensionAvailability(storeUrl){
  const link=$('getChromeExtension'),note=$('chromeExtensionAvailability');if(!link||!note)return;
  if(storeUrl){link.href=storeUrl;link.removeAttribute('aria-disabled');link.classList.remove('is-disabled');note.textContent='Available from the Chrome Web Store. Install once, then connect from the extension popup.';}
  else{link.href='#';link.setAttribute('aria-disabled','true');link.classList.add('is-disabled');note.textContent='Chrome Web Store listing has not been connected to this VineTrack deployment yet.';}
}
async function refreshSyncStatus(){
  try{
    const r=await fetch('/api/sync/status',{cache:'no-store'});if(!r.ok)throw new Error('unavailable');
    const data=await r.json();
    const connected=!!data.extension_connected;
    $('syncConnectionBadge').textContent=connected?'Extension connected':'Extension not connected';
    $('syncConnectionBadge').className='status-pill '+(connected?'sync-connected':'');
    if($('disconnectChromeExtension'))$('disconnectChromeExtension').hidden=!connected;
    syncText('syncStatusText',connected?`${data.extension_count||1} Chrome extension connection${Number(data.extension_count||1)===1?'':'s'} active.`:'Install VineTrack Sync from Chrome and connect it to this account once. No web address or sync code is required.');
    syncText('syncLastUsed',data.last_used_at?`Last extension activity: ${new Date(data.last_used_at).toLocaleString()}`:'');
    loadChromeExtensionAvailability(data.chrome_store_url||'');
    if(Number(data.pending_batches||0)>0)syncText('syncPendingSummary',`${data.pending_batches} synced batch${Number(data.pending_batches)===1?' is':'es are'} waiting to import.`);
  }catch{
    syncText('syncStatusText','Amazon Sync requires the hosted VineTrack server.');
  }
}
async function disconnectChromeExtension(){
  if(!confirm('Disconnect the VineTrack Chrome extension from this account? You can reconnect it later with one click.'))return;
  try{const r=await fetch('/api/extension/revoke',{method:'POST'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not disconnect.');await refreshSyncStatus();}
  catch(err){alert(err.message||'Could not disconnect the extension.');}
}
function renderPendingSync(){
  const list=$('syncPendingList');const button=$('importSyncedItems');
  const items=pendingSyncBatches.flatMap(b=>(b.items||[]).map(item=>({...item,_batchId:b.id,_createdAt:b.created_at})));
  button.disabled=!items.length;
  if(!items.length){list.innerHTML='';syncText('syncPendingSummary','No pending Vine items. Use VineTrack Sync on an Amazon Vine Orders or Reviews page.');return;}
  const unique=new Map();items.forEach(item=>{const key=item.asin||item.link||item.name;if(!unique.has(key))unique.set(key,item);});
  const rows=[...unique.values()];
  syncText('syncPendingSummary',`${rows.length} unique item${rows.length===1?'':'s'} ready to import from ${pendingSyncBatches.length} sync batch${pendingSyncBatches.length===1?'':'es'}.`);
  list.innerHTML=rows.slice(0,50).map(item=>`<div class="sync-item"><div><strong>${escapeHtml(item.name||'Amazon Vine item')}</strong><small>${escapeHtml([item.asin,item.reviewStatus,item.pageType].filter(Boolean).join(' • ')||'Visible Vine item')}</small></div><span>${syncedDuplicate(item)?'Will update existing':'New product'}</span></div>`).join('');
}
async function checkSyncedItems(){
  syncText('syncPendingSummary','Checking for synced items…');
  try{const r=await fetch('/api/vine-sync/pending',{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not check sync inbox.');pendingSyncBatches=data.batches||[];renderPendingSync();return pendingSyncBatches;}
  catch(err){pendingSyncBatches=[];renderPendingSync();syncText('syncPendingSummary',err.message||'Could not check sync inbox.');return [];}
}
async function importSyncedItems(options={}){
  const items=pendingSyncBatches.flatMap(b=>b.items||[]);if(!items.length)return {added:0,updated:0};
  let added=0,updated=0;
  for(const item of items){
    const existing=syncedDuplicate(item);const asin=(item.asin||extractAsinFromLink(item.link)).toUpperCase();
    if(existing){
      if(!existing.link&&item.link)existing.link=item.link;
      if(!existing.amazonAsin&&asin)existing.amazonAsin=asin;
      existing.amazonStatusText=item.reviewStatus||existing.amazonStatusText||'';
      existing.amazonSourcePage=item.sourceUrl||existing.amazonSourcePage||'';
      existing.amazonPageType=item.pageType||existing.amazonPageType||'';
      existing.lastSyncedAt=new Date().toISOString();
      if(!existing.orderDate)existing.orderDate=normaliseImportedDate(item.orderDate);
      existing.tags=[...new Set([...(existing.tags||[]),'vine-sync'])];updated++;
    }else{products.unshift(productFromSyncedItem(item));added++;}
  }
  localStorage.setItem(KEY,JSON.stringify(products));renderAll();
  try{await fetch('/api/vine-sync/consume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:pendingSyncBatches.map(b=>b.id)})});}catch{}
  pendingSyncBatches=[];renderPendingSync();refreshSyncStatus();
  if(!options.silent)alert(`Amazon Vine sync imported ${added} new product${added===1?'':'s'} and updated ${updated} existing record${updated===1?'':'s'}. Amazon status text was kept as reference only.`);
  switchView('products');
  return {added,updated};
}
async function handleExtensionAutoImport(){
  const params=new URLSearchParams(location.search);if(params.get('sync')!=='import')return;
  history.replaceState({},'',location.pathname);
  switchView('sync');
  const batches=await checkSyncedItems();
  if(batches.length){const result=await importSyncedItems({silent:true});alert(`VineTrack Sync complete: ${result.added} new item${result.added===1?'':'s'} and ${result.updated} update${result.updated===1?'':'s'} imported.`);}
  else syncText('syncPendingSummary','The extension opened VineTrack, but there were no pending items to import.');
}
if($('goAmazonSync'))$('goAmazonSync').onclick=()=>{switchView('sync');refreshSyncStatus();checkSyncedItems();};
if($('settingsGoSync'))$('settingsGoSync').onclick=()=>{switchView('sync');refreshSyncStatus();checkSyncedItems();};
if($('disconnectChromeExtension'))$('disconnectChromeExtension').onclick=disconnectChromeExtension;
if($('getChromeExtension'))$('getChromeExtension').onclick=e=>{if($('getChromeExtension').getAttribute('aria-disabled')==='true')e.preventDefault();};
if($('checkSyncedItems'))$('checkSyncedItems').onclick=checkSyncedItems;
if($('importSyncedItems'))$('importSyncedItems').onclick=()=>importSyncedItems();

loadV11Settings();refreshTestPackPreview();
renderAll();updateReviewMetrics();refreshSyncStatus();handleExtensionAutoImport();
