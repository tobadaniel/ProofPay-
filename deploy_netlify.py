#!/usr/bin/env python3
"""Deploy ProofPay to Netlify and wire up the PayPal sandbox env vars.

Steps:
  1. Find or create the site (proofpay-app, then fallbacks).
  2. Set site env vars PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
     PAYPAL_ENV=sandbox through the Netlify env API. The PayPal values are
     read from THIS PROCESS's environment at runtime only; they are never
     written to a file or printed. Verification afterwards lists env KEYS
     only.
  3. Deploy public/ with the file-digest method, plus netlify/functions/
     api.js zipped as the "api" Lambda function (SHA256 in the deploy's
     functions map, uploaded to /deploys/<id>/functions/api?runtime=js).
  4. Lift the visitor gate (sso_login=false).
  5. Poll the deploy until state is ready (or error).

Auth follows the custom.netlify connector pattern exactly: a surrogate
from dynamic_credentials.py is placed on requests to api.netlify.com and
the real token is swapped in on approved egress. File/function uploads
are authorised by the deploy id and carry no credential header of their
own beyond that same surrogate pattern.
"""
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

CREDENTIAL = os.environ.get("NETLIFY_CREDENTIAL", "custom.netlify")
HOSTS = ["api.netlify.com"]
BASE = "https://api.netlify.com/api/v1"

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
FUNCTION_JS = os.path.join(ROOT, "netlify", "functions", "api.js")
SITE_NAMES = [n for n in os.environ.get(
    "SITE_NAMES", "proofpay-app,proofpay-tobadaniel,proofpay-hackathon"
).split(",") if n]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def _open(req, timeout=120):
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return e.code, parsed


def call(method, path, payload=None, raw=None, content_type="application/json"):
    data = raw
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = content_type
    elif raw is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    add_surrogate_to_request(req, CREDENTIAL, allowed_hosts=HOSTS)
    return _open(req)


def call_retry(method, path, payload=None, tries=3):
    """Retry transient egress timeouts the connector doc warns about."""
    last = None
    for i in range(tries):
        try:
            return call(method, path, payload)
        except Exception as exc:  # timeout before any HTTP status
            last = exc
            time.sleep(4)
    raise RuntimeError(f"{method} {path} failed after retries: {last}")


# ---------------------------------------------------------------- sites

def list_sites():
    status, out = call_retry("GET", "/sites?per_page=100")
    if status != 200:
        raise RuntimeError(f"list sites failed: {status} {out}")
    return out


def ensure_site():
    sites = list_sites()
    by_name = {s.get("name"): s for s in sites}
    for name in SITE_NAMES:
        if name in by_name:
            s = by_name[name]
            return {"name": name, "id": s["id"], "ssl_url": s.get("ssl_url"),
                    "created": False}
    for name in SITE_NAMES:
        status, out = call_retry("POST", "/sites", {"name": name})
        if status in (200, 201):
            return {"name": name, "id": out["id"], "ssl_url": out.get("ssl_url"),
                    "created": True}
        if status == 422:
            continue  # subdomain taken globally; try next fallback
        # A timeout may hide a success; re-check before failing.
        sites = list_sites()
        by_name = {s.get("name"): s for s in sites}
        if name in by_name:
            s = by_name[name]
            return {"name": name, "id": s["id"], "ssl_url": s.get("ssl_url"),
                    "created": True}
        raise RuntimeError(f"create site {name} failed: {status} {out}")
    raise RuntimeError("all candidate site names are taken")


# ------------------------------------------------------------------ env

def account_id():
    status, out = call_retry("GET", "/accounts")
    if status != 200 or not out:
        raise RuntimeError(f"list accounts failed: {status}")
    for acct in out:
        if acct.get("slug") == "tobadaniel":
            return acct["id"]
    return out[0]["id"]


def env_keys(acct, site_id):
    q = urllib.parse.urlencode({"site_id": site_id})
    status, out = call_retry("GET", f"/accounts/{acct}/env?{q}")
    if status != 200:
        raise RuntimeError(f"list env failed: {status} {out}")
    return {item.get("key") for item in out}


def set_env(acct, site_id, values):
    existing = env_keys(acct, site_id)
    q = urllib.parse.urlencode({"site_id": site_id})
    for key, value in values.items():
        body = [{"key": key, "values": [{"context": "all", "value": value}]}]
        if key in existing:
            # PUT replaces the single var.
            status, out = call_retry(
                "PUT", f"/accounts/{acct}/env/{urllib.parse.quote(key)}?{q}",
                {"key": key, "values": [{"context": "all", "value": value}]})
        else:
            status, out = call_retry("POST", f"/accounts/{acct}/env?{q}", body)
        if status not in (200, 201, 204):
            raise RuntimeError(f"set env {key} failed: {status} {out}")
    return sorted(env_keys(acct, site_id))


# --------------------------------------------------------------- deploy

def collect_files(root):
    out = {}
    for dirpath, _dirs, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            with open(full, "rb") as fh:
                raw = fh.read()
            out["/" + rel] = (hashlib.sha1(raw).hexdigest(), raw)
    return out


def build_function_zip():
    buf = io.BytesIO()
    with open(FUNCTION_JS, "rb") as fh:
        src = fh.read()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Handler file at zip root, named after the function. Fixed
        # timestamp/attrs so the zip (and its SHA256, which Netlify keys
        # the upload to) is identical on every build.
        info = zipfile.ZipInfo("api.js", date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        zf.writestr(info, src)
    raw = buf.getvalue()
    return hashlib.sha256(raw).hexdigest(), raw


def upload_bytes(path, raw):
    req = urllib.request.Request(
        BASE + path, data=raw, method="PUT",
        headers={"Content-Type": "application/octet-stream"})
    add_surrogate_to_request(req, CREDENTIAL, allowed_hosts=HOSTS)
    return _open(req)


def deploy(site_id, wait_seconds=420):
    files = collect_files(PUBLIC_DIR)
    if not files:
        raise RuntimeError(f"no files under {PUBLIC_DIR}")
    digests = {path: sha for path, (sha, _raw) in files.items()}
    fn_sha, fn_zip = build_function_zip()
    payload = {"files": digests, "functions": {"api": fn_sha}, "async": False}
    status, dep = call_retry("POST", f"/sites/{site_id}/deploys", payload)
    if status not in (200, 201):
        raise RuntimeError(f"create deploy failed: {status} {dep}")
    deploy_id = dep["id"]
    by_sha = {sha: (path, raw) for path, (sha, raw) in files.items()}
    uploads = []
    for sha in dep.get("required") or []:
        if sha not in by_sha:
            raise RuntimeError(f"required file sha {sha} not in local files")
        path, raw = by_sha[sha]
        ustatus, _uresp = upload_bytes(f"/deploys/{deploy_id}/files{path}", raw)
        uploads.append({"path": path, "status": ustatus})
        if ustatus not in (200, 201):
            raise RuntimeError(f"file upload {path} failed: {ustatus}")
    # Netlify lists the function's SHA256 hash (not its name) in
    # required_functions. We always declared the "api" function in this
    # deploy, so always upload its zip.
    if True:
        ustatus, uresp = upload_bytes(
            f"/deploys/{deploy_id}/functions/api?runtime=js", fn_zip)
        uploads.append({"path": "function:api", "status": ustatus})
        if ustatus not in (200, 201):
            raise RuntimeError(f"function upload failed: {ustatus} {uresp}")
    state = dep.get("state")
    final = dep
    deadline = time.time() + wait_seconds
    while state not in ("ready", "error") and time.time() < deadline:
        time.sleep(4)
        s2, final = call_retry("GET", f"/deploys/{deploy_id}")
        if s2 != 200:
            raise RuntimeError(f"poll deploy failed: {s2}")
        state = final.get("state")
    return {
        "deploy_id": deploy_id,
        "state": state,
        "deploy_url": final.get("deploy_url"),
        "ssl_url": final.get("ssl_url"),
        "uploads": uploads,
        "error_message": final.get("error_message"),
    }


# ----------------------------------------------------------------- main

def main():
    client_id = os.environ.get("PAYPAL_CLIENT_ID", "")
    client_secret = os.environ.get("PAYPAL_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        print(json.dumps({"ok": False,
                          "error": "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET "
                                   "must be present in the process environment"}))
        return 1

    site = ensure_site()
    acct = account_id()
    keys = set_env(acct, site["id"], {
        "PAYPAL_CLIENT_ID": client_id,
        "PAYPAL_CLIENT_SECRET": client_secret,
        "PAYPAL_ENV": "sandbox",
    })
    result = deploy(site["id"])
    status, updated = call_retry("PUT", f"/sites/{site['id']}",
                                 {"sso_login": False})
    sso_off = None
    if status == 200:
        sso_off = updated.get("sso_login") is False
    status, site_now = call_retry("GET", f"/sites/{site['id']}")
    out = {
        "ok": result["state"] == "ready",
        "site_name": site["name"],
        "site_id": site["id"],
        "site_created_now": site["created"],
        "ssl_url": (site_now.get("ssl_url") if status == 200 else None)
                   or site.get("ssl_url"),
        "sso_login": site_now.get("sso_login") if status == 200 else None,
        "env_keys_confirmed": keys,
        "deploy": result,
    }
    print(json.dumps(out, indent=1))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
