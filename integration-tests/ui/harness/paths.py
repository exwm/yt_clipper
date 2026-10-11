from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
USERSCRIPT_SOURCE = REPO / "src" / "markup" / "yt_clipper.ts"
BUNDLE = REPO / "dist" / "js" / "yt_clipper.js"
SITE_PAGE = REPO / "site" / "index.html"
SANDBOX = REPO / "sandbox"
DEV_SITE = SANDBOX / "dev-site"
SHOTS = SANDBOX / "ui-shots"
