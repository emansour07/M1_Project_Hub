from datetime import datetime
from django.test import SimpleTestCase
from .calendar import working_days

class CalendarTests(SimpleTestCase):
    def test_weekend_and_fractional_days(self):
        epoch = lambda s: datetime.fromisoformat(s).timestamp() * 1000
        self.assertEqual(working_days(epoch('2026-11-12T12:00:00+03:00'), epoch('2026-11-15T12:00:00+03:00')), 2)
        self.assertEqual(working_days(epoch('2026-11-13T00:00:00+03:00'), epoch('2026-11-14T00:00:00+03:00')), 0)
        self.assertEqual(working_days(epoch('2026-11-15T12:00:00+03:00'), epoch('2026-11-15T18:00:00+03:00')), .25)
