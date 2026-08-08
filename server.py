#!/usr/bin/env python3
"""VineTrack public-beta server: authenticated access, static app, and feedback collector.

Uses only Python's standard library so it can deploy on Railway without extra packages.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone, timedelta
from http.cookies import SimpleCookie
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('PORT', '8080'))
FEEDBACK_FILE = Path(os.environ.get('VINETRACK_FEEDBACK_FILE', str(ROOT / 'data' / 'feedback.jsonl')))
DB_FILE = Path(os.environ.get('VINETRACK_DB_FILE', str(ROOT / 'data' / 'vinetrack.db')))
ADMIN_KEY = os.environ.get('VINETRACK_ADMIN_KEY', '')
CHROME_STORE_URL = os.environ.get('VINETRACK_CHROME_STORE_URL', '').strip()
ALLOWED_EXTENSION_IDS = {x.strip().lower() for x in os.environ.get('VINETRACK_EXTENSION_IDS', '').split(',') if x.strip()}
AMAZON_CLIENT_ID = os.environ.get('VINETRACK_AMAZON_CLIENT_ID', '').strip()
AMAZON_CLIENT_SECRET = os.environ.get('VINETRACK_AMAZON_CLIENT_SECRET', '').strip()
AMAZON_REDIRECT_URI = os.environ.get('VINETRACK_AMAZON_REDIRECT_URI', '').strip()
AMAZON_AUTHORIZE_URL = 'https://www.amazon.com/ap/oa'
AMAZON_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
AMAZON_PROFILE_URL = 'https://api.amazon.com/user/profile'
OAUTH_STATE_MINUTES = 10
MAX_BODY = 256 * 1024
SESSION_DAYS = 30
COOKIE_NAME = 'vinetrack_session'
PBKDF2_ROUNDS = 240_000
LOGIN_FAILURES = {}  # transient only; never written to disk
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_FAILURES = 8
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
EXTENSION_ID_RE = re.compile(r'^[a-p]{32}$', re.I)


def utcnow():
    return datetime.now(timezone.utc)


def init_db():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_FILE) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
        cols = {row[1] for row in db.execute('PRAGMA table_info(users)').fetchall()}
        if 'sync_token_hash' not in cols:
            db.execute('ALTER TABLE users ADD COLUMN sync_token_hash TEXT')
        if 'sync_token_created_at' not in cols:
            db.execute('ALTER TABLE users ADD COLUMN sync_token_created_at TEXT')
        if 'amazon_user_id' not in cols:
            db.execute('ALTER TABLE users ADD COLUMN amazon_user_id TEXT')
        if 'auth_provider' not in cols:
            db.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password'")
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_amazon_user_id ON users(amazon_user_id) WHERE amazon_user_id IS NOT NULL')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_token_hash ON users(sync_token_hash) WHERE sync_token_hash IS NOT NULL')
        db.execute('''
            CREATE TABLE IF NOT EXISTS vine_imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                source TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                consumed_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_vine_imports_user_pending ON vine_imports(user_id, consumed_at, id)')
        db.execute('''
            CREATE TABLE IF NOT EXISTS extension_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                extension_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                revoked_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_extension_tokens_user ON extension_tokens(user_id, revoked_at, id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_extension_tokens_ext ON extension_tokens(extension_id, revoked_at, id)')
        db.execute('''
            CREATE TABLE IF NOT EXISTS oauth_states (
                state_hash TEXT PRIMARY KEY,
                next_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        ''')
        db.execute('DELETE FROM oauth_states WHERE expires_at < ?', (utcnow().isoformat(),))
        db.execute('DELETE FROM sessions WHERE expires_at < ?', (utcnow().isoformat(),))
        db.commit()


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PBKDF2_ROUNDS)
    return f'pbkdf2_sha256${PBKDF2_ROUNDS}${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}'


def verify_password(password, stored):
    try:
        algo, rounds_s, salt_s, digest_s = stored.split('$', 3)
        if algo != 'pbkdf2_sha256':
            return False
        salt = base64.urlsafe_b64decode(salt_s.encode())
        expected = base64.urlsafe_b64decode(digest_s.encode())
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, int(rounds_s))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def validate_extension_redirect(uri):
    try:
        parsed = urlparse(str(uri or '').strip())
    except Exception:
        return ''
    if parsed.scheme != 'https' or not parsed.hostname or parsed.port:
        return ''
    suffix = '.chromiumapp.org'
    host = parsed.hostname.lower()
    if not host.endswith(suffix):
        return ''
    extension_id = host[:-len(suffix)]
    if not EXTENSION_ID_RE.fullmatch(extension_id):
        return ''
    if ALLOWED_EXTENSION_IDS and extension_id not in ALLOWED_EXTENSION_IDS:
        return ''
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ''
    return extension_id


def clean_sync_item(raw):
    if not isinstance(raw, dict):
        return None
    asin = re.sub(r'[^A-Z0-9]', '', str(raw.get('asin', '')).upper())[:10]
    if asin and len(asin) != 10:
        asin = ''
    name = re.sub(r'\s+', ' ', str(raw.get('name', '')).strip())[:500]
    link = str(raw.get('link', '')).strip()[:2000]
    source_url = str(raw.get('sourceUrl', '')).strip()[:2000]
    if link and not re.match(r'^https?://(?:www\.)?amazon\.', link, re.I):
        link = ''
    if source_url and not re.match(r'^https?://(?:www\.)?amazon\.', source_url, re.I):
        source_url = ''
    review_status = re.sub(r'\s+', ' ', str(raw.get('reviewStatus', '')).strip())[:160]
    order_date = str(raw.get('orderDate', '')).strip()[:40]
    page_type = re.sub(r'[^a-zA-Z0-9 _-]', '', str(raw.get('pageType', '')).strip())[:80]
    image = str(raw.get('image', '')).strip()[:2000]
    if image and not image.startswith(('https://', 'http://')):
        image = ''
    if not name and not asin:
        return None
    return {
        'asin': asin,
        'name': name or f'Amazon item {asin}',
        'link': link,
        'image': image,
        'reviewStatus': review_status,
        'orderDate': order_date,
        'pageType': page_type,
        'sourceUrl': source_url,
    }


def login_rate_key(handler, email):
    forwarded = handler.headers.get('X-Forwarded-For', '').split(',')[0].strip()
    ip = forwarded or (handler.client_address[0] if handler.client_address else 'unknown')
    return f'{ip}|{email.lower()}'

def login_is_limited(key):
    now = utcnow().timestamp()
    recent = [t for t in LOGIN_FAILURES.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    if recent:
        LOGIN_FAILURES[key] = recent
    else:
        LOGIN_FAILURES.pop(key, None)
    return len(recent) >= LOGIN_MAX_FAILURES

def login_record_failure(key):
    now = utcnow().timestamp()
    recent = [t for t in LOGIN_FAILURES.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    recent.append(now)
    LOGIN_FAILURES[key] = recent

def login_clear_failures(key):
    LOGIN_FAILURES.pop(key, None)


def safe_next_path(value):
    value = str(value or '/app.html').strip()
    if not value.startswith('/') or value.startswith('//'):
        return '/app.html'
    return value[:1200]


def amazon_auth_configured():
    return bool(AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET and AMAZON_REDIRECT_URI)


def amazon_post_form(url, fields):
    body = urlencode(fields).encode('utf-8')
    req = Request(url, data=body, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'VineTrack/16.0',
    }, method='POST')
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')[:1000]
        raise RuntimeError(f'Amazon token exchange failed ({exc.code}): {detail}') from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError('Could not reach Amazon sign-in service.') from exc


def amazon_get_profile(access_token):
    req = Request(AMAZON_PROFILE_URL, headers={
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
        'User-Agent': 'VineTrack/16.0',
    })
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')[:1000]
        raise RuntimeError(f'Amazon profile request failed ({exc.code}): {detail}') from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError('Could not retrieve the Amazon account profile.') from exc


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_bytes(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self._send_bytes(status, body, 'application/json; charset=utf-8', extra_headers)

    def _html(self, status, html, extra_headers=None):
        self._send_bytes(status, html.encode('utf-8'), 'text/html; charset=utf-8', extra_headers)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            raise ValueError('Request payload is empty or too large.')
        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception as exc:
            raise ValueError('Invalid JSON.') from exc
        if not isinstance(payload, dict):
            raise ValueError('Expected a JSON object.')
        return payload

    def _session_token(self):
        raw = self.headers.get('Cookie', '')
        if not raw:
            return ''
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
            morsel = cookie.get(COOKIE_NAME)
            return morsel.value if morsel else ''
        except Exception:
            return ''

    def _current_user(self):
        token = self._session_token()
        if not token:
            return None
        now = utcnow().isoformat()
        with sqlite3.connect(DB_FILE) as db:
            row = db.execute('''
                SELECT u.id, u.name, u.email, u.auth_provider, s.expires_at
                FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>?
            ''', (token_hash(token), now)).fetchone()
        if not row:
            return None
        return {'id': row[0], 'name': row[1], 'email': row[2], 'auth_provider': row[3]}

    def _cookie_header(self, token, max_age=None):
        secure = self.headers.get('X-Forwarded-Proto', '').lower() == 'https'
        parts = [f'{COOKIE_NAME}={token}', 'Path=/', 'HttpOnly', 'SameSite=Lax']
        if max_age is not None:
            parts.append(f'Max-Age={int(max_age)}')
        if secure:
            parts.append('Secure')
        return '; '.join(parts)

    def _create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        now = utcnow()
        expires = now + timedelta(days=SESSION_DAYS)
        with sqlite3.connect(DB_FILE) as db:
            db.execute('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
                       (token_hash(token), user_id, now.isoformat(), expires.isoformat()))
            db.commit()
        return token

    def _delete_session(self):
        token = self._session_token()
        if token:
            with sqlite3.connect(DB_FILE) as db:
                db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(token),))
                db.commit()

    def _extension_identity(self, touch=False):
        auth = self.headers.get('Authorization', '').strip()
        if not auth.lower().startswith('bearer '):
            return None
        token = auth[7:].strip()
        if not token or len(token) > 240:
            return None
        now = utcnow().isoformat()
        with sqlite3.connect(DB_FILE) as db:
            row = db.execute('''
                SELECT t.id, t.user_id, t.extension_id, t.created_at, t.last_used_at, u.name, u.email
                FROM extension_tokens t JOIN users u ON u.id=t.user_id
                WHERE t.token_hash=? AND t.revoked_at IS NULL
            ''', (token_hash(token),)).fetchone()
            if row and touch:
                db.execute('UPDATE extension_tokens SET last_used_at=? WHERE id=?', (now, row[0]))
                db.commit()
        if not row:
            return None
        return {'token_id': row[0], 'user_id': row[1], 'extension_id': row[2], 'created_at': row[3], 'last_used_at': now if touch else row[4], 'name': row[5], 'email': row[6]}

    def _serve_amazon_start(self, parsed):
        if not amazon_auth_configured():
            html = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amazon sign-in setup · VineTrack</title><link rel="stylesheet" href="login.css"></head><body><main style="max-width:680px;margin:70px auto;padding:28px;font-family:Inter,system-ui,sans-serif"><h1>Amazon sign-in is not configured yet</h1><p>VineTrack Beta v16 is ready for Login with Amazon, but the Railway service still needs the Amazon client ID, client secret and callback URL.</p><p>Add <code>VINETRACK_AMAZON_CLIENT_ID</code>, <code>VINETRACK_AMAZON_CLIENT_SECRET</code> and <code>VINETRACK_AMAZON_REDIRECT_URI</code> in Railway, then redeploy.</p><p><a href="/login.html">Back to sign in</a></p></main></body></html>"""
            return self._html(503, html)
        params = parse_qs(parsed.query)
        next_path = safe_next_path((params.get('next') or ['/app.html'])[0])
        state = secrets.token_urlsafe(32)
        now = utcnow()
        expires = now + timedelta(minutes=OAUTH_STATE_MINUTES)
        with sqlite3.connect(DB_FILE) as db:
            db.execute('DELETE FROM oauth_states WHERE expires_at < ?', (now.isoformat(),))
            db.execute('INSERT INTO oauth_states(state_hash,next_path,created_at,expires_at) VALUES(?,?,?,?)',
                       (token_hash(state), next_path, now.isoformat(), expires.isoformat()))
            db.commit()
        auth_url = AMAZON_AUTHORIZE_URL + '?' + urlencode({
            'client_id': AMAZON_CLIENT_ID,
            'scope': 'profile',
            'response_type': 'code',
            'redirect_uri': AMAZON_REDIRECT_URI,
            'state': state,
        })
        return self._redirect(auth_url)

    def _serve_amazon_callback(self, parsed):
        params = parse_qs(parsed.query)
        error = (params.get('error') or [''])[0]
        if error:
            description = re.sub(r'[^a-zA-Z0-9 .,_-]', '', (params.get('error_description') or ['Amazon sign-in was cancelled.'])[0])[:300]
            return self._redirect('/login.html?amazon_error=' + quote(description))
        state = (params.get('state') or [''])[0]
        code = (params.get('code') or [''])[0]
        if not state or not code:
            return self._redirect('/login.html?amazon_error=' + quote('Amazon sign-in did not return the information VineTrack expected.'))
        now = utcnow().isoformat()
        with sqlite3.connect(DB_FILE) as db:
            state_row = db.execute('SELECT next_path,expires_at FROM oauth_states WHERE state_hash=?', (token_hash(state),)).fetchone()
            db.execute('DELETE FROM oauth_states WHERE state_hash=?', (token_hash(state),))
            db.commit()
        if not state_row or state_row[1] <= now:
            return self._redirect('/login.html?amazon_error=' + quote('Your Amazon sign-in session expired. Please try again.'))
        oauth_next_path = state_row[0]
        try:
            token_data = amazon_post_form(AMAZON_TOKEN_URL, {
                'grant_type': 'authorization_code',
                'code': code,
                'client_id': AMAZON_CLIENT_ID,
                'client_secret': AMAZON_CLIENT_SECRET,
                'redirect_uri': AMAZON_REDIRECT_URI,
            })
            access_token = str(token_data.get('access_token', '')).strip()
            if not access_token:
                raise RuntimeError('Amazon did not return an access token.')
            profile = amazon_get_profile(access_token)
        except RuntimeError:
            return self._redirect('/login.html?amazon_error=' + quote('Amazon sign-in could not be completed. Please try again.'))

        amazon_user_id = str(profile.get('user_id') or profile.get('userId') or '').strip()[:255]
        email = str(profile.get('email') or '').strip().lower()[:254]
        name = re.sub(r'\s+', ' ', str(profile.get('name') or '').strip())[:80]
        if not amazon_user_id or not EMAIL_RE.match(email):
            return self._redirect('/login.html?amazon_error=' + quote('Amazon did not provide the profile details VineTrack needs.'))
        if not name:
            name = email.split('@', 1)[0][:80] or 'Vine reviewer'

        created = utcnow().isoformat()
        with sqlite3.connect(DB_FILE) as db:
            row_by_amazon = db.execute('SELECT id FROM users WHERE amazon_user_id=?', (amazon_user_id,)).fetchone()
            if row_by_amazon:
                user_id = row_by_amazon[0]
                try:
                    db.execute("UPDATE users SET name=?, email=?, auth_provider='amazon' WHERE id=?", (name, email, user_id))
                except sqlite3.IntegrityError:
                    return self._redirect('/login.html?amazon_error=' + quote('That Amazon email is already used by another VineTrack account.'))
            else:
                row_by_email = db.execute('SELECT id,amazon_user_id FROM users WHERE email=?', (email,)).fetchone()
                if row_by_email:
                    if row_by_email[1] and row_by_email[1] != amazon_user_id:
                        return self._redirect('/login.html?amazon_error=' + quote('This email is already linked to a different Amazon account.'))
                    user_id = row_by_email[0]
                    db.execute("UPDATE users SET amazon_user_id=?, auth_provider='amazon', name=? WHERE id=?", (amazon_user_id, name, user_id))
                else:
                    placeholder_hash = 'amazon_oauth_only$' + secrets.token_urlsafe(32)
                    cur = db.execute('INSERT INTO users(name,email,password_hash,created_at,amazon_user_id,auth_provider) VALUES(?,?,?,?,?,?)',
                                     (name, email, placeholder_hash, created, amazon_user_id, 'amazon'))
                    user_id = cur.lastrowid
            db.commit()
        session_token = self._create_session(user_id)
        self.send_response(302)
        self.send_header('Location', safe_next_path(oauth_next_path))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Set-Cookie', self._cookie_header(session_token, SESSION_DAYS * 86400))
        self.end_headers()
        return

    def _serve_extension_connect(self, parsed):
        params = parse_qs(parsed.query)
        redirect_uri = (params.get('redirect_uri') or [''])[0]
        state = (params.get('state') or [''])[0][:240]
        extension_id = validate_extension_redirect(redirect_uri)
        if not extension_id or len(state) < 12:
            return self._html(400, '<!doctype html><meta charset="utf-8"><title>VineTrack Sync</title><p>Invalid Chrome extension connection request.</p>')
        user = self._current_user()
        if not user:
            next_path = '/extension/connect?' + urlencode({'redirect_uri': redirect_uri, 'state': state})
            return self._redirect('/login.html?next=' + quote(next_path, safe=''))
        payload = json.dumps({'redirect_uri': redirect_uri, 'state': state}, ensure_ascii=False).replace('</', '<\\/')
        user_name = re.sub(r'[<>]', '', user['name'])
        return self._html(200, f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect VineTrack Sync</title>
<style>body{{font-family:Inter,system-ui,sans-serif;background:#f5f8f7;color:#14213d;margin:0;display:grid;place-items:center;min-height:100vh}}main{{width:min(520px,calc(100% - 32px));background:#fff;border:1px solid #dbe5e2;border-radius:20px;padding:28px;box-shadow:0 18px 50px #14213d16}}.brand{{font-weight:900;color:#0f766e;font-size:20px}}h1{{margin:12px 0 8px}}p{{line-height:1.55;color:#59667b}}.trust{{background:#eef8f5;border:1px solid #cce9e1;padding:12px 14px;border-radius:12px}}button{{width:100%;border:0;border-radius:12px;padding:13px;background:#0f766e;color:#fff;font-weight:800;font-size:15px;cursor:pointer}}#msg{{min-height:22px;margin-top:10px;color:#b42318}}</style></head>
<body><main><div class="brand">VineTrack Sync</div><h1>Connect the Chrome extension</h1><p>Signed in as <strong>{user_name}</strong>. This gives the VineTrack Sync extension permission to send the Vine items you explicitly choose to sync into this VineTrack account.</p><div class="trust">VineTrack does not receive your Amazon password and does not submit reviews automatically.</div><p>Click once to finish the connection.</p><button id="connect">Connect VineTrack Sync</button><div id="msg"></div></main>
<script>const payload={payload};document.getElementById('connect').onclick=async()=>{{const b=document.getElementById('connect'),m=document.getElementById('msg');b.disabled=true;m.textContent='Connecting…';try{{const r=await fetch('/api/extension/authorize',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(payload)}});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not connect.');location.replace(d.redirect_url);}}catch(e){{m.textContent=e.message||'Could not connect.';b.disabled=false;}}}};</script></body></html>''')

    def _serve_protected_app(self):
        user = self._current_user()
        if not user:
            next_path = self.path if self.path.startswith(('/app', '/app.html')) else '/app.html'
            return self._redirect('/login.html?next=' + quote(next_path, safe=''))
        template = (ROOT / 'app.html').read_text(encoding='utf-8')
        auth_json = json.dumps({'user': user}, ensure_ascii=False).replace('</', '<\\/')
        html = template.replace('__AUTH_JSON__', auth_json).replace('__USER_ID__', str(user['id']))
        return self._html(200, html)

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path in ('/app', '/app.html') and not self._current_user():
            self.send_response(302)
            self.send_header('Location', '/login.html?next=%2Fapp.html')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return
        return super().do_HEAD()

    def do_OPTIONS(self):
        path = urlparse(self.path).path
        if path in ('/api/vine-sync', '/api/extension/me', '/api/extension/disconnect-self'):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-VineTrack-Sync-Code')
            self.send_header('Access-Control-Max-Age', '86400')
            self.end_headers()
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == '/health':
            return self._json(200, {'status': 'ok', 'app': 'VineTrack Beta v16', 'auth': 'amazon', 'amazon_signin_configured': amazon_auth_configured(), 'vine_sync': 'chrome-extension'})
        if path == '/auth/amazon':
            return self._serve_amazon_start(parsed)
        if path == '/auth/amazon/callback':
            return self._serve_amazon_callback(parsed)
        if path == '/api/auth/me':
            user = self._current_user()
            return self._json(200, {'authenticated': bool(user), 'user': user})
        if path == '/api/app-config':
            return self._json(200, {'app': 'VineTrack Beta v16', 'chrome_store_url': CHROME_STORE_URL, 'extension_id_locked': bool(ALLOWED_EXTENSION_IDS), 'amazon_signin_configured': amazon_auth_configured()})
        if path == '/extension/connect':
            return self._serve_extension_connect(parsed)
        if path == '/api/extension/me':
            cors = {'Access-Control-Allow-Origin': '*'}
            ident = self._extension_identity(touch=True)
            if not ident:
                return self._json(401, {'error': 'Extension connection is not valid.'}, cors)
            return self._json(200, {'connected': True, 'user': {'name': ident['name'], 'email': ident['email']}, 'extension_id': ident['extension_id'], 'last_used_at': ident['last_used_at']}, cors)
        if path == '/api/sync/status':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            with sqlite3.connect(DB_FILE) as db:
                legacy = db.execute('SELECT sync_token_hash, sync_token_created_at FROM users WHERE id=?', (user['id'],)).fetchone()
                ext = db.execute('SELECT COUNT(*), MAX(created_at), MAX(last_used_at) FROM extension_tokens WHERE user_id=? AND revoked_at IS NULL', (user['id'],)).fetchone()
                pending = db.execute('SELECT COUNT(*) FROM vine_imports WHERE user_id=? AND consumed_at IS NULL', (user['id'],)).fetchone()[0]
            extension_count = int(ext[0] or 0)
            return self._json(200, {'configured': extension_count > 0 or bool(legacy and legacy[0]), 'extension_connected': extension_count > 0, 'extension_count': extension_count, 'created_at': ext[1] or (legacy[1] if legacy else None), 'last_used_at': ext[2], 'pending_batches': pending, 'chrome_store_url': CHROME_STORE_URL})
        if path == '/api/vine-sync/pending':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            batches = []
            with sqlite3.connect(DB_FILE) as db:
                rows = db.execute('SELECT id, source, payload_json, created_at FROM vine_imports WHERE user_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT 20', (user['id'],)).fetchall()
            for row in rows:
                try:
                    payload = json.loads(row[2])
                except Exception:
                    payload = {'items': []}
                batches.append({'id': row[0], 'source': row[1], 'created_at': row[3], 'items': payload.get('items', [])})
            return self._json(200, {'count': len(batches), 'batches': batches})
        if path in ('/app', '/app.html'):
            return self._serve_protected_app()
        if path == '/login' and (ROOT / 'login.html').exists():
            return self._redirect('/login.html' + (('?' + parsed.query) if parsed.query else ''))
        if path == '/api/feedback-export':
            if not ADMIN_KEY:
                return self._json(503, {'error': 'Admin export is not configured.'})
            if self.headers.get('X-Admin-Key', '') != ADMIN_KEY:
                return self._json(401, {'error': 'Unauthorized'})
            rows = []
            if FEEDBACK_FILE.exists():
                for line in FEEDBACK_FILE.read_text(encoding='utf-8').splitlines():
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
            return self._json(200, {'count': len(rows), 'feedback': rows})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path

        if path == '/api/auth/register':
            return self._json(410, {'error': 'New VineTrack accounts are created by continuing with Amazon.'})

        if path == '/api/auth/login':
            try:
                payload = self._read_json()
            except ValueError as exc:
                return self._json(400, {'error': str(exc)})
            email = str(payload.get('email', '')).strip().lower()
            password = str(payload.get('password', ''))
            rate_key = login_rate_key(self, email)
            if login_is_limited(rate_key):
                return self._json(429, {'error': 'Too many sign-in attempts. Please wait a few minutes and try again.'})
            with sqlite3.connect(DB_FILE) as db:
                row = db.execute('SELECT id,name,email,password_hash FROM users WHERE email=?', (email,)).fetchone()
            if not row or not verify_password(password, row[3]):
                login_record_failure(rate_key)
                return self._json(401, {'error': 'Email or password is incorrect.'})
            login_clear_failures(rate_key)
            token = self._create_session(row[0])
            return self._json(200, {'ok': True, 'user': {'id': row[0], 'name': row[1], 'email': row[2]}},
                              {'Set-Cookie': self._cookie_header(token, SESSION_DAYS * 86400)})

        if path == '/api/auth/logout':
            self._delete_session()
            return self._json(200, {'ok': True}, {'Set-Cookie': self._cookie_header('', 0)})

        if path == '/api/extension/authorize':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            try:
                payload = self._read_json()
            except ValueError as exc:
                return self._json(400, {'error': str(exc)})
            redirect_uri = str(payload.get('redirect_uri', '')).strip()
            state = str(payload.get('state', '')).strip()[:240]
            extension_id = validate_extension_redirect(redirect_uri)
            if not extension_id or len(state) < 12:
                return self._json(400, {'error': 'Invalid Chrome extension connection request.'})
            token = 'vte_' + secrets.token_urlsafe(32)
            created = utcnow().isoformat()
            with sqlite3.connect(DB_FILE) as db:
                db.execute('UPDATE extension_tokens SET revoked_at=? WHERE user_id=? AND extension_id=? AND revoked_at IS NULL', (created, user['id'], extension_id))
                db.execute('INSERT INTO extension_tokens(token_hash,user_id,extension_id,created_at) VALUES(?,?,?,?)', (token_hash(token), user['id'], extension_id, created))
                db.commit()
            sep = '&' if '#' in redirect_uri else '#'
            redirect_url = redirect_uri + sep + urlencode({'token': token, 'state': state})
            return self._json(201, {'ok': True, 'redirect_url': redirect_url})

        if path == '/api/extension/revoke':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            now = utcnow().isoformat()
            with sqlite3.connect(DB_FILE) as db:
                cur = db.execute('UPDATE extension_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', (now, user['id']))
                db.commit()
            return self._json(200, {'ok': True, 'revoked': cur.rowcount})

        if path == '/api/extension/disconnect-self':
            cors = {'Access-Control-Allow-Origin': '*'}
            ident = self._extension_identity(touch=False)
            if not ident:
                return self._json(401, {'error': 'Extension connection is not valid.'}, cors)
            now = utcnow().isoformat()
            with sqlite3.connect(DB_FILE) as db:
                db.execute('UPDATE extension_tokens SET revoked_at=? WHERE id=?', (now, ident['token_id']))
                db.commit()
            return self._json(200, {'ok': True}, cors)

        if path == '/api/sync/rotate':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            code = 'vts_' + secrets.token_urlsafe(24)
            created = utcnow().isoformat()
            with sqlite3.connect(DB_FILE) as db:
                db.execute('UPDATE users SET sync_token_hash=?, sync_token_created_at=? WHERE id=?', (token_hash(code), created, user['id']))
                db.commit()
            return self._json(201, {'ok': True, 'sync_code': code, 'created_at': created, 'show_once': True})

        if path == '/api/vine-sync':
            cors = {'Access-Control-Allow-Origin': '*'}
            ident = self._extension_identity(touch=True)
            user_id = ident['user_id'] if ident else None
            source = 'chrome_extension' if ident else 'browser_companion_legacy'
            if user_id is None:
                code = self.headers.get('X-VineTrack-Sync-Code', '').strip()
                if code and len(code) <= 200:
                    with sqlite3.connect(DB_FILE) as db:
                        user_row = db.execute('SELECT id FROM users WHERE sync_token_hash=?', (token_hash(code),)).fetchone()
                    if user_row:
                        user_id = user_row[0]
            if user_id is None:
                return self._json(401, {'error': 'Connect the VineTrack Chrome extension to your account first.'}, cors)
            try:
                payload = self._read_json()
            except ValueError as exc:
                return self._json(400, {'error': str(exc)}, cors)
            raw_items = payload.get('items', [])
            if not isinstance(raw_items, list):
                return self._json(400, {'error': 'items must be an array.'}, cors)
            if len(raw_items) > 100:
                return self._json(400, {'error': 'Sync at most 100 visible items at a time.'}, cors)
            items, seen = [], set()
            for raw in raw_items:
                item = clean_sync_item(raw)
                if not item:
                    continue
                key = item['asin'] or item['link'] or item['name'].lower()
                if key in seen:
                    continue
                seen.add(key)
                items.append(item)
            if not items:
                return self._json(400, {'error': 'No usable visible Vine items were found.'}, cors)
            received = utcnow().isoformat()
            stored_payload = {'items': items, 'pageUrl': str(payload.get('pageUrl', ''))[:2000], 'extensionVersion': str(payload.get('extensionVersion', ''))[:40]}
            with sqlite3.connect(DB_FILE) as db:
                cur = db.execute('INSERT INTO vine_imports(user_id,source,payload_json,created_at) VALUES(?,?,?,?)', (user_id, source, json.dumps(stored_payload, ensure_ascii=False), received))
                batch_id = cur.lastrowid
                db.commit()
            return self._json(201, {'ok': True, 'batch_id': batch_id, 'accepted': len(items), 'received_at': received}, cors)

        if path == '/api/vine-sync/consume':
            user = self._current_user()
            if not user:
                return self._json(401, {'error': 'Sign in required.'})
            try:
                payload = self._read_json()
            except ValueError as exc:
                return self._json(400, {'error': str(exc)})
            raw_ids = payload.get('ids', [])
            if not isinstance(raw_ids, list):
                return self._json(400, {'error': 'ids must be an array.'})
            ids = []
            for value in raw_ids[:50]:
                try:
                    ids.append(int(value))
                except Exception:
                    pass
            if ids:
                marks = ','.join('?' for _ in ids)
                with sqlite3.connect(DB_FILE) as db:
                    db.execute(f'UPDATE vine_imports SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL AND id IN ({marks})', (utcnow().isoformat(), user['id'], *ids))
                    db.commit()
            return self._json(200, {'ok': True, 'consumed': len(ids)})

        if path != '/api/feedback':
            return self._json(404, {'error': 'Not found'})
        try:
            payload = self._read_json()
        except ValueError as exc:
            return self._json(400, {'error': str(exc)})
        # Only keep known beta-feedback fields; do not store IP/user-agent.
        allowed = {'at', 'createdAt', 'app', 'useful', 'missing', 'worthPaying', 'wouldPay', 'recommend', 'email', 'usefulness', 'ease', 'mostUseful', 'confusing', 'titleFeedback', 'accuracyFeedback', 'nextFeature', 'priceChoice', 'customPrice', 'anythingElse'}
        clean = {k: str(v)[:5000] for k, v in payload.items() if k in allowed and v is not None}
        clean['server_received_at'] = utcnow().isoformat()
        clean['feedback_id'] = secrets.token_hex(8)
        FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
        with FEEDBACK_FILE.open('a', encoding='utf-8') as f:
            f.write(json.dumps(clean, ensure_ascii=False) + '\n')
        return self._json(201, {'ok': True, 'feedback_id': clean['feedback_id']})


if __name__ == '__main__':
    init_db()
    os.chdir(ROOT)
    print(f'VineTrack Beta v16 running on 0.0.0.0:{PORT}')
    print(f'Database: {DB_FILE}')
    print(f'Feedback file: {FEEDBACK_FILE}')
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
