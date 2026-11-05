from actionpicker.cli import load_env, main
from actionpicker.models import Scores, Title
from actionpicker.store import Store


def seed_db(path: str) -> None:
    store = Store(path)
    for i, (name, fq) in enumerate([("Ip Man", 9), ("Slow Drama", 5)], start=1):
        tid = store.upsert_title(Title(None, i, "movie", name, 2010, "", 7.0, 100))
        store.save_scores(Scores(tid, None, fq, "hand_to_hand", 8, 6, 2, 7, 20,
                                 [{"text": "great fights", "url": "https://x.test/r"}], "h"))


def test_load_env_parses_values_and_strips_comments(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("# note\nLLM_PROVIDER=groq   # gemini | groq\nTMDB_API_KEY=abc\n\nEMPTY=\n")
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setenv("TMDB_API_KEY", "already")
    load_env(str(f))
    import os

    assert os.environ["LLM_PROVIDER"] == "groq"
    assert os.environ["TMDB_API_KEY"] == "already"  # existing env wins


def test_rank_command_prints_best_first(tmp_path, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    assert main(["--db", db, "rank", "--top", "5"]) == 0
    out = capsys.readouterr().out
    assert out.index("Ip Man") < out.index("Slow Drama")


def test_show_command_prints_scores_and_evidence(tmp_path, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    assert main(["--db", db, "show", "ip man"]) == 0
    out = capsys.readouterr().out
    assert "fight_quality" in out and "great fights" in out


def test_show_unknown_title_returns_1(tmp_path, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    assert main(["--db", db, "show", "nonexistent"]) == 1


def test_digest_dry_run_prints_without_sending_or_marking_sent(tmp_path, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    assert main(["--db", db, "digest", "--dry-run"]) == 0
    assert "Ip Man" in capsys.readouterr().out
    assert Store(db).sent_keys() == set()


def test_digest_without_smtp_settings_returns_2(tmp_path, monkeypatch, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    for k in ("SMTP_USER", "SMTP_APP_PASSWORD", "DIGEST_TO"):
        monkeypatch.delenv(k, raising=False)
    assert main(["--env", str(tmp_path / "none.env"), "--db", db, "digest"]) == 2


def test_compact_command_purges_scored_reviews(tmp_path, capsys):
    db = str(tmp_path / "t.db")
    seed_db(db)
    store = Store(db)
    store.add_review(1, None, "https://x.test/r", "scraped text")
    assert main(["--db", db, "compact"]) == 0
    assert Store(db).get_reviews(1, None) == []
