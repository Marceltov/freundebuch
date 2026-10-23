// Run freundebuch as the owner of /data, so the database on a bind mount belongs to the host user. PUID/PGID override
// that. A root-owned /data (Docker created the bind-mount folder) falls back to uid/gid 1000. Only /data itself is
// chowned, never the files in it.
// A Node script, because the image has no shell: the server is loaded into this process once it has given up root.
import { chownSync, statSync } from "node:fs";

// Started with `user:`: nothing to switch.
if (process.getuid() === 0) {
  const data = statSync("/data");
  const uid = Number(process.env.PUID || data.uid) || 1000;
  const gid = Number(process.env.PGID || data.gid) || 1000;
  if (data.uid !== uid || data.gid !== gid) chownSync("/data", uid, gid);
  process.setgroups([gid]);
  process.setgid(gid);
  process.setuid(uid);
}

await import("./server.js");
