"""Sample app for parser tests."""
import os
from helpers.utils import compute_total
from .config import settings


class App:
    def __init__(self):
        self.name = "sample"

    def run(self):
        try:
            return compute_total(settings.values)
        except Exception:
            pass

    async def fetch_async(self, key):
        if key:
            return await fetch(key)
        return None


def helper(x):
    if x > 0:
        if x > 10:
            return "big"
        return "small"
    return "zero"
