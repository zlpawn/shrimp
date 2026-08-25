import importlib.util
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "business_contract.py"
SPEC = importlib.util.spec_from_file_location("business_contract", SCRIPT)
contract = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(contract)


class BusinessContractTests(unittest.TestCase):
    def test_candidate_id_depends_only_on_repository_and_seed_signal(self):
        self.assertEqual(
            contract.candidate_id("REPO-abc", "SIG-seed"),
            "UCC-" + "1e7f9f595d97a65d5bfc",
        )

    def test_repository_lineage_ignores_root_order(self):
        roots = ["b" * 40, "a" * 40]
        self.assertEqual(
            contract.repository_lineage_id(roots),
            contract.repository_lineage_id(list(reversed(roots))),
        )

    def test_canonical_json_normalizes_unicode_keys_and_record_order(self):
        left = [{"id": "B", "title": "e\u0301"}, {"id": "A", "title": "x"}]
        right = [{"title": "x", "id": "A"}, {"title": "é", "id": "B"}]
        expected = b'[{"id":"A","title":"x"},{"id":"B","title":"\xc3\xa9"}]'
        self.assertEqual(
            contract.canonical_json_bytes(left, sort_records=True),
            expected,
        )
        self.assertEqual(
            contract.canonical_json_bytes(right, sort_records=True),
            expected,
        )

    def test_aggregate_status_uses_blocked_then_partial_precedence(self):
        self.assertEqual(contract.aggregate_status("passed", "not_requested"), "passed")
        self.assertEqual(contract.aggregate_status("passed", "partial"), "partial")
        self.assertEqual(contract.aggregate_status("partial", "passed"), "partial")
        self.assertEqual(contract.aggregate_status("passed", "blocked"), "blocked")


if __name__ == "__main__":
    unittest.main()
