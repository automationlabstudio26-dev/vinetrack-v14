#!/usr/bin/env python3
"""Production launcher for VineTrack.

Locks the production site to the published VineTrack for Chrome Web Store
listing and extension ID before the production server imports the base config.
"""
import os
import runpy

PUBLISHED_EXTENSION_ID = 'mfgohljjhgoeilbhiopkjdmodmkdknkj'
PUBLISHED_CHROME_STORE_URL = (
    'https://chromewebstore.google.com/detail/vinetrack-for-chrome/'
    + PUBLISHED_EXTENSION_ID
)

os.environ['VINETRACK_CHROME_STORE_URL'] = PUBLISHED_CHROME_STORE_URL
os.environ['VINETRACK_EXTENSION_IDS'] = PUBLISHED_EXTENSION_ID

runpy.run_module('server_v18', run_name='__main__')
