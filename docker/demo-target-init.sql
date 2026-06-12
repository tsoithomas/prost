-- Seed data for the demo TARGET database (a stand-in for a user's PostgreSQL database).
-- This is intentionally separate from the Prost application database.

CREATE TABLE public.users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    first_name    VARCHAR(255) NOT NULL,
    last_name     VARCHAR(255),
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    sku           VARCHAR(64) NOT NULL UNIQUE,
    price         NUMERIC(10, 2) NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES public.users(id),
    status        VARCHAR(32) NOT NULL,
    total         NUMERIC(10, 2) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO public.users (email, first_name, last_name, created_at) VALUES
    ('alice@example.com', 'Alice', 'Smith', '2023-10-24 14:32:10'),
    ('bob.jones@example.com', 'Bob', 'Jones', '2023-10-25 09:15:00'),
    ('charlie@example.com', 'Charlie', NULL, '2023-10-25 11:42:33'),
    ('dana@example.com', 'Dana', 'Lee', '2023-10-26 08:05:41'),
    ('evan@example.com', 'Evan', 'Wright', '2023-10-27 16:20:09');

INSERT INTO public.products (name, sku, price, stock, created_at) VALUES
    ('Wireless Mouse', 'SKU-1001', 24.99, 150, '2023-09-01 10:00:00'),
    ('Mechanical Keyboard', 'SKU-1002', 89.99, 75, '2023-09-02 10:00:00'),
    ('USB-C Hub', 'SKU-1003', 39.50, 200, '2023-09-03 10:00:00'),
    ('27" Monitor', 'SKU-1004', 249.00, 30, '2023-09-04 10:00:00');

INSERT INTO public.orders (user_id, status, total, created_at) VALUES
    (1, 'shipped', 124.50, '2023-10-24 14:32:01'),
    (2, 'shipped', 89.99, '2023-10-24 14:15:22'),
    (3, 'shipped', 210.00, '2023-10-24 13:45:10'),
    (4, 'pending', 45.25, '2023-10-24 12:10:05'),
    (5, 'shipped', 899.99, '2023-10-24 11:05:44'),
    (1, 'cancelled', 59.00, '2023-10-23 09:00:00');
