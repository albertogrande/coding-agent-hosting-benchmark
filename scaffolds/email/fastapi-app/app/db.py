import os
import sqlite3
from contextlib import contextmanager

SCHEMA = """
create table if not exists users (
  id integer primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at text not null default (datetime('now'))
);
create table if not exists tasks (
  id integer primary key,
  owner_id integer not null references users(id),
  title text not null,
  done integer not null default 0,
  created_at text not null default (datetime('now')),
  done_at text
);
create table if not exists comments (
  id integer primary key,
  task_id integer not null references tasks(id),
  author_id integer not null references users(id),
  body text not null,
  created_at text not null default (datetime('now'))
);
"""


def database_path() -> str:
    return os.environ.get("DATABASE_PATH", "app.db")


@contextmanager
def connect():
    conn = sqlite3.connect(database_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
