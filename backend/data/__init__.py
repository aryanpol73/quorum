"""Data tools used by the agents: prices/indicators, news, fundamentals."""


class DataUnavailable(Exception):
    """Raised when neither the live API nor demo data can serve a request."""
