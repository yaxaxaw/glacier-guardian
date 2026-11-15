"""Glacier Guardian server: serves the site and a small account API (Python stdlib only).

Run:  python3 server.py            -> http://localhost:8000
Data: server_data/gg.db (users, sessions, observations) and server_data/photos/ - never served as static files.

API (JSON):
  POST /api/signup {email, name, password}   POST /api/login {email, password}   POST /api/logout
  GET  /api/me
  GET  /api/obs                 -> the signed-in user's observations
  POST /api/obs {id, type, date, lat, lon, note, glacier, km, photoData?}
  DELETE /api/obs/<id>
  GET  /api/photo/<id>          -> photo of one of the user's own observations
"""
import base64, hashlib, hmac, http.server, json, os, re, secrets, sqlite3, sys, time
from http.cookies import SimpleCookie

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "server_data")
PHOTOS = os.path.join(DATA, "photos")
STATIC_EXT = {".html", ".js", ".css", ".webp", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".json"}
MAX_BODY = 8 * 1024 * 1024
SESSION_DAYS = 30
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
ID_RE = re.compile(r"^[a-z0-9]{1,32}$")


def db():
    c = sqlite3.connect(os.path.join(DATA, "gg.db"))
    c.row_factory = sqlite3.Row
    return c


def init_db():
    os.makedirs(PHOTOS, exist_ok=True)
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            salt BLOB NOT NULL, pw BLOB NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS obs(id TEXT NOT NULL, user_id INTEGER NOT NULL, data TEXT NOT NULL, photo INTEGER NOT NULL,
            created REAL NOT NULL, PRIMARY KEY(user_id, id));
        """)


def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    # ---------- helpers ----------
    def send_json(self, code, obj, cookie=None):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("too_big")
        try:
            j = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise ValueError("bad_json")
        if not isinstance(j, dict):
            raise ValueError("bad_json")
        return j

    def token(self):
        c = SimpleCookie(self.headers.get("Cookie") or "")
        return c["gg_session"].value if "gg_session" in c else None

    def user(self, c):
        tok = self.token()
        if not tok:
            return None
        return c.execute("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id "
                         "WHERE s.token = ? AND s.expires > ?", (tok, time.time())).fetchone()

    def start_session(self, c, uid):
        tok = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions VALUES (?,?,?)", (tok, uid, time.time() + SESSION_DAYS * 86400))
        return f"gg_session={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"

    def same_origin(self):
        # CSRF guard for state-changing requests: browsers always send Origin on POST/DELETE fetches
        o = self.headers.get("Origin")
        return o is None or o.split("://", 1)[-1] == self.headers.get("Host")

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")  # site files: always revalidate so updates show at once
        super().end_headers()

    # ---------- static: only site files, never server_data or source ----------
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        p = self.path.split("?", 1)[0].split("#", 1)[0]
        if p == "/" or p == "":
            return super().do_GET()
        ext = os.path.splitext(p)[1].lower()
        if p.startswith("/server_data") or ext not in STATIC_EXT:
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        return self.send_error(405)

    def do_POST(self):
        return self.api("POST")

    def do_DELETE(self):
        return self.api("DELETE")

    # ---------- API ----------
    def api(self, method):
        if method != "GET" and not self.same_origin():
            return self.send_json(403, {"error": "origin"})
        path = self.path.split("?", 1)[0]
        try:
            with db() as c:
                return self.route(c, method, path)
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})

    def route(self, c, method, path):
        if path == "/api/signup" and method == "POST":
            j = self.body()
            email = str(j.get("email", "")).strip().lower()
            name = str(j.get("name", "")).strip()[:60]
            pw = str(j.get("password", ""))
            if not EMAIL_RE.match(email):
                return self.send_json(400, {"error": "email"})
            if len(pw) < 8 or len(pw) > 200:
                return self.send_json(400, {"error": "short"})
            if not name:
                return self.send_json(400, {"error": "name"})
            if c.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                return self.send_json(409, {"error": "exists"})
            salt = secrets.token_bytes(16)
            uid = c.execute("INSERT INTO users(email, name, salt, pw, created) VALUES (?,?,?,?,?)",
                            (email, name, salt, hash_pw(pw, salt), time.time())).lastrowid
            return self.send_json(200, {"email": email, "name": name}, self.start_session(c, uid))

        if path == "/api/login" and method == "POST":
            j = self.body()
            email = str(j.get("email", "")).strip().lower()
            pw = str(j.get("password", ""))[:200]
            u = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            # shortcut: no rate limiting of login attempts; add one before running this on the public internet
            if not u or not hmac.compare_digest(hash_pw(pw, u["salt"]), u["pw"]):
                return self.send_json(401, {"error": "bad"})
            return self.send_json(200, {"email": u["email"], "name": u["name"]}, self.start_session(c, u["id"]))

        if path == "/api/logout" and method == "POST":
            tok = self.token()
            if tok:
                c.execute("DELETE FROM sessions WHERE token = ?", (tok,))
            return self.send_json(200, {}, "gg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

        u = self.user(c)
        if path == "/api/me" and method == "GET":
            return self.send_json(200, {"email": u["email"], "name": u["name"]} if u else None)
        if not u:
            return self.send_json(401, {"error": "login"})

        if path == "/api/obs" and method == "GET":
            rows = c.execute("SELECT data FROM obs WHERE user_id = ? ORDER BY created DESC", (u["id"],)).fetchall()
            return self.send_json(200, [json.loads(r["data"]) for r in rows])

        if path == "/api/obs" and method == "POST":
            j = self.body()
            oid = str(j.get("id", ""))
            if not ID_RE.match(oid):
                return self.send_json(400, {"error": "id"})
            try:
                lat, lon = float(j["lat"]), float(j["lon"])
                typ, km = int(j.get("type", 0)), float(j.get("km", 0))
            except (KeyError, TypeError, ValueError):
                return self.send_json(400, {"error": "fields"})
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                return self.send_json(400, {"error": "fields"})
            photo = j.get("photoData")
            if photo:
                m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", str(photo), re.S)
                if not m:
                    return self.send_json(400, {"error": "photo"})
                try:
                    raw = base64.b64decode(m.group(2), validate=True)
                except ValueError:
                    return self.send_json(400, {"error": "photo"})
                with open(os.path.join(PHOTOS, f"{u['id']}_{oid}"), "wb") as f:
                    f.write(raw)
            o = {"id": oid, "type": typ, "date": str(j.get("date", ""))[:10], "lat": lat, "lon": lon,
                 "note": str(j.get("note", ""))[:2000], "who": u["name"], "glacier": str(j.get("glacier", ""))[:32],
                 "km": km, "photo": bool(photo), "created": str(j.get("created", ""))[:40], "srv": True}
            c.execute("INSERT OR REPLACE INTO obs VALUES (?,?,?,?,?)", (oid, u["id"], json.dumps(o), int(bool(photo)), time.time()))
            return self.send_json(200, o)

        m = re.match(r"^/api/(obs|photo)/([a-z0-9]{1,32})$", path)
        if m and m.group(1) == "obs" and method == "DELETE":
            c.execute("DELETE FROM obs WHERE user_id = ? AND id = ?", (u["id"], m.group(2)))
            fp = os.path.join(PHOTOS, f"{u['id']}_{m.group(2)}")
            if os.path.exists(fp):
                os.remove(fp)
            return self.send_json(200, {})
        if m and m.group(1) == "photo" and method == "GET":
            fp = os.path.join(PHOTOS, f"{u['id']}_{m.group(2)}")
            if not os.path.exists(fp):
                return self.send_error(404)
            b = open(fp, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "private, max-age=3600")
            self.end_headers()
            self.wfile.write(b)
            return
        return self.send_json(404, {"error": "not_found"})


if __name__ == "__main__":
    init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Glacier Guardian: http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
