# Checkout incident, 2026-10-11

What shoppers saw: on the web checkout, the pay button kept spinning for a long time, and then the page showed a generic error. Many shoppers pressed pay again, and some gave up. Shoppers could still browse products during the same period.

Time window: about 21:40 to 22:10 UTC on 2026-10-11. Checkout behaved normally again after 22:10.

The API log for that night is logs/api-2026-10-11.jsonl. It covers 21:15 to 22:30 UTC, one JSON object per line. logs/FIELDS.md describes the fields.

Open question: why did checkout requests stop getting through?

Written by the on-call engineer on duty, 2026-10-12.
