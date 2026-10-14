#!/usr/bin/env python3
"""
生成 Godot 端使用的中文字体子集。

为什么需要这一步：Godot 内置字体不含 CJK 字形，小镇里的中文标签（街区名、文章标题、
角色名）会渲染成空白；而完整的思源黑体变体字重有 16.9 MB，直接打包会让 Web 端
多下载十几 MB。所以按「实际用到的字符」做子集化，产物通常在几十到一百多 KB。

字符集来源（自动收集，不靠人工维护）：
  1. SQLite 里的全部文章标题 / 摘要 / 分类 / 标签 / 角色名与简介
  2. godot/scripts/*.gd 里出现的所有中文字面量
  3. 数字、拉丁字母、常用标点

产出：godot/assets/fonts/town-cjk.ttf

用法：
  python scripts/godot-font.py
"""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "blog.db"
GODOT_DIR = ROOT / "godot"
OUT_PATH = GODOT_DIR / "assets" / "fonts" / "town-cjk.ttf"

# 优先使用思源黑体；找不到则依次回退到其它常见中文字体
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/NotoSansSC-VF.ttf"),
    Path("C:/Windows/Fonts/NotoSansSC-Regular.otf"),
    Path("C:/Windows/Fonts/msyh.ttc"),
    Path("C:/Windows/Fonts/simhei.ttf"),
    Path("/System/Library/Fonts/PingFang.ttc"),
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
]

# 界面上出现但可能没写进 .gd 的通用字符（保险起见）
EXTRA_CHARS = "　 ！？，。、；：（）【】「」《》—…·0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;!?()[]{}<>/\\-+=_%#@&*'\"" 


def collect_from_db() -> set[str]:
    """从 SQLite 收集所有会显示到小镇里的文本字符。"""
    chars: set[str] = set()
    if not DB_PATH.exists():
        print(f"  ! 未找到 {DB_PATH}，跳过数据库字符收集")
        return chars

    conn = sqlite3.connect(DB_PATH)
    try:
        queries = [
            "SELECT title FROM posts WHERE status='published'",
            "SELECT summary FROM posts WHERE status='published'",
            "SELECT category FROM posts WHERE status='published'",
            "SELECT name FROM tags",
            "SELECT name FROM agents",
            "SELECT persona FROM agents",
            "SELECT location FROM agents",
        ]
        for sql in queries:
            for (value,) in conn.execute(sql):
                if isinstance(value, str):
                    chars.update(value)
    finally:
        conn.close()
    return chars


def collect_from_gdscript() -> set[str]:
    """扫描 GDScript，把源码里的中文字面量也算进字符集。"""
    chars: set[str] = set()
    for gd in (GODOT_DIR / "scripts").glob("*.gd"):
        text = gd.read_text(encoding="utf-8")
        chars.update(re.findall(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]", text))
    return chars


def pick_source_font() -> Path:
    for path in FONT_CANDIDATES:
        if path.exists():
            return path
    print("✗ 找不到任何可用的中文字体，请编辑 FONT_CANDIDATES 指定路径", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    if not (GODOT_DIR / "project.godot").exists():
        print("✗ 未找到 godot/project.godot", file=sys.stderr)
        sys.exit(1)

    chars = set(EXTRA_CHARS)
    chars |= collect_from_db()
    chars |= collect_from_gdscript()
    text = "".join(sorted(chars))
    print(f"  字符集大小：{len(chars)} 个不同字符")

    src = pick_source_font()
    print(f"  源字体：{src.name}（{src.stat().st_size / 1048576:.1f} MB）")

    font = TTFont(str(src), fontNumber=0)

    # 变体字体先实例化成静态字重，产物更小、渲染更可预测
    if "fvar" in font:
        print("  检测到变体字体，实例化 wght=500 静态字重")
        font = instancer.instantiateVariableFont(font, {"wght": 500}, inplace=False, updateFontNames=True)

    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["DSIG"]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT_PATH))

    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"  ✓ 已生成 {OUT_PATH.relative_to(ROOT)}（{size_kb:.1f} KB）")
    print(f"  压缩比：{size_kb * 1024 / src.stat().st_size * 100:.2f}%")


if __name__ == "__main__":
    main()
