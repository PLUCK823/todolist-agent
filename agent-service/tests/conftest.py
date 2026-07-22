"""Suite-wide test environment guards."""

import os

import pytest


def pytest_sessionstart(session: pytest.Session) -> None:
    if os.getenv("CI") and not os.getenv("TEST_DATABASE_URL"):
        raise pytest.UsageError("TEST_DATABASE_URL is required in CI")
