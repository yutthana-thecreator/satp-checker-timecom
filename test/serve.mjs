import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(process.argv[2] || "."); const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".pdf": "application/pdf" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  // ทดสอบเท่านั้น: POST /__out/<ชื่อไฟล์> เขียนผลจากเบราว์เซอร์ลง test/out/
  if (req.method === "POST" && p.startsWith("/__out/")) {
    const name = p.slice(7).replace(/[^A-Za-z0-9_.-]/g, "_"); const chunks = [];
    req.on("data", (c) => chunks.push(c)); req.on("end", () => { fs.mkdirSync(path.join(root, "test/out"), { recursive: true }); fs.writeFileSync(path.join(root, "test/out", name), Buffer.concat(chunks)); res.writeHead(200); res.end("ok"); });
    return;
  }
  const f = p.startsWith("/samples/") ? path.join(root, "..", p.slice(9)) : path.join(root, p);
  const okRoot = p.startsWith("/samples/") ? path.resolve(root, "..") : root;
  if (!f.startsWith(okRoot) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
}).listen(8090, () => console.log("http://localhost:8090"));
