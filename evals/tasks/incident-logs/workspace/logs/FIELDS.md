# Fields in api-2026-10-11.jsonl

Each line is one JSON object, and the lines are in time order. A field that does not apply is left out of the line rather than set to null.

| Field | Meaning |
| --- | --- |
| id | Entry id, unique in the file: e0001, e0002, and so on. |
| time | UTC timestamp in ISO 8601 format. |
| level | 30 for info, 40 for warn, 50 for error. |
| svc | The process that wrote the line. api serves HTTP, worker runs background work, and scheduler starts and stops scheduled jobs. |
| method, route | HTTP method and route pattern. Present on request lines and on some lines about one route. |
| reqId | Id of the request. Present only on lines about a single request. |
| status | HTTP status sent to the client. 499 means the client closed the connection before a response was sent. |
| durationMs | Milliseconds from the start of the request until the response was sent or the connection closed. |
| err | Type and message of the error, on lines that report one. |
| msg | What happened, in words. |
