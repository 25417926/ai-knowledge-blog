"""启动入口：python -m app.main 或 uvicorn app.main:app。

开发模式带 --reload；数据库在 lifespan 里自动建表。
"""

from __future__ import annotations

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os_environ_host(),
        port=int(os_environ_port()),
        reload=True,
    )


def os_environ_host() -> str:
    import os

    return os.environ.get("HOST", "127.0.0.1")


def os_environ_port() -> str:
    import os

    return os.environ.get("PORT", "8000")
