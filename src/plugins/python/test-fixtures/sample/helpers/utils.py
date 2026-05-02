"""Utility functions — referenced from app.py via `from helpers.utils import compute_total`."""


def compute_total(values):
    total = 0
    for v in values:
        total += v
    return total


def big_function(n):
    """Intentionally large complexity to trigger the >25 issue."""
    result = 0
    for i in range(n):
        if i % 2 == 0:
            if i % 3 == 0:
                if i % 5 == 0:
                    result += 5
                elif i % 7 == 0:
                    result += 7
                else:
                    result += 1
            elif i % 11 == 0:
                if i % 13 == 0:
                    result += 13
                else:
                    result += 11
            else:
                result += 0
        else:
            if i % 17 == 0:
                if i % 19 == 0:
                    result += 19
                else:
                    result += 17
            elif i % 23 == 0:
                result += 23
            else:
                result -= 1
    return result
