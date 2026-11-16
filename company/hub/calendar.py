"""Approved project calendar: Saturday–Thursday, Saudi time, no holiday exclusions."""
from datetime import datetime, timezone

def working_days(start, end):
    if start is None or end is None or end < start:
        return None
    day = 86400000
    cursor, stop, total = start + 10800000, end + 10800000, 0
    while cursor < stop:
        midnight = (cursor // day) * day
        following = min(midnight + day, stop)
        if datetime.fromtimestamp(midnight / 1000, timezone.utc).weekday() != 4:
            total += following - cursor
        cursor = following
    return total / day
