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


ASSET_VERSION = '20260825j'
BRAND_ICON_HREF = f'/brand/vinetrack-icon.png?v={ASSET_VERSION}'
BRAND_ICON_STYLE = f'''
<style id="vinetrackBrandIconOverride">
.vt-brand-img{{display:block!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;flex:0 0 42px!important;object-fit:contain!important;background:none!important;border:0!important;box-shadow:none!important;border-radius:0!important;}}
.vt-preview-brand-img{{display:block!important;width:34px!important;height:34px!important;object-fit:contain!important;}}
.vt-sidebar-brand-img{{display:block!important;width:44px!important;height:44px!important;flex:0 0 44px!important;object-fit:contain!important;}}
.vt-login-brand-img{{display:block!important;width:42px!important;height:42px!important;object-fit:contain!important;}}
body:has(.site-header) .brand{{flex:0 0 auto!important;min-width:max-content!important;}}
body:has(.site-header) .mini-logo{{display:flex!important;align-items:center!important;justify-content:center!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;background:none!important;border:0!important;box-shadow:none!important;}}
body:has(.app-shell) .sidebar .brand::before{{display:none!important;content:none!important;}}
body:has(.auth-shell) .logo-mark{{display:flex!important;align-items:center!important;justify-content:center!important;background:none!important;border:0!important;box-shadow:none!important;}}
body:has(.site-header)::after,
body:has(.app-shell)::after,
body:has(.auth-shell)::after,
body:has(.admin)::after,
body:has(.brand-icon)::after,
body:has(.auth-shell) .auth-story::before{{background-image:url("{BRAND_ICON_HREF}")!important;}}
</style>
'''


def _ensure_refresh(html):
    asset_replacements = {
        'href="landing.css"': f'href="/landing.css?v={ASSET_VERSION}"',
        'href="/landing.css"': f'href="/landing.css?v={ASSET_VERSION}"',
        'href="styles.css"': f'href="/styles.css?v={ASSET_VERSION}"',
        'href="/styles.css"': f'href="/styles.css?v={ASSET_VERSION}"',
        'href="login.css"': f'href="/login.css?v={ASSET_VERSION}"',
        'href="/login.css"': f'href="/login.css?v={ASSET_VERSION}"',
        'href="/production.css"': f'href="/production.css?v={ASSET_VERSION}"',
    }
    for old, new in asset_replacements.items():
        html = html.replace(old, new)

    refresh_href = f'/brand-refresh.css?v={ASSET_VERSION}'
    icon_css_href = f'/brand-icon-v2.css?v={ASSET_VERSION}'
    additions = []
    if refresh_href not in html:
        additions.append(f'<link rel="stylesheet" href="{refresh_href}">')
    if icon_css_href not in html:
        additions.append(f'<link rel="stylesheet" href="{icon_css_href}">')
    if 'rel="icon"' not in html and "rel='icon'" not in html:
        additions.append(f'<link rel="icon" type="image/png" href="{BRAND_ICON_HREF}">')
    if 'vinetrackBrandIconOverride' not in html:
        additions.append(BRAND_ICON_STYLE)
    if additions:
        html = html.replace('</head>', ''.join(additions) + '</head>')
    return html


def _inject_real_brand_images(html):
    html = html.replace(
        '<span class="brand-mark">V</span>',
        f'<img class="brand-mark vt-brand-img" src="{BRAND_ICON_HREF}" alt="" aria-hidden="true" width="42" height="42">'
    )
    html = html.replace(
        '<div class="mini-logo">V</div>',
        f'<div class="mini-logo"><img class="vt-preview-brand-img" src="{BRAND_ICON_HREF}" alt="" aria-hidden="true" width="34" height="34"></div>'
    )
    html = html.replace(
        '<div class="brand">VineTrack</div>',
        f'<div class="brand"><img class="vt-sidebar-brand-img" src="{BRAND_ICON_HREF}" alt="" aria-hidden="true" width="44" height="44"><span>VineTrack</span></div>'
    )
    html = html.replace(
        '<span class="logo-mark">V</span>',
        f'<span class="logo-mark"><img class="vt-login-brand-img" src="{BRAND_ICON_HREF}" alt="" aria-hidden="true" width="42" height="42"></span>'
    )
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
    html = _inject_real_brand_images(html)
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
    html = _inject_real_brand_images(html)
    return _ensure_refresh(html)


v17.production_landing = production_landing
v17.production_app = production_app


class Handler(v17.Handler):
    def _serve_brand_icon(self):
        icon_path = v17.base.ROOT / 'vinetrack-icon.png'
        if not icon_path.exists():
            return self._json(404, {'error': 'Brand icon not found.'})
        return self._send_bytes(200, icon_path.read_bytes(), 'image/png')

    def _serve_refreshed_static(self, filename):
        path = v17.base.ROOT / filename
        if not path.exists():
            return None
        html = path.read_text(encoding='utf-8')
        if filename == 'login.html':
            html = html.replace('VineTrack Beta', 'VineTrack')
        html = _inject_real_brand_images(html)
        return self._html(200, _ensure_refresh(html))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/brand/vinetrack-icon.png':
            return self._serve_brand_icon()
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
