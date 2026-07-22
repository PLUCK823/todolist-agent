"""CI must exercise the PostgreSQL durability suite instead of skipping it."""

from pathlib import Path


def test_agent_ci_provisions_postgres_and_requires_test_database_url():
    workflow = (
        Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"
    ).read_text()

    assert "postgres:16" in workflow
    assert "TEST_DATABASE_URL" in workflow
    assert "data/init.sql" in workflow
    assert "${TEST_DATABASE_URL:?" in workflow
    assert "uv run --frozen --extra dev pytest -rs" in workflow

    conftest = (Path(__file__).resolve().parent / "conftest.py").read_text()
    assert 'os.getenv("CI")' in conftest
    assert "TEST_DATABASE_URL is required in CI" in conftest
