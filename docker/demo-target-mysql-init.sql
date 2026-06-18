-- Seed data for the demo TARGET database (a stand-in for a user's MySQL database).
-- Mirrors docker/demo-target-init.sql (the PostgreSQL target) so the same manual tests and
-- driver contracts run against both engines. `users` has an AUTO_INCREMENT primary key and
-- `order_items` has a composite primary key.

CREATE TABLE users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    first_name    VARCHAR(255) NOT NULL,
    last_name     VARCHAR(255),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    sku           VARCHAR(64) NOT NULL UNIQUE,
    price         DECIMAL(10, 2) NOT NULL,
    stock         INT NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    status        VARCHAR(32) NOT NULL,
    total         DECIMAL(10, 2) NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- A composite primary key (order_id, product_id), exercising multi-column key handling.
CREATE TABLE order_items (
    order_id      INT NOT NULL,
    product_id    INT NOT NULL,
    quantity      INT NOT NULL DEFAULT 1,
    PRIMARY KEY (order_id, product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO users (email, first_name, last_name, created_at) VALUES
    ('alice@example.com', 'Alice', 'Smith', '2023-10-24 14:32:10'),
    ('bob.jones@example.com', 'Bob', 'Jones', '2023-10-25 09:15:00'),
    ('charlie@example.com', 'Charlie', NULL, '2023-10-25 11:42:33'),
    ('dana@example.com', 'Dana', 'Lee', '2023-10-26 08:05:41'),
    ('evan@example.com', 'Evan', 'Wright', '2023-10-27 16:20:09');

INSERT INTO products (name, sku, price, stock, created_at) VALUES
    ('Wireless Mouse', 'SKU-1001', 24.99, 150, '2023-09-01 10:00:00'),
    ('Mechanical Keyboard', 'SKU-1002', 89.99, 75, '2023-09-02 10:00:00'),
    ('USB-C Hub', 'SKU-1003', 39.50, 200, '2023-09-03 10:00:00'),
    ('27" Monitor', 'SKU-1004', 249.00, 30, '2023-09-04 10:00:00');

INSERT INTO orders (user_id, status, total, created_at) VALUES
    (1, 'shipped', 124.50, '2023-10-24 14:32:01'),
    (2, 'shipped', 89.99, '2023-10-24 14:15:22'),
    (3, 'shipped', 210.00, '2023-10-24 13:45:10'),
    (4, 'pending', 45.25, '2023-10-24 12:10:05'),
    (5, 'shipped', 899.99, '2023-10-24 11:05:44'),
    (1, 'cancelled', 59.00, '2023-10-23 09:00:00');

INSERT INTO order_items (order_id, product_id, quantity) VALUES
    (1, 1, 2),
    (1, 3, 1),
    (2, 2, 1),
    (3, 4, 1),
    (5, 4, 3);
