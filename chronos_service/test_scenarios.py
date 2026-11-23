import unittest

import numpy as np

from scenarios import (
    QUANTILE_LEVELS,
    block_bootstrap_residuals,
    build_horizon_distributions,
    extend_daily_quantiles,
    simulate_cumulative_returns,
)


class ChronosScenarioTests(unittest.TestCase):
    def test_block_bootstrap_shape_and_determinism(self):
        residuals = np.linspace(-3, 3, 200)
        first = block_bootstrap_residuals(residuals, 500, 20, block_length=5, seed=7)
        second = block_bootstrap_residuals(residuals, 500, 20, block_length=5, seed=7)
        self.assertEqual(first.shape, (500, 20))
        np.testing.assert_array_equal(first, second)

    def test_simulator_returns_monotonic_cumulative_paths(self):
        rng = np.random.default_rng(1)
        history = rng.standard_t(df=5, size=1200) * 0.8
        forecast = np.tile(np.linspace(-1.1, 1.1, len(QUANTILE_LEVELS)), (21, 1))
        paths = simulate_cumulative_returns(forecast, history, n_paths=1000, seed=5)
        self.assertEqual(paths.shape, (1000, 21))
        self.assertTrue(np.isfinite(paths).all())
        self.assertGreater(np.std(paths[:, -1]), np.std(paths[:, 0]))

    def test_long_horizon_extension_preserves_direct_forecast(self):
        rng = np.random.default_rng(11)
        history = rng.normal(0.05, 2.0, 1200)
        direct = np.tile(np.linspace(-2.0, 2.0, len(QUANTILE_LEVELS)), (64, 1))
        extended, diagnostics = extend_daily_quantiles(direct, history, 252)
        self.assertEqual(extended.shape, (252, 9))
        np.testing.assert_array_equal(extended[:64], direct)
        self.assertEqual(diagnostics["direct_steps"], 64.0)
        self.assertEqual(diagnostics["extension_steps"], 188.0)
        self.assertTrue(np.all(np.diff(extended, axis=1) >= 0))

    def test_distribution_bins_sum_to_one(self):
        rng = np.random.default_rng(2)
        outcomes = rng.normal(0, 3, 5000)
        bins = [
            {"min_pct": -5 + i, "max_pct": -4 + i}
            for i in range(10)
        ]
        spec = {
            "key": "tomorrow",
            "label": "Tomorrow",
            "trading_days": 1,
            "bin_width_pct": 1,
            "bins": bins,
        }
        result = build_horizon_distributions(
            outcomes.reshape(-1, 1),
            [spec],
        )["tomorrow"]
        total = (
            result["underflow_prob"]
            + sum(item["prob"] for item in result["bins"])
            + result["overflow_prob"]
        )
        self.assertAlmostEqual(total, 1.0, places=12)
        self.assertEqual(len(result["bins"]), 10)
        self.assertTrue(all(result["bins"][i]["cdf"] <= result["bins"][i + 1]["cdf"] for i in range(9)))


if __name__ == "__main__":
    unittest.main()
