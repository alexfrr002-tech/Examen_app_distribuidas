CREATE DATABASE IF NOT EXISTS af_sneakers_gateway;
USE af_sneakers_gateway;

CREATE TABLE IF NOT EXISTS pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_ref VARCHAR(60) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(40) NOT NULL,
  correo VARCHAR(120) NOT NULL,
  ciudad VARCHAR(100) NOT NULL,
  direccion VARCHAR(200) NOT NULL,
  provincia VARCHAR(100) NOT NULL,
  codigo_postal VARCHAR(20) NOT NULL,
  notas TEXT NULL,
  detalle_json LONGTEXT NOT NULL,
  total_items INT NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  metodo VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  producto VARCHAR(150) NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pedido_items_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auditoria_carga (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_ref VARCHAR(60) NOT NULL,
  replica_num INT NOT NULL,
  origen VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
