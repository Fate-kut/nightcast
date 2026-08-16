# Nightcast

Nightcast is a browser-based synchronized media room with room management, messaging, voice messages, live voice chat, and WebRTC audio/video calls.

## Features
- Create and name rooms
- Upload audio/video with resumable uploads
- Synchronized host playback
- Join rooms by code or invite link
- Edit/delete rooms you created on the device
- Persistent text messaging
- Voice messages stored in Supabase Storage
- Live room voice chat
- Room-wide WebRTC video calls

Backend: Supabase Database, Storage, and Realtime. Calls use browser WebRTC with a public STUN server; TURN is recommended for production reliability across restrictive NATs.
