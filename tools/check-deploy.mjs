const base = "https://galaga-redux.kindof-lame.workers.dev";
const paths = ["/", "/styles.css", "/src/app/main.js", "/vendor/three.module.js", "/build.json", "/tests/engine.test.js", "/src/app/main.js.map"];
for (const p of paths) {
  const r = await fetch(base + p, { redirect: "follow" });
  const ct = r.headers.get("content-type") ?? "";
  console.log(String(r.status).padEnd(4), ct.padEnd(32), p);
}
const html = await (await fetch(base + "/")).text();
console.log("---");
console.log("has importmap:", html.includes("vendor/three.module.js"));
console.log("has main module:", html.includes("src/app/main.js"));
console.log("bytes:", html.length);
