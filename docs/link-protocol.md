# Phone ↔ PC link protocol (`iemdream/1`)

Plan §70 D1. Code: `app/electron/link/` (PC end), tests in `app/src/shell/link.test.ts`.

## Transport and identity
- iroh (QUIC + TLS 1.3), ALPN `iemdream/1`. Same code on the same Wi-Fi, another Wi-Fi and mobile data; n0's public relays introduce the two ends and carry traffic only if no direct path works. The relay only forwards ciphertext.
- Each end is an Ed25519 key pair; the public key is its address (endpoint id). PC key: `user-data/link/key.bin`, encrypted with Windows DPAPI (Electron `safeStorage`). Phone key: Android Keystore.
- The PC accepts the handshake (that's how it learns the phone's key), then closes any key that isn't paired before reading a request. The one exception: while Pair a phone is open, an unknown key may send one `pair` request.

## Pairing
1. PC: Settings → Pair a phone shows a QR of
   `iemdream://pair?t=<endpoint ticket>&s=<32 hex chars>&n=<PC name>`
   The secret is 128 random bits, good for 5 minutes and one use; 5 wrong secrets close the window.
2. Phone: dials the ticket and sends `{"op":"pair","secret":"…","name":"Xiaomi 14"}`.
3. PC asks its owner "Allow …?". Answer: `{"ok":true,"name":"PC"}` or `{"ok":false,"error":"declined" | "wrong" | "closed" | "full" | "known"}`.
4. At most 5 phones. Unused for 7 days → expired; every connection restarts the 7 days. Remove on the PC closes the phone's connection at once.

## Requests
One bidirectional QUIC stream per request. The phone writes one JSON line (≤ 4096 bytes) and finishes its side. The PC answers one JSON header line, then `bytes` raw bytes if the header has them, then finishes.

| Request | Answer |
|---|---|
| `{"op":"hello"}` | `{"ok":true,"name":"PC","library":<version>,"protocol":1}` |
| `{"op":"library","since":<version>}` | `{"ok":true,"version":N,"same":true}`, or `{"ok":true,"version":N,"type":"application/json","bytes":B}` + JSON array of songs |
| `{"op":"cover","id":"<cover id>"}` | `{"ok":true,"type":"image/jpeg","size":S,"from":0,"bytes":S}` + image |
| `{"op":"song","id":"<song id>","from":<offset>}` | `{"ok":true,"type":"audio/flac","size":S,"from":F,"bytes":S-F}` + file bytes from F (resume after a drop) |

Errors: `{"ok":false,"error":"not found" | "busy" | "bad id" | …}`. Ids are `[A-Za-z0-9_-]{1,64}`; paths are never accepted, and a song is only served if the library says its file is inside a chosen folder. Song entries carry tags, format, rate, bits, length, size and cover id, never the file's path. Six requests per phone at once; all phones share a 60 Mbps upload cap.

## Later
`song` gains `quality: "cd" | "opus"` once ffmpeg ships (§70 "Weak link"). An `events` stream (library changed, PC going offline, phone removed) comes with the phone side.
