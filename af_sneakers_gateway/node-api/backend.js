const http = require("http");
const mysql = require("mysql2/promise");

const PORT = 3001;

// Pool de conexión hacia MySQL local de XAMPP.
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "af_sneakers_gateway",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

let activas = 0;
const MAX_ACTIVAS = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-from-gateway");
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

    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });

    req.on("error", reject);
  });
}

// Valida lo básico del pedido antes de guardar en la base.
function validarPedido(body) {
  const required = ["nombre", "telefono", "correo", "ciudad", "direccion", "provincia", "codigo"];
  for (const field of required) {
    if (!body[field] || String(body[field]).trim() === "") {
      return `Falta el campo ${field}`;
    }
  }

  if (!Array.isArray(body.carrito) || body.carrito.length === 0) {
    return "El carrito está vacío";
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    return res.end();
  }

  try {
    // Ruta simple para probar si el backend está vivo.
    if (req.method === "GET" && url.pathname === "/salud") {
      return sendJson(res, 200, {
        ok: true,
        servicio: "backend",
        activas,
        maxActivas: MAX_ACTIVAS
      });
    }

    // Ruta principal que recibe el pedido.
    if (req.method === "POST" && url.pathname === "/registrar-pedido") {
      if (activas >= MAX_ACTIVAS) {
        return sendJson(res, 503, {
          ok: false,
          estado: "backend_saturado",
          mensaje: "El backend está saturado. Intenta en unos segundos."
        });
      }

      const body = await readBody(req);
      const error = validarPedido(body);

      // Si faltan datos o el carrito está vacío, se rechaza la compra.
      if (error) {
        return sendJson(res, 400, {
          ok: false,
          estado: "pedido_rechazado",
          aprobado: false,
          cliente: body.nombre || "Cliente",
          mensajeAprobacion: `Compra rechazada para ${body.nombre || "el cliente"}. Motivo: ${error}.`
        });
      }

      activas += 1;

      const metodo = req.headers["x-from-gateway"] === "true" ? "gateway" : "directo";
      const pedidoRef = `PED-${Date.now()}`;
      const totalItems = body.carrito.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      const totalPrice = body.carrito.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0)), 0);

      try {
        // Demora artificial para que en la práctica se note la diferencia de carga.
        await sleep(2200);

        const [pedidoResult] = await pool.query(
          `INSERT INTO pedidos
          (pedido_ref, nombre, telefono, correo, ciudad, direccion, provincia, codigo_postal, notas, detalle_json, total_items, total_price, metodo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            pedidoRef,
            body.nombre,
            body.telefono,
            body.correo,
            body.ciudad,
            body.direccion,
            body.provincia,
            body.codigo,
            body.notas || "",
            JSON.stringify(body.carrito),
            totalItems,
            totalPrice,
            metodo
          ]
        );

        const itemsValues = body.carrito.map(item => [
          pedidoResult.insertId,
          item.name,
          Number(item.qty || 0),
          Number(item.price || 0),
          Number(item.price || 0) * Number(item.qty || 0)
        ]);

        await pool.query(
          `INSERT INTO pedido_items
          (pedido_id, producto, cantidad, precio_unitario, subtotal)
          VALUES ?`,
          [itemsValues]
        );

        // Tabla auxiliar para simular carga de trabajo adicional.
        const auditoriaValues = [];
        for (let i = 1; i <= 100; i += 1) auditoriaValues.push([pedidoRef, i, metodo]);

        await pool.query(
          `INSERT INTO auditoria_carga
          (pedido_ref, replica_num, origen)
          VALUES ?`,
          [auditoriaValues]
        );

        const mensajeAprobacion = `Compra aprobada para ${body.nombre}. El pedido fue registrado correctamente para el correo ${body.correo}.`;

        return sendJson(res, 200, {
          ok: true,
          estado: "pedido_aprobado",
          aprobado: true,
          pedidoRef,
          metodo,
          totalItems,
          totalPrice: Number(totalPrice.toFixed(2)),
          replicasAuditoria: 100,
          cliente: body.nombre,
          correo: body.correo,
          mensajeAprobacion
        });
      } catch (errorInterno) {
        return sendJson(res, 500, {
          ok: false,
          estado: "error_backend",
          mensaje: errorInterno.message
        });
      } finally {
        activas -= 1;
      }
    }

    // Devuelve totales para la demostración.
    if (req.method === "GET" && url.pathname === "/estadisticas") {
      const [[{ totalPedidos }]] = await pool.query("SELECT COUNT(*) AS totalPedidos FROM pedidos");
      const [[{ totalAuditoria }]] = await pool.query("SELECT COUNT(*) AS totalAuditoria FROM auditoria_carga");
      const [[{ totalDirectos }]] = await pool.query("SELECT COUNT(*) AS totalDirectos FROM pedidos WHERE metodo = 'directo'");
      const [[{ totalGateway }]] = await pool.query("SELECT COUNT(*) AS totalGateway FROM pedidos WHERE metodo = 'gateway'");

      return sendJson(res, 200, {
        ok: true,
        servicio: "backend",
        activas,
        totalPedidos,
        totalAuditoria,
        totalDirectos,
        totalGateway
      });
    }

    // Muestra los últimos 5 pedidos guardados.
    if (req.method === "GET" && url.pathname === "/ultimos-pedidos") {
      const [rows] = await pool.query(
        `SELECT id, pedido_ref, nombre, correo, ciudad, total_items, total_price, metodo, created_at
         FROM pedidos
         ORDER BY id DESC
         LIMIT 5`
      );

      return sendJson(res, 200, {
        ok: true,
        pedidos: rows
      });
    }

    return sendJson(res, 404, { ok: false, mensaje: "Ruta no encontrada en backend" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, estado: "error_general", mensaje: error.message });
  }
});

server.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`Backend corriendo en http://localhost:${PORT}`);
    console.log("Conexión a MySQL correcta");
  } catch (error) {
    console.error("No se pudo conectar a MySQL:", error.message);
  }
});
