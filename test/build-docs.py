# สร้างหน้า HTML "ผังระบบ + การทำงาน + ซอร์สโค้ดทั้งหมด" จาก docs/ARCHITECTURE.md และไฟล์ซอร์ส → test/out/architecture.html
import os, re, html, io, sys, datetime
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
md = open(os.path.join(root, "docs", "ARCHITECTURE.md"), encoding="utf-8").read()

FILES = ["index.html", "src/styles.css", "src/config.js", "src/app.js", "src/engine/index.js", "src/engine/extract.js", "src/engine/parse.js",
         "src/engine/rules.js", "src/engine/profiles.js", "src/engine/ocrRules.js", "src/engine/labels.js", "src/data/sites.js",
         "src/ui/images.js", "src/ui/embed.js", "src/ui/ocr.js", "src/ui/learn.js", "src/ui/cloud.js", "src/ui/report.js",
         "supabase/schema.sql", "supabase/no-login.sql", "vercel.json", "package.json",
         "test/run-samples.mjs", "test/serve.mjs", "test/review-report.py", "test/build-docs.py", "test/parse-one.mjs", "test/dump-one.mjs", "test/img-one.mjs", "test/img-digest.mjs"]

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(https?://[^\s<)]+)", r'<a href="\1">\1</a>', t)
    return t

H2 = []
def md_to_html(src):
    out, lines, i = [], src.split("\n"), 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            lang = ln[3:].strip(); buf = []; i += 1
            while i < len(lines) and not lines[i].startswith("```"): buf.append(lines[i]); i += 1
            i += 1
            if lang == "mermaid": out.append('<pre class="mermaid">' + "\n".join(buf) + "</pre>")
            else: out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>")
            continue
        m = re.match(r"^(#{1,3})\s+(.*)", ln)
        if m:
            lvl = len(m.group(1)); txt = m.group(2); sid = re.sub(r"[^a-z0-9ก-๙]+", "-", txt.lower()).strip("-")[:40]
            if lvl == 2: H2.append((sid, re.sub(r"^\d+\.\s*", "", txt)))
            out.append(f"<h{lvl} id=\"{sid}\">{inline(txt)}</h{lvl}>"); i += 1; continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"): rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows if not re.match(r"^\|[\s\-:|]+\|$", r)]
            if cells:
                head = "".join(f"<th>{inline(c)}</th>" for c in cells[0])
                body = "".join("<tr>" + "".join(f"<td>{inline(c.replace(chr(92) + '|', '|'))}</td>" for c in r) + "</tr>" for r in cells[1:])
                out.append(f'<div class="tbl"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            continue
        if re.match(r"^\s*[-*]\s+", ln) or re.match(r"^\s*\d+\.\s+", ln):
            ordered = bool(re.match(r"^\s*\d+\.", ln)); items = []
            while i < len(lines) and (re.match(r"^\s*[-*]\s+", lines[i]) or re.match(r"^\s*\d+\.\s+", lines[i])):
                items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lines[i])); i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>"); continue
        if not ln.strip(): i += 1; continue
        para = [ln]; i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|\s*[-*]\s|\s*\d+\.\s)", lines[i]): para.append(lines[i]); i += 1
        out.append("<p>" + inline(" ".join(para)) + "</p>")
    return "\n".join(out)

body = md_to_html(md)

LANG = {".js": "javascript", ".mjs": "javascript", ".html": "xml", ".css": "css", ".sql": "sql", ".json": "json", ".py": "python"}
code_sections, toc = [], []
for f in FILES:
    p = os.path.join(root, f)
    if not os.path.exists(p): continue
    src = open(p, encoding="utf-8").read()
    n = src.count("\n") + 1
    sid = "f-" + re.sub(r"[^a-z0-9]+", "-", f.lower())
    toc.append(f'<a href="#{sid}">{html.escape(f)}</a><span class="n">{n}</span>')
    code_sections.append(f'<details id="{sid}"><summary><code>{html.escape(f)}</code><span class="n">{n} บรรทัด</span></summary><pre><code class="language-{LANG.get(os.path.splitext(f)[1], "plaintext")}">{html.escape(src)}</code></pre></details>')

page = f"""<title>SATP Checker Architecture</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
/* layout: เอกสารเทคนิคคอลัมน์เดียว 72ch + ตารางและโค้ดกว้างเต็ม 1100px · โค้ดพับได้ทีละไฟล์ */
:root {{ --bg:#f7f6f2; --fg:#1c2430; --mute:#5c6673; --line:#d9d6cc; --card:#ffffff; --accent:#0b5fa5; --accent-bg:#e6f0fa; --code-bg:#f1efe8; --code-fg:#1c2430; --kw:#8a2d8f; --str:#1c6b3a; --cm:#6b7280; --num:#b45309;
  --display:'Sarabun', 'Noto Sans Thai', system-ui, sans-serif; --mono:'IBM Plex Mono', Consolas, monospace; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#141a22; --fg:#e6e9ee; --mute:#9aa6b4; --line:#2b3542; --card:#1b232e; --accent:#6db3ff; --accent-bg:#1a2a3d; --code-bg:#10161e; --code-fg:#dfe5ec; --kw:#d59cf0; --str:#8fd6a9; --cm:#7f8b99; --num:#f3b76a; color-scheme:dark }} }}
:root[data-theme="dark"] {{ --bg:#141a22; --fg:#e6e9ee; --mute:#9aa6b4; --line:#2b3542; --card:#1b232e; --accent:#6db3ff; --accent-bg:#1a2a3d; --code-bg:#10161e; --code-fg:#dfe5ec; --kw:#d59cf0; --str:#8fd6a9; --cm:#7f8b99; --num:#f3b76a; color-scheme:dark }}
body {{ background:var(--bg); color:var(--fg); font-family:var(--display); font-size:15.5px; line-height:1.65; margin:0; padding-block:24px 64px; padding-inline:16px; }}
.wrap {{ max-width:1100px; margin:0 auto; }}
h1 {{ font-size:30px; line-height:1.2; margin:0 0 4px; text-wrap:balance; }}
.sub {{ color:var(--mute); margin:0 0 24px; }}
h2 {{ font-size:21px; margin:36px 0 10px; padding-top:12px; border-top:1px solid var(--line); text-wrap:balance; }}
h3 {{ font-size:17px; margin:22px 0 6px; }}
p, li {{ max-width:78ch; }}
code {{ font-family:var(--mono); font-size:0.88em; background:var(--code-bg); padding:1px 5px; border-radius:4px; }}
pre {{ background:var(--code-bg); color:var(--code-fg); padding:12px 14px; border-radius:6px; overflow-x:auto; font-family:var(--mono); font-size:12.5px; line-height:1.5; margin:8px 0 16px; }}
pre code {{ background:none; padding:0; font-size:inherit; }}
pre.mermaid {{ background:var(--card); border:1px solid var(--line); padding:16px; overflow-x:auto; }}
.tbl {{ overflow-x:auto; margin:8px 0 16px; }}
table {{ border-collapse:collapse; width:100%; font-size:14px; }}
th, td {{ border:1px solid var(--line); padding:6px 9px; vertical-align:top; text-align:left; }}
th {{ background:var(--accent-bg); font-weight:600; }}
td {{ font-variant-numeric:tabular-nums; }}
a {{ color:var(--accent); }}
.nav {{ display:flex; flex-wrap:wrap; gap:6px 14px; font-size:14px; margin:0 0 8px; }}
.toc {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:4px 16px; font-family:var(--mono); font-size:13px; margin:8px 0 16px; }}
.toc a {{ display:flex; justify-content:space-between; gap:8px; min-width:0; text-decoration:none; border-bottom:1px dotted var(--line); padding:3px 0; }}
.toc .n, summary .n {{ color:var(--mute); font-size:12px; margin-left:10px; }}
details {{ border:1px solid var(--line); border-radius:6px; margin:8px 0; background:var(--card); }}
summary {{ cursor:pointer; padding:9px 12px; font-family:var(--mono); font-size:14px; display:flex; align-items:center; }}
summary code {{ background:none; padding:0; font-size:14px; }}
details[open] summary {{ border-bottom:1px solid var(--line); }}
details pre {{ margin:0; border-radius:0 0 6px 6px; max-height:70vh; overflow:auto; }}
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-tag {{ color:var(--kw); }}
.hljs-string, .hljs-attr, .hljs-selector-class {{ color:var(--str); }}
.hljs-comment {{ color:var(--cm); font-style:italic; }}
.hljs-number, .hljs-literal {{ color:var(--num); }}
.btns {{ display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 12px; }}
button {{ font:inherit; font-size:13px; padding:5px 10px; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:5px; cursor:pointer; }}
button:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px; }}
@media (prefers-reduced-motion: reduce) {{ * {{ scroll-behavior:auto !important; }} }}
</style>
<div class="wrap">
<h1>SATP Checker — ผังระบบและซอร์สโค้ด</h1>
<p class="sub">TIME.com Project (AGRID 2.0 / DC2DC) · Nokia Field Service · สร้างจาก docs/ARCHITECTURE.md และซอร์สใน repo เมื่อ {datetime.date.today().isoformat()}</p>
<nav class="nav">{"".join(f'<a href="#{sid}">{html.escape(t)}</a>' for sid, t in H2)}<a href="#source">ซอร์สโค้ด</a></nav>
{body}
<h2 id="source">15. ซอร์สโค้ดทั้งหมด ({len(code_sections)} ไฟล์)</h2>
<p>กดชื่อไฟล์เพื่อขยาย เนื้อหาตรงกับ repo ณ วันที่สร้างหน้า</p>
<div class="btns"><button type="button" id="open-all">ขยายทั้งหมด</button><button type="button" id="close-all">พับทั้งหมด</button></div>
<div class="toc">{"".join(toc)}</div>
{"".join(code_sections)}
</div>
<script>
(function () {{
  function hl() {{ if (!window.hljs) return; document.querySelectorAll('details pre code').forEach(function (el) {{ if (!el.dataset.hl) {{ hljs.highlightElement(el); el.dataset.hl = '1'; }} }}); }}
  document.querySelectorAll('details').forEach(function (d) {{ d.addEventListener('toggle', function () {{ if (d.open && window.hljs) {{ var c = d.querySelector('pre code'); if (c && !c.dataset.hl) {{ hljs.highlightElement(c); c.dataset.hl = '1'; }} }} }}); }});
  document.getElementById('open-all').addEventListener('click', function () {{ document.querySelectorAll('details').forEach(function (d) {{ d.open = true; }}); hl(); }});
  document.getElementById('close-all').addEventListener('click', function () {{ document.querySelectorAll('details').forEach(function (d) {{ d.open = false; }}); }});
  if (location.hash) {{ var t = document.querySelector(location.hash); if (t && t.tagName === 'DETAILS') t.open = true; }}
}})();
</script>
"""
os.makedirs(os.path.join(root, "test", "out"), exist_ok=True)
out = os.path.join(root, "test", "out", "architecture.html")
open(out, "w", encoding="utf-8").write(page)
print(out, len(page) // 1024, "KB", len(code_sections), "files")
