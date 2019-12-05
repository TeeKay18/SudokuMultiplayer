CREATE DATABASE sudokuDB;

USE sudokuDB;

CREATE TABLE users (
  name VARCHAR(52) NOT NULL,
  password VARCHAR(52) NOT NULL,
  wins INT DEFAULT 0,

  PRIMARY KEY (name)
);
