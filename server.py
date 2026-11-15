"""Glacier Guardian server: serves the site and a small account API (Python standard library only).

One WSGI app (`application`) runs everywhere:
  local:            python3 server.py [port]      -> http://localhost:8000
  PythonAnywhere:   WSGI file does `from server import application`

Data: server_data/gg.db (users, sessions, observations) and server_data/photos/ - never served as static files.

API (JSON):
  POST /api/signup {email, name, password}   POST /api/login {email, password}   POST /api/logout
  GET  /api/me
  GET  /api/obs                 -> the signed-in user's observations
  POST /api/obs {id, type, date, lat, lon, note, glacier, km, photoData?}
  DELETE /api/obs/<id>
  GET  /api/photo/<id>          -> photo of one of the user's own observations
"""
import base64, hashlib, hmac, json, mimetypes, os, re, secrets, sqlite3, sys, time
from http.cookies import SimpleCookie

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "server_data")
PHOTOS = os.path.join(DATA, "photos")
STATIC_EXT = {".html", ".js", ".css", ".webp", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".json"}
MAX_BODY = 8 * 1024 * 1024
SESSION_DAYS = 30
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
ID_RE = re.compile(r"^[a-z0-9]{1,32}$")
STATUS = {200: "200 OK", 400: "400 Bad Request", 401: "401 Unauthorized", 403: "403 Forbidden",
          404: "404 Not Found", 405: "405 Method Not Allowed", 409: "409 Conflict", 413: "413 Payload Too Large"}


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


class Request:
    def __init__(self, env):
        self.env = env
        self.method = env["REQUEST_METHOD"]
        self.path = env.get("PATH_INFO") or "/"
        self.https = env.get("wsgi.url_scheme") == "https" or env.get("HTTP_X_FORWARDED_PROTO") == "https"
        self.cookie = None  # Set-Cookie value to send back

    def body(self):
        try:
            n = int(self.env.get("CONTENT_LENGTH") or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY:
            raise ValueError("too_big")
        try:
            j = json.loads(self.env["wsgi.input"].read(n) or b"{}")
        except ValueError:
            raise ValueError("bad_json")
        if not isinstance(j, dict):
            raise ValueError("bad_json")
        return j

    def token(self):
        c = SimpleCookie(self.env.get("HTTP_COOKIE") or "")
        return c["gg_session"].value if "gg_session" in c else None

    def set_cookie(self, value, max_age):
        self.cookie = f"gg_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}" + ("; Secure" if self.https else "")

    def same_origin(self):
        # CSRF guard for state-changing requests: browsers always send Origin on POST/DELETE fetches
        o = self.env.get("HTTP_ORIGIN")
        return o is None or o.split("://", 1)[-1] == self.env.get("HTTP_HOST")


def json_resp(req, code, obj):
    h = [("Content-Type", "application/json"), ("Cache-Control", "no-store")]
    if req.cookie:
        h.append(("Set-Cookie", req.cookie))
    return code, h, json.dumps(obj).encode()


def file_resp(fp, cache):
    with open(fp, "rb") as f:
        b = f.read()
    ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
        ctype += "; charset=utf-8"
    return 200, [("Content-Type", ctype), ("Cache-Control", cache)], b


def not_found():
    return 404, [("Content-Type", "text/plain")], b"Not found"


# ---------- static: only site files, never server_data or source ----------
def static(req):
    if req.method != "GET":
        return 405, [("Content-Type", "text/plain")], b"Method not allowed"
    rel = "index.html" if req.path in ("", "/") else req.path.lstrip("/")
    fp = os.path.realpath(os.path.join(ROOT, rel))
    if not fp.startswith(ROOT + os.sep) or rel.startswith("server_data") or os.path.splitext(fp)[1].lower() not in STATIC_EXT \
            or not os.path.isfile(fp):
        return not_found()
    return file_resp(fp, "no-cache")  # always revalidate so updates show at once


# ---------- API ----------
def api(req, c):
    path, method = req.path, req.method
    if path == "/api/signup" and method == "POST":
        j = req.body()
        email = str(j.get("email", "")).strip().lower()
        name = str(j.get("name", "")).strip()[:60]
        pw = str(j.get("password", ""))
        if not EMAIL_RE.match(email):
            return json_resp(req, 400, {"error": "email"})
        if len(pw) < 8 or len(pw) > 200:
            return json_resp(req, 400, {"error": "short"})
        if not name:
            return json_resp(req, 400, {"error": "name"})
        if c.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            return json_resp(req, 409, {"error": "exists"})
        salt = secrets.token_bytes(16)
        uid = c.execute("INSERT INTO users(email, name, salt, pw, created) VALUES (?,?,?,?,?)",
                        (email, name, salt, hash_pw(pw, salt), time.time())).lastrowid
        start_session(req, c, uid)
        return json_resp(req, 200, {"email": email, "name": name})

    if path == "/api/login" and method == "POST":
        j = req.body()
        email = str(j.get("email", "")).strip().lower()
        pw = str(j.get("password", ""))[:200]
        u = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        # shortcut: no rate limiting of login attempts; add one before heavy public use
        if not u or not hmac.compare_digest(hash_pw(pw, u["salt"]), u["pw"]):
            return json_resp(req, 401, {"error": "bad"})
        start_session(req, c, u["id"])
        return json_resp(req, 200, {"email": u["email"], "name": u["name"]})

    if path == "/api/logout" and method == "POST":
        tok = req.token()
        if tok:
            c.execute("DELETE FROM sessions WHERE token = ?", (tok,))
        req.set_cookie("", 0)
        return json_resp(req, 200, {})

    u = current_user(req, c)
    if path == "/api/me" and method == "GET":
        return json_resp(req, 200, {"email": u["email"], "name": u["name"]} if u else None)
    if not u:
        return json_resp(req, 401, {"error": "login"})

    if path == "/api/obs" and method == "GET":
        rows = c.execute("SELECT data FROM obs WHERE user_id = ? ORDER BY created DESC", (u["id"],)).fetchall()
        return json_resp(req, 200, [json.loads(r["data"]) for r in rows])

    if path == "/api/obs" and method == "POST":
        j = req.body()
        oid = str(j.get("id", ""))
        if not ID_RE.match(oid):
            return json_resp(req, 400, {"error": "id"})
        try:
            lat, lon = float(j["lat"]), float(j["lon"])
            typ, km = int(j.get("type", 0)), float(j.get("km", 0))
        except (KeyError, TypeError, ValueError):
            return json_resp(req, 400, {"error": "fields"})
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return json_resp(req, 400, {"error": "fields"})
        photo = j.get("photoData")
        if photo:
            m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", str(photo), re.S)
            if not m:
                return json_resp(req, 400, {"error": "photo"})
            try:
                raw = base64.b64decode(m.group(2), validate=True)
            except ValueError:
                return json_resp(req, 400, {"error": "photo"})
            with open(os.path.join(PHOTOS, f"{u['id']}_{oid}"), "wb") as f:
                f.write(raw)
        o = {"id": oid, "type": typ, "date": str(j.get("date", ""))[:10], "lat": lat, "lon": lon,
             "note": str(j.get("note", ""))[:2000], "who": u["name"], "glacier": str(j.get("glacier", ""))[:32],
             "km": km, "photo": bool(photo), "created": str(j.get("created", ""))[:40], "srv": True}
        c.execute("INSERT OR REPLACE INTO obs VALUES (?,?,?,?,?)", (oid, u["id"], json.dumps(o), int(bool(photo)), time.time()))
        return json_resp(req, 200, o)

    m = re.match(r"^/api/(obs|photo)/([a-z0-9]{1,32})$", path)
    if m and m.group(1) == "obs" and method == "DELETE":
        c.execute("DELETE FROM obs WHERE user_id = ? AND id = ?", (u["id"], m.group(2)))
        fp = os.path.join(PHOTOS, f"{u['id']}_{m.group(2)}")
        if os.path.exists(fp):
            os.remove(fp)
        return json_resp(req, 200, {})
    if m and m.group(1) == "photo" and method == "GET":
        fp = os.path.join(PHOTOS, f"{u['id']}_{m.group(2)}")
        if not os.path.exists(fp):
            return not_found()
        code, h, b = file_resp(fp, "private, max-age=3600")
        return code, [("Content-Type", "image/jpeg"), h[1]], b
    return json_resp(req, 404, {"error": "not_found"})


def start_session(req, c, uid):
    tok = secrets.token_urlsafe(32)
    c.execute("INSERT INTO sessions VALUES (?,?,?)", (tok, uid, time.time() + SESSION_DAYS * 86400))
    req.set_cookie(tok, SESSION_DAYS * 86400)


def current_user(req, c):
    tok = req.token()
    if not tok:
        return None
    return c.execute("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id "
                     "WHERE s.token = ? AND s.expires > ?", (tok, time.time())).fetchone()


def application(env, start_response):
    req = Request(env)
    if req.path.startswith("/api/"):
        if req.method != "GET" and not req.same_origin():
            code, h, b = json_resp(req, 403, {"error": "origin"})
        else:
            try:
                with db() as c:
                    code, h, b = api(req, c)
            except ValueError as e:
                code, h, b = json_resp(req, 413 if str(e) == "too_big" else 400, {"error": str(e)})
    else:
        code, h, b = static(req)
    start_response(STATUS[code], h + [("Content-Length", str(len(b)))])
    return [b]


init_db()  # runs on import too, so the PythonAnywhere WSGI file needs nothing else

if __name__ == "__main__":
    from socketserver import ThreadingMixIn
    from wsgiref.simple_server import WSGIServer, make_server

    class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
        daemon_threads = True

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Glacier Guardian: http://localhost:{port}", flush=True)
    make_server("127.0.0.1", port, application, server_class=ThreadingWSGIServer).serve_forever()
