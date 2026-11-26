import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import app
from records import initialize, session

class Workflow(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = Path(temp.name) / "test.sqlite3"
        for attr, value in (("DB", db), ("ROLE", "reviewer")):
            swap = patch.object(app, attr, value)
            swap.start()
            self.addCleanup(swap.stop)
        initialize(db)
        self.item = app.Production(date=date.today(), topic="General", idea="A studio tour")

    def test_stale_editor_cannot_overwrite_or_delete(self):
        number = int(app.create(self.item)["id"])
        app.update(number, self.item.model_copy(update={"script": "Revised opening"}), 1)
        for action in (lambda: app.update(number, self.item, 1), lambda: app.remove(number, 1)):
            with self.assertRaises(HTTPException) as cm:
                action()
            self.assertEqual(cm.exception.status_code, 409)
        latest = app.list_records()["productions"][0]
        self.assertEqual((latest["revision"], latest["script"]), (2, "Revised opening"))
        app.remove(number, 2)
        self.assertEqual(len(app.list_records()["productions"]), 4)

    def test_team_changes_are_flagged_and_approvals_are_enforced(self):
        number = int(app.create(self.item)["id"])
        with patch.object(app, "ROLE", "team"):
            app.update(number, self.item.model_copy(update={"idea": "A revised studio tour"}), 1)
            self.assertTrue(app.list_records()["productions"][0]["idea_pending"])
            with self.assertRaises(HTTPException) as cm:
                app.update(number, self.item.model_copy(update={"script_approval": "Approved"}), 2)
            self.assertEqual(cm.exception.status_code, 403)

    def test_publisher_can_record_distribution(self):
        with patch.object(app, "ROLE", "publisher"):
            app.create(self.item.model_copy(update={"distribution_published": True}))
            with self.assertRaises(HTTPException):
                app.create(self.item.model_copy(update={"video_approval": "Approved"}))

    def test_restart_does_not_repopulate_deleted_rows(self):
        with session(app.DB) as db:
            db.execute("DELETE FROM productions")
        initialize(app.DB)
        self.assertEqual(app.list_records()["productions"], [])

    def test_translation_adapter(self):
        import io
        from unittest.mock import MagicMock
        reply = MagicMock()
        reply.__enter__.return_value = io.BytesIO(json.dumps({"candidates":[{"content":{"parts":[{"text":"Test translation"}]}}]}).encode())
        with patch.dict("os.environ", GEMINI_MODEL="test-model", GEMINI_API_KEY="local-test"), patch.object(
            app, "urlopen", return_value=reply
        ) as send:
            self.assertEqual(app.translate(app.Translation(text="Example", target="hebrew"))["translated_text"], "Test translation")
        self.assertEqual(json.loads(send.call_args.args[0].data)["contents"][0]["parts"][0]["text"], "Example")

if __name__ == "__main__":
    unittest.main()
