"""Cross-check the forecast JSON contract with an independent JSON Schema implementation.

The Node app enforces schemas/forecast-record.schema.json with Ajv before any
record is saved. This test validates the same schema, the published example and
the stored forecasts with python-jsonschema so the contract is not tied to one
validator. Install test dependencies with:

    pip install -r requirements-dev.txt
"""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - exercised only without dev requirements
    Draft202012Validator = None

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "forecast-record.schema.json"
HISTORY_DIR = REPO_ROOT / "schemas" / "history"
EXAMPLE_PATH = REPO_ROOT / "schemas" / "examples" / "forecast-record.example.json"
STORE_PATH = REPO_ROOT / "data" / "forecasts.json"


@unittest.skipIf(Draft202012Validator is None, "jsonschema is not installed (pip install -r requirements-dev.txt)")
@unittest.skipUnless(SCHEMA_PATH.exists(), "schema file is not available outside the repository checkout")
class ForecastSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # payload.schema_version -> validator for that version's (frozen) schema.
        cls.validators = {}
        paths = [SCHEMA_PATH, *sorted(HISTORY_DIR.glob("*.schema.json"))]
        for path in paths:
            schema = json.loads(path.read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
            version = schema["$defs"]["ForecastPayload"]["properties"]["schema_version"]["const"]
            cls.validators[version] = Draft202012Validator(
                schema, format_checker=Draft202012Validator.FORMAT_CHECKER
            )
        latest = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        cls.latest_version = latest["$defs"]["ForecastPayload"]["properties"]["schema_version"]["const"]
        cls.example = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))

    def errors(self, instance: dict) -> list[str]:
        version = instance.get("payload", {}).get("schema_version")
        validator = self.validators.get(version, self.validators[self.latest_version])
        return sorted(
            "/" + "/".join(str(part) for part in error.absolute_path)
            for error in validator.iter_errors(instance)
        )

    def test_service_emits_current_schema_version(self) -> None:
        source = (REPO_ROOT / "chronos_service" / "app.py").read_text(encoding="utf-8")
        self.assertIn(f'SCHEMA_VERSION = "{self.latest_version}"', source)

    def test_example_uses_current_version(self) -> None:
        self.assertEqual(self.example["payload"]["schema_version"], self.latest_version)

    def test_frozen_1_1_0_schema_accepts_records_without_new_fields(self) -> None:
        record = copy.deepcopy(self.example)
        record["payload"]["schema_version"] = "1.1.0"
        for field in ("vix_overnight_level", "rvx_level", "input_observations"):
            del record["snapshot"][field]
        self.assertEqual(self.errors(record), [])

    def test_rejects_intraday_observation_without_timestamp(self) -> None:
        record = copy.deepcopy(self.example)
        record["snapshot"]["input_observations"][0]["observed_at"] = None
        self.assertIn("/snapshot/input_observations/0/observed_at", self.errors(record))

    def test_example_record_is_valid(self) -> None:
        self.assertEqual(self.errors(self.example), [])

    def test_stored_forecasts_are_valid(self) -> None:
        if not STORE_PATH.exists():
            self.skipTest("data/forecasts.json is not present")
        records = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        for record in records:
            with self.subTest(record=record.get("id")):
                self.assertEqual(self.errors(record), [])

    def test_rejects_unexpected_property(self) -> None:
        record = copy.deepcopy(self.example)
        record["snapshot"]["vix1d_level"] = 21.4
        self.assertEqual(self.errors(record), ["/snapshot"])

    def test_rejects_out_of_range_probability(self) -> None:
        record = copy.deepcopy(self.example)
        record["payload"]["horizons"]["tomorrow"]["bins"][3]["prob"] = 1.2
        self.assertIn("/payload/horizons/tomorrow/bins/3/prob", self.errors(record))

    def test_rejects_mismatched_trading_days(self) -> None:
        record = copy.deepcopy(self.example)
        record["payload"]["horizons"]["next_week"]["trading_days"] = 4
        self.assertIn("/payload/horizons/next_week/trading_days", self.errors(record))

    def test_rejects_timestamp_without_offset(self) -> None:
        # Fails if the date-time format checker is not installed, which would
        # otherwise silently accept any string.
        record = copy.deepcopy(self.example)
        record["created_at"] = "2026-11-24 04:30:00"
        self.assertEqual(self.errors(record), ["/created_at"])


if __name__ == "__main__":
    unittest.main()
