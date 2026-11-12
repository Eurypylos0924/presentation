"""실행: uv run python -m app   (브라우저가 자동으로 열립니다)"""

import os
import threading
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = int(os.getenv("PORT", "8765"))

if __name__ == "__main__":
    if os.getenv("NO_BROWSER") != "1":
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{HOST}:{PORT}")).start()
    print(f"발표 표준화 도구: http://{HOST}:{PORT}  (끄려면 Ctrl+C)")
    uvicorn.run("app.server:app", host=HOST, port=PORT, log_level="warning")
