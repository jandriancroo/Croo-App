"""Resume bounded Aloha actual-sales gap batches using the internal cron secret.

Runs at most five dates per request. Stops on access blocks, exhausted retries,
or --max-batches. No scheduler is installed. Secret values are never printed.
"""
import argparse
import os
import time
import requests

parser = argparse.ArgumentParser()
parser.add_argument('--location-id', required=True)
parser.add_argument('--max-batches', type=int, default=1)
args = parser.parse_args()
url = os.environ['SUPABASE_URL'].rstrip('/') + '/functions/v1/aloha-sync'
headers = {'x-cron-secret': os.environ['CRON_SECRET'], 'apikey': os.environ['SUPABASE_PUBLISHABLE_KEY']}
for index in range(max(0, args.max_batches)):
    response = requests.post(url, headers=headers, json={'action': 'backfill_history', 'locationId': args.location_id}, timeout=240)
    if response.status_code != 200:
        print('Backfill stopped: request failed', response.status_code)
        break
    result = response.json()
    rows = result.get('results', [])
    print('Batch', index + 1, [(row.get('date'), row.get('status')) for row in rows])
    if not rows or any(row.get('status') == 'blocked' for row in rows):
        break
    if index + 1 < args.max_batches:
        time.sleep(30)