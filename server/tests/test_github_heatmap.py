"""GitHub 热力图的数据收口：只测纯函数，不连网。

上游返回什么形状我们控制不了，但「前端拿到的形状」必须稳定：
日期乱序、level 越界、字段缺失都得在这里被收拾干净，否则页面渲染出空格子或报错。
"""

from app.api.routes.github import DEFAULT_USERNAME, normalize_contributions, username


def day(date: str, count: int, level: int) -> dict:
    return {"date": date, "count": count, "level": level}


class TestNormalizeContributions:
    def test_keeps_order_sorted_by_date(self):
        raw = {
            "total": {"lastYear": 7},
            "contributions": [day("2026-03-02", 3, 2), day("2026-03-01", 4, 3)],
        }
        assert [d["date"] for d in normalize_contributions(raw, "u")["days"]] == [
            "2026-03-01",
            "2026-03-02",
        ]

    def test_total_from_payload(self):
        raw = {"total": {"lastYear": 38}, "contributions": [day("2026-03-01", 4, 3)]}
        assert normalize_contributions(raw, "u")["total"] == 38

    def test_total_falls_back_to_sum(self):
        # 上游缺 total 时不能显示空，「每天几次」加起来才是准的
        raw = {"contributions": [day("2026-03-01", 4, 3), day("2026-03-02", 3, 2)]}
        assert normalize_contributions(raw, "u")["total"] == 7

    def test_total_bool_is_not_accepted(self):
        # bool 是 int 的子类，不排掉会算出 total=True 这种鬼东西
        raw = {"total": {"lastYear": True}, "contributions": [day("2026-03-01", 4, 3)]}
        assert normalize_contributions(raw, "u")["total"] == 4

    def test_total_negative_falls_back(self):
        raw = {"total": {"lastYear": -1}, "contributions": [day("2026-03-01", 2, 1)]}
        assert normalize_contributions(raw, "u")["total"] == 2

    def test_level_clamped_to_zero_through_four(self):
        # 前端按 level 查配色表，越界会拿到 undefined（格子直接消失）
        raw = {
            "contributions": [
                day("2026-03-01", 99, 9),
                day("2026-03-02", 0, -3),
            ]
        }
        levels = [d["level"] for d in normalize_contributions(raw, "u")["days"]]
        assert levels == [4, 0]

    def test_negative_count_becomes_zero(self):
        raw = {"contributions": [day("2026-03-01", -5, 0)]}
        assert normalize_contributions(raw, "u")["days"][0]["count"] == 0

    def test_drops_rows_without_valid_date(self):
        raw = {
            "contributions": [
                {"count": 3, "level": 2},
                day("2026-03", 3, 2),
                day("2026-03-01", "x", 2),  # count 转不了 int
                day("2026-03-02", 3, 2),
            ]
        }
        assert [d["date"] for d in normalize_contributions(raw, "u")["days"]] == ["2026-03-02"]

    def test_drops_unexpected_fields(self):
        # 只往前端递 date/count/level，上游加字段不该悄悄流进响应
        raw = {"contributions": [{**day("2026-03-01", 3, 2), "color": "#fff"}]}
        assert set(normalize_contributions(raw, "u")["days"][0]) == {"date", "count", "level"}

    def test_empty_contributions(self):
        data = normalize_contributions({"total": {"lastYear": 0}}, "u")
        assert data["days"] == [] and data["total"] == 0

    def test_username_passed_through(self):
        assert normalize_contributions({}, "someone")["username"] == "someone"

    def test_updated_at_filled_by_route_only(self):
        # 纯函数不碰时间：缓存时间戳由路由在写入时打，测试才好比对
        assert normalize_contributions({}, "u")["updatedAt"] is None


class TestUsername:
    def test_default_when_env_missing(self, monkeypatch):
        monkeypatch.delenv("GITHUB_USERNAME", raising=False)
        assert username() == DEFAULT_USERNAME

    def test_blank_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("GITHUB_USERNAME", "   ")
        assert username() == DEFAULT_USERNAME

    def test_env_override_is_trimmed(self, monkeypatch):
        monkeypatch.setenv("GITHUB_USERNAME", " octocat ")
        assert username() == "octocat"
