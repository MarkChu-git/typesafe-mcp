# Known flaky problems

The e2e suite has four problems that come back on their own. Each one has a usual symptom, and a failure that shows that symptom belongs to one of these. The owner tracks the fixes on the e2e board.

## 1. Payment sandbox is slow

The payment sandbox sometimes takes more than 30 seconds to answer. The pay click goes through, and then the test times out while it waits for the order confirmation page. The server log shows the payment intent still pending when the test gives up.

## 2. Store-locator map tiles return 503

Map tiles from the tile host sometimes return 503 Service Unavailable. The map then never finishes loading, so the store pins never appear. The browser console shows the 503 responses for the tile URLs.

## 3. Live-chat websocket drops on reconnect

The live-chat widget's websocket sometimes closes with code 1006 and reconnects. After the reconnect the conversation can come back empty, so the message the test waits for never shows up.

## 4. Toast covers a button

A notification toast sometimes slides over a button. Playwright then reports that the click was intercepted, and it names an element that "intercepts pointer events". That element is the toast, not the button.
