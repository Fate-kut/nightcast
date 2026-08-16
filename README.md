# Nightcast

Upload a video or audio file, get a room code, and watch/listen in sync with friends —
play, pause, and seeking on the host's screen mirror to everyone else in real time.

Plain HTML/CSS/JS, no build step. Backend is your own free Supabase project
(storage for the file + Realtime for sync). Deploys as a static site on Netlify.

## 1. Create a Supabase project

1. Go to supabase.com → New project (free tier is enough for a friends-and-family app).
2. Once it's up, go to **SQL Editor** and run:

```sql
create table if not exists rooms (
  code text primary key,
  media_url text not null,
  media_type text not null,       -- 'video' or 'audio'
  media_name text,
  created_at timestamptz default now()
);

alter table rooms enable row level security;
create policy "rooms are publicly readable" on rooms for select using (true);
create policy "anyone can create a room" on rooms for insert with check (true);
```

3. Go to **Storage** → New bucket → name it `media` → toggle **Public bucket** on.
4. Back in **SQL Editor**, run:

```sql
create policy "public read media" on storage.objects for select
  using (bucket_id = 'media');
create policy "public upload media" on storage.objects for insert
  with check (bucket_id = 'media');

-- raise the per-file size cap so video uploads aren't rejected.
-- 500MB shown here — adjust to taste (mind your plan's total storage quota).
update storage.buckets
  set file_size_limit = 524288000
  where id = 'media';
```

> Uploads use Supabase's **resumable** endpoint (chunked, up to several GB,
> auto-retries) rather than the plain upload call — the plain one buffers
> the whole file in a single request and rejects anything past a few dozen
> MB, which is what was breaking video uploads.

5. Go to **Settings → API** and copy your **Project URL** and **anon public key**.

> These policies are intentionally open (anyone with the link can upload/read) —
> fine for a private link you share with friends. Room codes are random 6-character
> strings, so nobody finds a room by guessing.

## 2. Add your keys

Open `js/supabaseClient.js` and paste in the two values from step 1.5:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOि...";
```

## 3. Deploy

This is a static site — no build command needed. Drag the `nightcast` folder into
Netlify's dashboard, or connect it to a repo with publish directory `.` and no build
command.

## How it works

- **Create room**: uploads the file to the `media` storage bucket, writes a row to
  `rooms` with a random code, and marks *your* browser as host (via `localStorage`).
- **Join room**: anyone who enters that code loads the same file and joins a Supabase
  Realtime channel `room:<code>`.
- **Sync**: the host's play/pause/seek events broadcast over that channel; guests'
  players mirror them, plus a heartbeat every 4s to correct drift. Guests' native
  controls are hidden so only the host drives playback.
- Browsers require a user gesture before audio/video can autoplay — that's why guests
  see a "Tap to join the room" overlay once, right after loading.

## Troubleshooting

- **"Nightcast isn't connected to Supabase yet"** — `js/supabaseClient.js` still
  has the placeholder values. Paste in your real Project URL and anon key.
- **Upload fails immediately with a size/format error** — raise `file_size_limit`
  on the `media` bucket (SQL above, or Storage → media → Edit bucket in the
  dashboard).
- **Upload fails with a 401/permission error** — the storage or `rooms` policies
  from step 1 weren't created, or were created on the wrong table.
- **Stuck at "Uploading… 0%"** — usually a network/CORS issue; open devtools
  console for the real error message from `tus-js-client`.

## Notes / things you may want to change later

- No chat, reactions, or "who's the host" transfer — first uploader is host for the
  room's lifetime.
- Files aren't deleted automatically; for a truly private app you'd want row-level
  security tied to real user accounts instead of open policies.
