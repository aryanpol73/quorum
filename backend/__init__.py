"""QUORUM backend: a multi-agent stock research assistant (educational simulation)."""

import warnings

# requests emits a noisy (harmless) charset warning on some Windows installs.
warnings.filterwarnings("ignore", message=".*character detection dependency.*")
