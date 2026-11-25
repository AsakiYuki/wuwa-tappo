# Room (multiplayer) protocol of the original client

Source: static reading of the original app's frontend, build 1.0.5 (`WuwaTappo-global_1.0.5_x64-setup.exe`,
room composable in the lazy chunk `index-BOZbH4Zt.js`). **Nothing here was observed on the wire.** Field
meanings marked (inferred) come from how the client uses them.

## Transport

- Socket.IO client over WebSocket only (`transports: ["websocket"]`, `upgrade: false`, `reconnection: false`,
  connect timeout 10 s, path `/socket.io` unless configured otherwise).
- Host: the REST `ApiHost`, `https://api-wutheringwaves-wuwatappo.kurogames-global.com`.
- Handshake query: `token` = the login token (omitted if none) and `rm` = the room number, or the user's own
  numeric id as a string when not in a room. A missing user id aborts the connect.
- The client reconnects itself after a drop: delays 5 s, 10 s, 20 s, 40 s, 60 s, 120 s (repeating the last),
  only while logged in and the network is online.

## REST calls that create or enter a room (before the socket connects)

`POST api/frontend/rooms` -> `{ room_no }`, `POST api/frontend/rooms/join {room_no}`,
`POST api/frontend/rooms/random-join` -> `{ room_no }`, `POST api/frontend/rooms/public {room_no, is_public}`.
After a successful call the client reconnects the socket with `rm = room_no`, waits up to 8 s for
`connected`, then emits `rm`. Business code 80003 on create means "already in a room": restore it.

## Client -> server events

| Event | Payload | Meaning |
| --- | --- | --- |
| `rm` | `{ r: roomNo }`, ack | room snapshot (see below); also used to read `p` (public flag) |
| `rd` | `{ r: roomNo }`, ack | desktop state of every member |
| `rc` | none, or an object (this client's desktop change) | tell the room this client's appearance/state changed |
| `re` | `{ e: emoteName }` | send an emote (inferred: `e` is an emote asset name) |
| `rl` | `{ r: roomNo }`, ack | leave the room |
| `cr` | `{ num: n }`, ack | click report (inferred from the name and the `click_num` of logout) |

Acks are `{ c: code, d: data, message?, request_id? }`; success when `c` is 0 or 200 (same rule as REST).

## Server -> client events

| Event | Payload | Meaning |
| --- | --- | --- |
| `rj` | `{ a: userId, n: nickname, b: characterAssetId, c: partAsset, d: state }` | member joined |
| `rl` | `{ a: userId }` | member left (if it is this user: the room ended for them) |
| `ro` | `{ a: userId }` | member went offline (stays in the list) |
| `rk` | `{ u: [userId, ...] }` | members kicked (this user included means they were kicked) |
| `rt` | `{ a: newOwnerId?, o: ownerId }` | ownership transferred to `o` |
| `rs` | `{ r?: roomNo }` | room dismissed |
| `rd` | list or `{ d: list }` of `{ a, n?, b, c, d }` | desktop state snapshot |
| `rc` | `{ a: userId, ... }`, `{ a: "id|id|..." }`, or `{ o, a }` | member state changed / member acted (tap) |
| `ru` | `{ u: userId, e: emoteName }` | member played an emote |
| `fd` | `{ c: code }` | forced disconnect (90001 plain, 90002 has its own message) |

`rm` snapshot ack `d`: `{ r: roomNo, p: 0|1, m: [{ u: userId, n: nickname, o: 0|1 (owner), l: 0|1 (online) }] }`;
`80007` as the ack code means the room no longer exists.

## Not understood yet

- The exact shape of `rc` when this client emits it, and of `d` (desktop state) beyond being compared with a
  local action number.
- Value formats of `b`, `c` (asset ids vs names: the client maps them through its appearance catalog).
- Whether the server enforces anything beyond the token in the handshake.

Verify against live traffic before relying on any row: capture one real session (Frida on the Windows build
under Wine, or a mitmproxy WebSocket log) and compare.
