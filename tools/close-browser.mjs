const v = await (await fetch("http://127.0.0.1:9223/json/version")).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
await new Promise((r) => setTimeout(r, 2000));
ws.close();
