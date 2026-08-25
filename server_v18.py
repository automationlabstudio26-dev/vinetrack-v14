#!/usr/bin/env python3
"""VineTrack production presentation wrapper.

Keeps the v17 backend/auth/billing/sync implementation intact while ensuring
all user-facing pages render the current VineTrack production identity and the
shared visual refresh instead of legacy beta labels embedded in older templates.
"""
import os
from urllib.parse import urlparse
import server_v17 as v17

_original_landing = v17.production_landing
_original_app = v17.production_app


BRAND_ICON_HREF = '/vinetrack-icon.svg?v=20260825'
BRAND_ICON_STYLE = '''
<style id="vinetrackBrandIconOverride">
body:has(.site-header)::after,
body:has(.app-shell)::after,
body:has(.auth-shell)::after,
body:has(.admin)::after,
body:has(.brand-icon)::after,
body:has(.auth-shell) .auth-story::before{
  background-image:url("/vinetrack-icon.svg?v=20260825")!important;
}
body:has(.site-header) .brand-mark,
body:has(.auth-shell) .logo-mark,
body:has(.app-shell) .sidebar .brand::before,
body:has(.admin) .admin::before{
  background-image:url("/vinetrack-icon.svg?v=20260825"),linear-gradient(135deg,#a9ead7,#78b7ff)!important;
}
</style>
'''


def _ensure_refresh(html):
    href = '/brand-refresh.css'
    additions = []
    if href not in html:
        additions.append('<link rel="stylesheet" href="/brand-refresh.css">')
    if 'rel="icon"' not in html and "rel='icon'" not in html:
        additions.append(f'<link rel="icon" type="image/svg+xml" href="{BRAND_ICON_HREF}">')
    if 'vinetrackBrandIconOverride' not in html:
        additions.append(BRAND_ICON_STYLE)
    if additions:
        html = html.replace('</head>', ''.join(additions) + '</head>')
    return html


def production_landing(html):
    html = _original_landing(html)
    replacements = {
        'Public beta · v14': 'VineTrack v17 · Live',
        'Beta pricing': 'Pricing',
        'Public beta pricing research': 'VineTrack pricing',
        'Free now. Help us decide what Plus should cost.': 'Choose the VineTrack plan that fits your review workflow.',
        'Nothing is charged during the beta. These options are here so testers can tell us what feels reasonable if VineTrack becomes a paid product.': 'Start free, or choose VineTrack Plus for the full review workflow and Chrome sync.',
        'Ready to test it?': 'Ready to get organised?',
        'Beta feedback': 'Product feedback',
        'Beta note:': 'Feedback note:',
        'VineTrack beta server': 'VineTrack server',
        'during the beta': 'in the current release',
        'during beta': 'in VineTrack',
        'VineTrack Sync Chrome extension': 'VineTrack for Chrome',
        'VineTrack Sync Chrome': 'VineTrack for Chrome',
        'VineTrack Sync from Chrome': 'VineTrack for Chrome from the Chrome Web Store',
        'Install VineTrack Sync': 'Install VineTrack for Chrome',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return _ensure_refresh(html)


def production_app(html):
    html = _original_app(html)
    replacements = {
        'VineTrack Beta v15': 'VineTrack v17',
        'Beta v15': 'VineTrack v17',
        'New in VineTrack v17': 'VineTrack for Chrome',
        'New in Beta v15': 'VineTrack for Chrome',
        'VineTrack v15 only receives': 'VineTrack only receives',
        'Beta Landing': 'Home',
        'Send Beta Feedback': 'Send Feedback',
        'beta server': 'server',
        'during beta': 'in this browser',
        'Beta (all preview features unlocked)': 'VineTrack current access',
        'Plan preview': 'Plan',
        'Plus preview': 'Plus',
        'VineTrack Sync Chrome extension': 'VineTrack for Chrome',
        'VineTrack Sync for Chrome': 'VineTrack for Chrome',
        'Amazon Sync': 'VineTrack for Chrome',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return _ensure_refresh(html)


# Patch only the presentation transforms used by the existing v17 handler.
v17.production_landing = production_landing
v17.production_app = production_app


class Handler(v17.Handler):
    def _serve_refreshed_static(self, filename):
        path = v17.base.ROOT / filename
        if not path.exists():
            return None
        html = path.read_text(encoding='utf-8')
        if filename == 'login.html':
            html = html.replace('VineTrack Beta', 'VineTrack')
        return self._html(200, _ensure_refresh(html))

    def do_GET(self):
        path = urlparse(self.path).path
        static_pages = {
            '/login.html': 'login.html',
            '/privacy.html': 'privacy.html',
            '/admin.html': 'admin.html',
        }
        filename = static_pages.get(path)
        if filename:
            return self._serve_refreshed_static(filename)
        return super().do_GET()


if __name__ == '__main__':
    v17.init_db()
    os.chdir(v17.base.ROOT)
    print(f'VineTrack production running on 0.0.0.0:{v17.base.PORT}')
    v17.base.ThreadingHTTPServer(('0.0.0.0', v17.base.PORT), Handler).serve_forever()
