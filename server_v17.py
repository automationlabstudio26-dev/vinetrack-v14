#!/usr/bin/env python3
"""VineTrack v17 production wrapper around the stable v16 server.
Adds Stripe subscriptions, Free/Plus entitlements, production UI, and feedback CTA.
"""
import json, os, re, hmac, hashlib, secrets, sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import server as base

STRIPE_SECRET_KEY=os.environ.get('VINETRACK_STRIPE_SECRET_KEY','').strip()
STRIPE_WEBHOOK_SECRET=os.environ.get('VINETRACK_STRIPE_WEBHOOK_SECRET','').strip()
STRIPE_PRICE_MONTHLY=os.environ.get('VINETRACK_STRIPE_PRICE_MONTHLY','price_1U2JGLSpM2MnGAbPrzq6iSfQ').strip()
STRIPE_PRICE_ANNUAL=os.environ.get('VINETRACK_STRIPE_PRICE_ANNUAL','price_1U2JGZSpM2MnGAbP39LlroVE').strip()
PLUS_EMAILS={x.strip().lower() for x in os.environ.get('VINETRACK_PLUS_EMAILS','').split(',') if x.strip()}
STRIPE_API='https://api.stripe.com/v1'
WEBHOOK_TOLERANCE=300


def init_db():
    base.init_db()
    with sqlite3.connect(base.DB_FILE) as db:
        cols={row[1] for row in db.execute('PRAGMA table_info(users)').fetchall()}
        additions={
            'stripe_customer_id':'TEXT','stripe_subscription_id':'TEXT',
            'subscription_status':"TEXT NOT NULL DEFAULT 'free'",
            'subscription_plan':"TEXT NOT NULL DEFAULT 'free'",
            'subscription_price_id':'TEXT','subscription_current_period_end':'TEXT',
            'subscription_updated_at':'TEXT'}
        for name,sqltype in additions.items():
            if name not in cols: db.execute(f'ALTER TABLE users ADD COLUMN {name} {sqltype}')
        db.execute('''CREATE TABLE IF NOT EXISTS stripe_events(
            event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,processed_at TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL')
        db.commit()


def stripe_configured(): return bool(STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL)
def is_plus_status(status): return str(status or '').lower() in {'active','trialing'}


def billing_for_user(user_id,email=''):
    with sqlite3.connect(base.DB_FILE) as db:
        row=db.execute('''SELECT subscription_plan,subscription_status,stripe_customer_id,
            stripe_subscription_id,subscription_price_id,subscription_current_period_end,
            subscription_updated_at,email FROM users WHERE id=?''',(user_id,)).fetchone()
    if not row: return {'plan':'free','status':'free','is_plus':False}
    owner=str(email or row[7] or '').lower() in PLUS_EMAILS
    plus=owner or (row[0]=='plus' and is_plus_status(row[1]))
    return {'plan':'plus' if plus else 'free','status':'owner' if owner else (row[1] or 'free'),
        'is_plus':bool(plus),'customer_id':row[2],'subscription_id':row[3],
        'price_id':row[4],'current_period_end':row[5],'updated_at':row[6]}


def stripe_post(path,fields):
    if not STRIPE_SECRET_KEY: raise RuntimeError('Stripe billing is not configured.')
    req=Request(STRIPE_API+path,data=urlencode(fields,doseq=True).encode(),headers={
        'Authorization':f'Bearer {STRIPE_SECRET_KEY}','Content-Type':'application/x-www-form-urlencoded',
        'Accept':'application/json','User-Agent':'VineTrack/17.0'},method='POST')
    try:
        with urlopen(req,timeout=20) as r: return json.loads(r.read().decode())
    except HTTPError as exc:
        detail=exc.read().decode('utf-8','replace')[:1200]
        try: detail=json.loads(detail).get('error',{}).get('message') or detail
        except Exception: pass
        raise RuntimeError(f'Stripe request failed: {detail}') from exc
    except (URLError,TimeoutError) as exc: raise RuntimeError('Could not reach Stripe billing.') from exc


def valid_signature(raw,header):
    if not STRIPE_WEBHOOK_SECRET or not header: return False
    ts=None; sigs=[]
    for part in header.split(','):
        if '=' not in part: continue
        k,v=part.split('=',1)
        if k.strip()=='t':
            try: ts=int(v)
            except ValueError: return False
        elif k.strip()=='v1': sigs.append(v.strip())
    if not ts or abs(int(base.utcnow().timestamp())-ts)>WEBHOOK_TOLERANCE: return False
    expected=hmac.new(STRIPE_WEBHOOK_SECRET.encode(),str(ts).encode()+b'.'+raw,hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected,x) for x in sigs)


def object_user_id(obj):
    raw=(obj.get('metadata') or {}).get('vinetrack_user_id') or obj.get('client_reference_id')
    try: return int(raw) if raw is not None else None
    except Exception: return None


def apply_checkout(obj):
    uid=object_user_id(obj); customer=str(obj.get('customer') or '').strip() or None
    sub=str(obj.get('subscription') or '').strip() or None
    email=str(((obj.get('customer_details') or {}).get('email')) or obj.get('customer_email') or '').lower().strip()
    with sqlite3.connect(base.DB_FILE) as db:
        row=db.execute('SELECT id FROM users WHERE id=?',(uid,)).fetchone() if uid else None
        if not row and customer: row=db.execute('SELECT id FROM users WHERE stripe_customer_id=?',(customer,)).fetchone()
        if not row and email: row=db.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()
        if not row: return False
        db.execute('''UPDATE users SET stripe_customer_id=COALESCE(?,stripe_customer_id),
            stripe_subscription_id=COALESCE(?,stripe_subscription_id),subscription_plan='plus',
            subscription_status='active',subscription_updated_at=? WHERE id=?''',
            (customer,sub,base.utcnow().isoformat(),row[0])); db.commit(); return True


def apply_subscription(obj):
    uid=object_user_id(obj); customer=str(obj.get('customer') or '').strip() or None
    sub=str(obj.get('id') or '').strip() or None; status=str(obj.get('status') or 'inactive').lower()
    try: price=obj.get('items',{}).get('data',[{}])[0].get('price',{}).get('id')
    except Exception: price=None
    period=obj.get('current_period_end')
    try: period=datetime.fromtimestamp(int(period),timezone.utc).isoformat() if period else None
    except Exception: period=None
    with sqlite3.connect(base.DB_FILE) as db:
        row=db.execute('SELECT id FROM users WHERE id=?',(uid,)).fetchone() if uid else None
        if not row and customer: row=db.execute('SELECT id FROM users WHERE stripe_customer_id=?',(customer,)).fetchone()
        if not row: return False
        db.execute('''UPDATE users SET stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=?,
            subscription_plan=?,subscription_status=?,subscription_price_id=?,subscription_current_period_end=?,
            subscription_updated_at=? WHERE id=?''',(customer,sub,'plus' if is_plus_status(status) else 'free',status,
            price,period,base.utcnow().isoformat(),row[0])); db.commit(); return True


def production_landing(html):
    html=html.replace('Beta pricing','Pricing').replace('Public beta · v14','VineTrack v17 · Live')
    html=html.replace('VineTrack Sync Chrome extension','VineTrack for Chrome').replace('VineTrack Sync Chrome','VineTrack for Chrome')
    start=html.find('  <section id="pricing" class="section pricing-section">')
    end=html.find('  <section class="beta-cta">',start)
    if start>=0 and end>start:
        section='''  <section id="pricing" class="section pricing-section"><div class="wrap">
        <div class="section-heading"><div><span class="eyebrow">Simple pricing</span><h2>Try VineTrack Plus free for 7 days.</h2></div><p>Full Plus access for 7 days. £0 today. Payment method required. After the trial, your selected subscription renews automatically unless you cancel before the trial ends.</p></div>
        <div class="pricing-grid production-pricing">
          <article class="price-card">
  <span class="plan-name">Free</span>
  <strong>£0</strong>
  <p>Manual product tracking and a basic review workflow.</p>
  <a class="secondary price-cta" href="/auth/amazon?next=%2Fapp.html">Start free</a>
</article>

<article class="price-card recommended">
  <em>7-day free trial</em>
  <span class="plan-name">Plus Monthly</span>
  <strong>£2.99<small>/month</small></strong>
  <p>7 days free with full Plus access, then £2.99/month unless cancelled before the trial ends.</p>
  <button class="primary price-cta" data-checkout-plan="monthly" type="button">
    Start 7-day free trial
  </button>
</article>

<article class="price-card">
  <em>7-day free trial</em>
  <span class="plan-name">Plus Annual</span>
  <strong>£24.99<small>/year</small></strong>
  <p>7 days free with full Plus access, then £24.99/year unless cancelled before the trial ends.</p>
  <button class="primary price-cta" data-checkout-plan="annual" type="button">
    Start 7-day free trial
  </button>
</article>
        </div><p id="pricingStatus" class="pricing-status"></p></div></section>\n\n'''
        html=html[:start]+section+html[end:]
    html=html.replace('</head>','<link rel="stylesheet" href="/production.css"></head>')
    html=html.replace('</body>','<script src="/production.js"></script></body>')
    return html


def production_app(html):
    html=html.replace('VineTrack Beta v16','VineTrack v17').replace('Beta v16','VineTrack v17')
    html=html.replace('VineTrack Sync Chrome extension','VineTrack for Chrome').replace('VineTrack Sync for Chrome','VineTrack for Chrome').replace('Install VineTrack Sync','Install VineTrack for Chrome')
    html=html.replace('<button class="nav-btn" data-view="sync">Amazon Sync</button>','<button class="nav-btn" data-view="sync" data-plus-nav="sync">VineTrack for Chrome <span class="nav-plus">Plus</span></button>')
    html=html.replace('<button class="nav-btn" data-view="session">Review Session</button>','<button class="nav-btn" data-view="session" data-plus-nav="session">Review Session <span class="nav-plus">Plus</span></button>')
    html=html.replace('<button id="demoDataBtn" class="secondary-btn">Load demo data</button>','<div class="topbar-actions"><span id="planChip" class="plan-chip">Free</span><button id="billingActionBtn" class="primary-btn small-btn" type="button">Upgrade</button><button id="demoDataBtn" class="secondary-btn">Load demo data</button></div>')
    html=html.replace('<div class="panel health-panel">','<div class="panel health-panel" data-plus-feature="health">',1)
    html=html.replace('<div class="panel">\n            <div class="panel-header"><h2>What should I review next?', '<div class="panel" data-plus-feature="smart-queue">\n            <div class="panel-header"><h2>What should I review next?',1)
    html=html.replace('Plus preview','Plus')
    bottom='''<section class="bottom-feedback-card"><div><span class="eyebrow">Help improve VineTrack</span><h2>Something useful, confusing or missing?</h2><p>Send us a quick note. Customer feedback directly shapes what we improve next.</p></div><button id="bottomFeedbackBtn" class="secondary-btn" type="button">Send feedback</button></section>'''
    html=html.replace('    </main>',bottom+'    </main>')
    html=html.replace('</head>','<link rel="stylesheet" href="/production.css"></head>')
    html=html.replace('</body>','<script src="/production.js"></script></body>')
    return html


class Handler(base.Handler):
    def _current_user(self):
        user=super()._current_user()
        if user: user['billing']=billing_for_user(user['id'],user['email'])
        return user

    def _request_origin(self):
        proto=self.headers.get('X-Forwarded-Proto','').split(',')[0].strip().lower()
        if proto not in ('http','https'): proto='http'
        host=self.headers.get('X-Forwarded-Host','').split(',')[0].strip() or self.headers.get('Host','').strip()
        host=re.sub(r'[^A-Za-z0-9.:[\]-]','',host)
        return f'{proto}://{host}' if host else ''

    def _raw_body(self,max_size=1024*1024):
        try: n=int(self.headers.get('Content-Length','0'))
        except ValueError: n=0
        if n<=0 or n>max_size: raise ValueError('Request payload is empty or too large.')
        return self.rfile.read(n)

    def _serve_protected_app(self):
        user=self._current_user()
        if not user:
            return self._redirect('/login.html?next=%2Fapp.html')
        template=(base.ROOT/'app.html').read_text(encoding='utf-8')
        auth_json=json.dumps({'user':user},ensure_ascii=False).replace('</','<\\/')
        return self._html(200,production_app(template.replace('__AUTH_JSON__',auth_json).replace('__USER_ID__',str(user['id']))))

    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/health':
            return self._json(200,{'status':'ok','app':'VineTrack v17','environment':'production','auth':'amazon',
                'amazon_signin_configured':base.amazon_auth_configured(),'billing_configured':stripe_configured(),
                'webhook_configured':bool(STRIPE_WEBHOOK_SECRET),'vine_sync':'chrome-extension'})
        if path=='/api/app-config':
            return self._json(200,{'app':'VineTrack v17','environment':'production','chrome_store_url':base.CHROME_STORE_URL,
                'extension_id_locked':bool(base.ALLOWED_EXTENSION_IDS),'amazon_signin_configured':base.amazon_auth_configured(),
                'billing_configured':stripe_configured(),'prices':{'monthly':2.99,'annual':24.99}})
        if path=='/api/billing/status':
            user=self._current_user()
            if not user: return self._json(401,{'error':'Sign in required.'})
            return self._json(200,{'billing':user['billing'],'configured':stripe_configured(),'prices':{'monthly':2.99,'annual':24.99}})
        if path in ('/','/index.html'):
            return self._html(200,production_landing((base.ROOT/'index.html').read_text(encoding='utf-8')))
        return super().do_GET()

    def do_POST(self):
        path=urlparse(self.path).path
        if path=='/api/stripe/webhook':
            try: raw=self._raw_body()
            except ValueError as exc: return self._json(400,{'error':str(exc)})
            if not valid_signature(raw,self.headers.get('Stripe-Signature','')): return self._json(400,{'error':'Invalid Stripe signature.'})
            try: event=json.loads(raw.decode())
            except Exception: return self._json(400,{'error':'Invalid Stripe event.'})
            eid=str(event.get('id') or '')[:255]; etype=str(event.get('type') or '')[:255]
            with sqlite3.connect(base.DB_FILE) as db:
                if eid and db.execute('SELECT 1 FROM stripe_events WHERE event_id=?',(eid,)).fetchone(): return self._json(200,{'ok':True,'duplicate':True})
            obj=((event.get('data') or {}).get('object') or {}); handled=False
            if etype=='checkout.session.completed': handled=apply_checkout(obj)
            elif etype in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'): handled=apply_subscription(obj)
            if eid:
                with sqlite3.connect(base.DB_FILE) as db:
                    db.execute('INSERT OR IGNORE INTO stripe_events VALUES(?,?,?)',(eid,etype,base.utcnow().isoformat())); db.commit()
            return self._json(200,{'ok':True,'handled':bool(handled)})
        if path=='/api/billing/checkout':
            user=self._current_user()
            if not user: return self._json(401,{'error':'Sign in required.'})
            if not stripe_configured(): return self._json(503,{'error':'Billing is not configured yet.'})
            try: payload=self._read_json()
            except ValueError as exc: return self._json(400,{'error':str(exc)})
            period=str(payload.get('period') or 'monthly').lower()
            if period not in ('monthly','annual'): return self._json(400,{'error':'Choose monthly or annual billing.'})
            price=STRIPE_PRICE_MONTHLY if period=='monthly' else STRIPE_PRICE_ANNUAL; origin=self._request_origin()
            fields={'mode':'subscription','line_items[0][price]':price,'line_items[0][quantity]':'1',
                'success_url':origin+'/app.html?billing=success','cancel_url':origin+'/app.html?billing=cancelled',
                'client_reference_id':str(user['id']),'metadata[vinetrack_user_id]':str(user['id']),
                'metadata[billing_period]':period,'subscription_data[metadata][vinetrack_user_id]':str(user['id']),
                'subscription_data[metadata][plan]':'plus','subscription_data[metadata][billing_period]':period,'subscription_data[trial_period_days]':'7',
                'allow_promotion_codes':'true'}
            customer=user['billing'].get('customer_id')
            fields['customer' if customer else 'customer_email']=customer or user['email']
            try: session=stripe_post('/checkout/sessions',fields)
            except RuntimeError as exc: return self._json(502,{'error':str(exc)[:800]})
            return self._json(201,{'ok':True,'url':session.get('url')})
        if path=='/api/billing/portal':
            user=self._current_user()
            if not user: return self._json(401,{'error':'Sign in required.'})
            customer=user['billing'].get('customer_id')
            if not customer: return self._json(400,{'error':'No Stripe billing account is linked yet.'})
            try: portal=stripe_post('/billing_portal/sessions',{'customer':customer,'return_url':self._request_origin()+'/app.html'})
            except RuntimeError as exc: return self._json(502,{'error':str(exc)[:800]})
            return self._json(201,{'ok':True,'url':portal.get('url')})
        if path=='/api/vine-sync':
            ident=self._extension_identity(touch=False)
            if ident and not billing_for_user(ident['user_id']).get('is_plus'):
                return self._json(402,{'error':'VineTrack for Chrome sync is a Plus feature. Upgrade to VineTrack Plus to sync Vine items.'},{'Access-Control-Allow-Origin':'*'})
        return super().do_POST()


if __name__=='__main__':
    init_db(); os.chdir(base.ROOT)
    print(f'VineTrack v17 running on 0.0.0.0:{base.PORT}')
    base.ThreadingHTTPServer(('0.0.0.0',base.PORT),Handler).serve_forever()
