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
