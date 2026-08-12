#!/usr/bin/env python3
"""Production launcher for VineTrack.

Locks the production site to the published VineTrack for Chrome Web Store
listing and extension ID before server_v17 imports the base server config.
"""
import os
import runpy

PUBLISHED_EXTENSION_ID = 'mfgohljjhgoeilbhiopkjdmodmkdknkj'
PUBLISHED_CHROME_STORE_URL = (
    'https://chromewebstore.google.com/detail/vinetrack-for-chrome/'
    + PUBLISHED_EXTENSION_ID
)

# Keep the website install button and extension authorization bound to the
# extension that is actually published in the Chrome Web Store.
os.environ['VINETRACK_CHROME_STORE_URL'] = PUBLISHED_CHROME_STORE_URL
os.environ['VINETRACK_EXTENSION_IDS'] = PUBLISHED_EXTENSION_ID

runpy.run_module('server_v17', run_name='__main__')
