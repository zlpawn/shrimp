"""leo-classify-eval 计算核心。"""

INVALID = "__invalid__"


class InputError(Exception):
    """用户输入有误。CLI 捕获后打印中文说明并以退出码 2 结束。"""
