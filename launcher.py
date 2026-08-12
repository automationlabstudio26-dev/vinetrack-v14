#!/usr/bin/env python3
"""Production launcher for VineTrack.

If the Chrome Web Store URL is not explicitly configured but exactly one
published extension ID is locked in VINETRACK_EXTENSION_IDS, derive the
official Chrome Web Store listing URL automatically before server_v17 loads.
"""
import os
import runpy

store_url = os.environ.get('VINETRACK_CHROME_STORE_URL', '').strip()
extension_ids = [
    value.strip().lower()
    for value in os.environ.get('VINETRACK_EXTENSION_IDS', '').split(',')
    if value.strip()
]

if not store_url and len(extension_ids) == 1:
    extension_id = extension_ids[0]
    os.environ['VINETRACK_CHROME_STORE_URL'] = (
        'https://chromewebstore.google.com/detail/vinetrack-for-chrome/'
        + extension_id
    )

runpy.run_module('server_v17', run_name='__main__')
