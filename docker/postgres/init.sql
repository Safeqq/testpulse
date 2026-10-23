-- Satu instance Postgres, database terpisah per service (prinsip microservice: tidak berbagi DB)
CREATE DATABASE catalog;
CREATE DATABASE orders;
