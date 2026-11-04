const base = "https://galaga-redux.kindof-lame.workers.dev";
for (const p of ["/", "/src/render/enhanced/shipGeometry.js", "/src/render/enhanced/visuals.js", "/LICENSE"]) {
  const r = await fetch(base + p);
  const text = await r.text();
  console.log(String(r.status).padEnd(4), String(text.length).padStart(7), p);
}
const sg = await (await fetch(base + "/src/render/enhanced/shipGeometry.js")).text();
console.log("exports hull builder:", sg.includes("shipHullGeometry"));
