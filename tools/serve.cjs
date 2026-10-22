// Zero-dependency static server: the game uses ES modules, which need http://.
//   node tools/serve.cjs 8791 Work    the game alone, for Dev Mode and the tunnel
//   node tools/serve.cjs 8790         the project folder, for tools/harness.html and ?avatar=../tools/...
// Phones on the same Wi-Fi use the printed address.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(path.join(__dirname, ".."), process.argv[3] || ".");
const port = parseInt(process.argv[2] || "8150", 10);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json"
};

http.createServer(function (req, res) {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.normalize(path.join(root, url === "/" ? "index.html" : url));
  if (file.indexOf(root) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    // TEST ONLY: the game has no test switches of its own. A page asked for with ?fake=<id> gets the stand-in SDK
    // (tools/fake-hoplobby.js) in place of HopLobby's, and its main.js gets the BC test hooks (tools/bc-hooks.js).
    const q = new URLSearchParams(req.url.split("?")[1] || "");
    if (q.has("fake") && path.extname(file) === ".html") {
      data = Buffer.from(data.toString("utf8")
        .replace('<script src="https://hoplobby.com/sdk/v1/hoplobby.js"></script>', '<script type="module" src="/tools/fake-hoplobby.js"></script>')
        .replace('src="js/main.js"', 'src="js/main.js?test"'), "utf8");
    } else if (q.has("test") && path.basename(file) === "main.js") {
      data = Buffer.concat([data, fs.readFileSync(path.join(__dirname, "bc-hooks.js"))]);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(port, function () {
  console.log("Batting Cage (" + root + ") on http://127.0.0.1:" + port + "/");
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (n) {
    nets[n].forEach(function (a) { if (a.family === "IPv4" && !a.internal) console.log("  phone on the same Wi-Fi: http://" + a.address + ":" + port + "/"); });
  });
});
