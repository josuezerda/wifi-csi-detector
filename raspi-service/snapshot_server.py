#!/usr/bin/env python3
"""Lightweight snapshot server - serves files saved by main.py."""
import http.server, os, json, time

PORT = 8080
SNAP_DIR = "/home/pi/control-home/snapshots"

class SnapshotHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parts = self.path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "snapshot":
            ip = parts[1]
            filepath = os.path.join(SNAP_DIR, f"{ip}.jpg")
            if os.path.exists(filepath) and time.time() - os.path.getmtime(filepath) < 30:
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                with open(filepath, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(503, "Snapshot not available")
        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            snaps = {}
            for f in os.listdir(SNAP_DIR):
                if f.endswith(".jpg"):
                    fp = os.path.join(SNAP_DIR, f)
                    snaps[f] = {"size": os.path.getsize(fp), "age": round(time.time() - os.path.getmtime(fp), 1)}
            self.wfile.write(json.dumps(snaps).encode())
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    os.makedirs(SNAP_DIR, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), SnapshotHandler)
    print(f"📸 Snapshot file server on port {PORT}")
    server.serve_forever()
