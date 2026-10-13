# Test: support-chat.spec.ts >> Support chat >> greeting after reconnect

- Spec: e2e/support-chat.spec.ts:22
- Browser: chromium
- Result: failed after 10.1s

## Error

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('chat-log')
Expected substring: "Hi, I'm Sam"
Received string: ""
Timeout: 10000ms

Call log:
  - Expect "toContainText" with timeout 10000ms
  - waiting for getByTestId('chat-log')
  - locator resolved to <div data-testid="chat-log"></div>
```

## Console

```
[chat] socket open, conversation 9f2
[chat] socket closed, code 1006, reason ""
[chat] reconnecting in 1000ms, attempt 1
[chat] socket open, conversation 9f2
WebSocket is already in CLOSING or CLOSED state.
[chat] resubscribed, 0 messages replayed
```

## Page snapshot

```yaml
- dialog "Chat with us":
  - heading "Support chat" [level=2]
  - status: Connected
  - log "Chat messages"
  - textbox "Message"
  - button "Send"
```
