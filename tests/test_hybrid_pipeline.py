import unittest

from core.hybrid.hybrid_pipeline import init_hybrid_system


class TestHybrid(unittest.TestCase):
    def test_basic_run(self):
        hp = init_hybrid_system()
        res = hp("Explain the purpose of hybrid AI systems.")
        self.assertIsInstance(res, str)


if __name__ == "__main__":
    unittest.main()
