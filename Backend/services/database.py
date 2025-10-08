from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from backend.ai_narratives.config import get_database_path


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(get_database_path())
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def database_connection() -> Iterator[sqlite3.Connection]:
    """Yield a SQLite connection that is closed automatically."""
    connection = _connect()
    try:
        yield connection
    finally:
        connection.close()

