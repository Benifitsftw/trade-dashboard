import requests
import json
import time
import os
from datetime import datetime

# ── Config ─────────────────────────────────────────────────────────────
UPSTASH_URL = "https://wanted-sponge-143655.upstash.io"
UPSTASH_TOKEN = "gQAAAAAAAjEnAAIgcDFkYWZjZDY1YjA5MjY0ZjI5YmM3NzE3ZjdlMTQzMDFlOQ"
REFRESH_INTERVAL = 60
TOKEN_FILE = os.path.join(os.path.expanduser("~"), "Desktop", "qt_token.txt")

# ── Token persistence ──────────────────────────────────────────────────
def save_token(token):
    try:
        with open(TOKEN_FILE, 'w') as f:
            f.write(token.strip())
    except Exception as e:
        print(f"Could not save token: {e}")

def load_token():
    try:
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, 'r') as f:
                t = f.read().strip()
                if t:
                    return t
    except:
        pass
    return None

# ── Upstash REST API ───────────────────────────────────────────────────
def redis_set(key, value):
    try:
        val = json.dumps(value)
        resp = requests.post(
            f"{UPSTASH_URL}/set/{key}",
            headers={
                "Authorization": f"Bearer {UPSTASH_TOKEN}",
                "Content-Type": "application/json"
            },
            data=json.dumps(val),
            timeout=10
        )
        result = resp.json()
        if result.get('result') == 'OK':
            return True
        print(f"Redis response: {result}")
        return False
    except Exception as e:
        print(f"Redis error: {e}")
        return False

def redis_get(key):
    try:
        resp = requests.get(
            f"{UPSTASH_URL}/get/{key}",
            headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
            timeout=10
        )
        result = resp.json()
        val = result.get('result')
        if val:
            return json.loads(json.loads(val))
        return None
    except Exception as e:
        print(f"Redis get error: {e}")
        return None

# ── Questrade client ───────────────────────────────────────────────────
class QuestradeClient:
    def __init__(self, token):
        self.refresh_token = token
        self.access_token = None
        self.api_server = None
        self.account_id = None

    def connect(self):
        print("Connecting to Questrade...")
        resp = requests.post(
            f"https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token={self.refresh_token}"
        )
        data = resp.json()
        if 'access_token' not in data:
            raise Exception(f"Auth failed: {data.get('error_description', str(data))}")
        self.access_token = data['access_token']
        self.refresh_token = data.get('refresh_token', self.refresh_token)
        self.api_server = data['api_server']
        save_token(self.refresh_token)
        print(f"Connected. Server: {self.api_server}")

    def headers(self):
        return {'Authorization': f'Bearer {self.access_token}'}

    def find_account(self):
        resp = requests.get(f"{self.api_server}v1/accounts", headers=self.headers())
        accounts = resp.json().get('accounts', [])
        margin = [a for a in accounts if a['type'] == 'Margin']
        if not margin:
            raise Exception("No margin accounts found")
        if len(margin) == 1:
            return margin[0]['number']
        best_id, best_eq = None, -1
        for acc in margin:
            try:
                bal = requests.get(
                    f"{self.api_server}v1/accounts/{acc['number']}/balances",
                    headers=self.headers()
                ).json()
                combined = next((b for b in bal.get('combinedBalances', []) if b['currency'] == 'USD'), {})
                eq = combined.get('totalEquity', 0)
                print(f"  Account {acc['number']}: ${eq:.2f}")
                if eq > best_eq:
                    best_eq = eq
                    best_id = acc['number']
            except:
                pass
        print(f"Selected: {best_id}")
        return best_id

    def fetch_balances(self):
        if not self.account_id:
            self.account_id = self.find_account()
        bal = requests.get(
            f"{self.api_server}v1/accounts/{self.account_id}/balances",
            headers=self.headers()
        ).json()
        combined = next((b for b in bal.get('combinedBalances', []) if b['currency'] == 'USD'), {})
        def safe(val, default=0):
            return round(val if val is not None else default, 2)
        return {
            'rtbp': safe(combined.get('maintenanceExcess')),
            'totalEquity': safe(combined.get('totalEquity')),
            'cash': safe(combined.get('cash')),
            'marketValue': safe(combined.get('marketValue')),
            'timestamp': datetime.now().isoformat(),
            'account': self.account_id
        }

    def fetch_positions(self):
        if not self.account_id:
            self.account_id = self.find_account()
        resp = requests.get(
            f"{self.api_server}v1/accounts/{self.account_id}/positions",
            headers=self.headers()
        ).json()
        positions = []
        for p in resp.get('positions', []):
            if (p.get('openQuantity') or 0) == 0:
                continue
            cost = p.get('totalCost') or 0
            mkt = p.get('currentMarketValue') or 0
            pl = p.get('openPnl') or 0
            pl_pct = ((mkt - cost) / cost * 100) if cost and cost != 0 else 0
            positions.append({
                'symbol': p.get('symbol', ''),
                'qty': p.get('openQuantity', 0),
                'avgPrice': round(p.get('averageEntryPrice') or 0, 4),
                'currentPrice': round(p.get('currentPrice') or 0, 4),
                'marketValue': round(mkt, 2),
                'openPL': round(pl, 2),
                'openPLPct': round(pl_pct, 1),
                'totalCost': round(cost, 2)
            })
        return positions

    def fetch_orders(self):
        if not self.account_id:
            self.account_id = self.find_account()
        # Fetch open/pending orders only
        resp = requests.get(
            f"{self.api_server}v1/accounts/{self.account_id}/orders?stateFilter=opened",
            headers=self.headers()
        ).json()
        orders = []
        for o in resp.get('orders', []):
            if not o.get('symbol'):
                continue
            orders.append({
                'symbol': o.get('symbol', ''),
                'action': o.get('side', ''),
                'qty': o.get('totalQuantity', 0),
                'limitPrice': o.get('limitPrice'),
                'stopPrice': o.get('stopPrice'),
                'orderType': o.get('orderType', ''),
                'timeInForce': o.get('timeInForce', ''),
                'status': o.get('state', ''),
            })
        return orders

# ── Main ───────────────────────────────────────────────────────────────
def main():
    print("=" * 50)
    print("Trade Dashboard — Live Sync")
    print("=" * 50)

    token = load_token()
    if token:
        print("\nFound saved token — using it")
    else:
        token = input("\nPaste your Questrade refresh token: ").strip()

    if not token:
        print("No token. Exiting.")
        return

    client = QuestradeClient(token)
    try:
        client.connect()
    except Exception as e:
        print(f"Connection failed: {e}")
        if os.path.exists(TOKEN_FILE):
            os.remove(TOKEN_FILE)
            print("Cleared bad token.")
        return

    print(f"\nSyncing every {REFRESH_INTERVAL}s. Ctrl+C to stop.\n")
    errors = 0

    while True:
        try:
            # Fetch all data
            bal = client.fetch_balances()
            positions = client.fetch_positions()
            orders = client.fetch_orders()

            # Push to Redis
            bal_ok = redis_set('balance', bal)
            pos_ok = redis_set('positions', positions)
            ord_ok = redis_set('orders', orders)

            now = datetime.now().strftime('%H:%M:%S')
            rtbp = bal['rtbp']
            eq = bal['totalEquity']
            pct = (rtbp / eq * 100) if eq > 0 else 0
            risk = 'LIGHT' if pct >= 33 else 'MODERATE' if pct >= 25 else 'HEAVY'
            b_status = '✓' if bal_ok else '✗'
            p_status = '✓' if pos_ok else '✗'
            o_status = '✓' if ord_ok else '✗'
            print(f"[{now}] bal:{b_status} pos:{p_status} ord:{o_status} | RTBP: ${rtbp:,.2f} | Equity: ${eq:,.2f} | {pct:.1f}% → {risk} | {len(positions)} pos · {len(orders)} orders")

            errors = 0
            time.sleep(REFRESH_INTERVAL)

        except KeyboardInterrupt:
            print("\nStopped.")
            break
        except Exception as e:
            print(f"Error: {e}")
            errors += 1
            time.sleep(10)
            if errors >= 5:
                try:
                    client.connect()
                    errors = 0
                except:
                    pass

if __name__ == '__main__':
    main()
