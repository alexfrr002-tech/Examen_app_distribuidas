const http = require("http");

const PORT = 8081;
const BACKEND_HOST = "localhost";
const BACKEND_PORT = 3001;

// Cola interna del gateway para procesar solicitudes sin saturar el backend.
const cola = [];
let procesando = false;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, statusCode, data) {
  setCors(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk.toString();
      if (raw.length > 1e6) {
        reject(new Error("Body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

// Reenvía una solicitud del gateway hacia el backend.
function proxyRequest(method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      }
    };

    const proxyReq = http.request(options, proxyRes => {
      let raw = "";
      proxyRes.on("data", chunk => raw += chunk.toString());
      proxyRes.on("end", () => {
        try {
          resolve({ statusCode: proxyRes.statusCode || 500, data: raw ? JSON.parse(raw) : {} });
        } catch {
          reject(new Error("Respuesta inválida del backend"));
        }
      });
    });

    proxyReq.on("error", reject);
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
}

// Procesa la cola una solicitud a la vez.
async function procesarCola() {
  if (procesando) return;
  procesando = true;

  while (cola.length > 0) {
    const tarea = cola.shift();

    try {
      const result = await proxyRequest("POST", "/registrar-pedido", tarea.body, { "x-from-gateway": "true" });
      sendJson(tarea.res, result.statusCode, {
        gateway: true,
        enCola: true,
        pendientesRestantes: cola.length,
        ...result.data
      });
    } catch (error) {
      sendJson(tarea.res, 502, {
        ok: false,
        gateway: true,
        enCola: true,
        estado: "error_gateway",
        mensaje: error.message
      });
    }
  }

  procesando = false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    return res.end();
  }

  try {
    // Encola los pedidos para que el backend los procese ordenadamente.
    if (req.method === "POST" && url.pathname === "/api/registrar-pedido") {
      const rawBody = await readBody(req);
      cola.push({ body: rawBody, res });
      procesarCola();
      return;
    }

    // Reenvía estadísticas y últimos pedidos al backend.
    if (req.method === "GET" && url.pathname === "/api/estadisticas") {
      const result = await proxyRequest("GET", "/estadisticas");
      return sendJson(res, result.statusCode, {
        gateway: true,
        pendientesEnCola: cola.length,
        procesando,
        ...result.data
      });
    }

    if (req.method === "GET" && url.pathname === "/api/ultimos-pedidos") {
      const result = await proxyRequest("GET", "/ultimos-pedidos");
      return sendJson(res, result.statusCode, { gateway: true, ...result.data });
    }

    // Ruta de salud del gateway.
    if (req.method === "GET" && url.pathname === "/api/salud") {
      return sendJson(res, 200, {
        ok: true,
        servicio: "gateway",
        modo: "cola",
        procesando,
        pendientesEnCola: cola.length
      });
    }

    return sendJson(res, 404, { ok: false, mensaje: "Ruta no encontrada en gateway" });
  } catch (error) {
    return sendJson(res, 502, { ok: false, gateway: true, estado: "error_gateway", mensaje: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Gateway con cola corriendo en http://localhost:${PORT}`);
});
