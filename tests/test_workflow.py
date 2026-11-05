from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "weekly.yml"


def load() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def test_workflow_runs_weekly_and_on_demand():
    triggers = load().get("on") or load().get(True)  # PyYAML reads bare `on` as True
    assert triggers["schedule"][0]["cron"].split()[-1] == "1"  # Mondays
    assert "workflow_dispatch" in triggers


def test_workflow_runs_ingest_then_digest_then_compact_then_saves_db():
    steps = load()["jobs"]["run"]["steps"]
    runs = [s.get("run", "") for s in steps]
    order = [
        next(i for i, r in enumerate(runs) if "actionpicker.cli ingest" in r),
        next(i for i, r in enumerate(runs) if "actionpicker.cli digest" in r),
        next(i for i, r in enumerate(runs) if "actionpicker.cli compact" in r),
        next(i for i, r in enumerate(runs) if "git push" in r and "data" in r),
    ]
    assert order == sorted(order)


def test_workflow_needs_write_permission_and_only_documented_secrets():
    wf = load()
    assert wf["permissions"]["contents"] == "write"
    text = WORKFLOW.read_text()
    documented = {"TMDB_API_KEY", "LLM_API_KEY", "SMTP_USER", "SMTP_APP_PASSWORD", "DIGEST_TO"}
    used = {
        part.split("}}")[0].strip()
        for part in text.split("secrets.")[1:]
    }
    assert used <= documented and "TMDB_API_KEY" in used


def test_workflow_never_prints_secrets():
    assert "echo ${{ secrets" not in WORKFLOW.read_text()
