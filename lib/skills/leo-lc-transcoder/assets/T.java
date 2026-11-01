// leo-lc-transcoder 轨迹记录器：viz.mjs 会把本文件追加到演示程序末尾一起运行。
// 用法：T.frame("中文说明", T.arr(...), T.vars(...))，每调用一次记录一帧，行号自动取调用处。
// 只用 JDK 11 就有的语法。
class T {
    private static final java.util.IdentityHashMap<Object, Integer> IDS = new java.util.IdentityHashMap<>();
    private static int frames = 0;

    static void frame(String note, Object... views) {
        if (++frames > 2000) throw new IllegalStateException("帧数超过 2000，请换更小的输入");
        int line = new Throwable().getStackTrace()[1].getLineNumber();
        StringBuilder sb = new StringBuilder("@@T {\"line\":").append(line).append(",\"note\":");
        json(sb, note, 0);
        sb.append(",\"views\":");
        json(sb, views, 0);
        System.out.println(sb.append('}'));
    }

    /** 数组 + 指针：marks 成对给出，如 "L", l, "R", r */
    static java.util.Map<String, Object> arr(String name, Object array, Object... marks) {
        return view("array", name, "items", array, "marks", pairs(marks));
    }

    /** 数组 + 闭区间 [from, to] 高亮（滑动窗口） */
    static java.util.Map<String, Object> range(String name, Object array, int from, int to, Object... marks) {
        java.util.Map<String, Object> v = arr(name, array, marks);
        v.put("range", new int[] {from, to});
        return v;
    }

    /** 二维表格，高亮 (row, col)（动态规划） */
    static java.util.Map<String, Object> grid(String name, Object matrix, int row, int col) {
        return view("grid", name, "cells", matrix, "cur", new int[] {row, col});
    }

    /** 树：节点有 val 加 left/right（二叉树），或 val 加 kids（List，递归树 / 回溯树） */
    static java.util.Map<String, Object> tree(String name, Object root, Object... highlight) {
        java.util.Map<String, Object> v = view("tree", name, "root", node(root, 0));
        java.util.List<Integer> hl = new java.util.ArrayList<>();
        for (Object h : highlight) if (h != null) hl.add(id(h));
        v.put("hl", hl);
        return v;
    }

    /** 栈：第一个元素画在最上面（ArrayDeque.push 进去的是第一个） */
    static java.util.Map<String, Object> stack(String name, Iterable<?> items) {
        java.util.List<Object> list = new java.util.ArrayList<>();
        for (Object o : items) list.add(o);
        return view("stack", name, "items", list);
    }

    /** 标量变量：T.vars("sum", sum, "best", best) */
    static java.util.Map<String, Object> vars(Object... kv) {
        return view("vars", "变量", "values", pairs(kv));
    }

    private static java.util.Map<String, Object> view(String kind, String name, Object... kv) {
        java.util.Map<String, Object> v = pairs(kv);
        v.put("kind", kind);
        v.put("name", name);
        return v;
    }

    private static java.util.Map<String, Object> pairs(Object... kv) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static int id(Object o) {
        return IDS.computeIfAbsent(o, k -> IDS.size() + 1);
    }

    private static Object node(Object n, int depth) {
        if (n == null || depth > 64) return null;
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", id(n));
        m.put("val", field(n, "val"));
        Object kids = field(n, "kids");
        if (kids instanceof Iterable) {
            java.util.List<Object> list = new java.util.ArrayList<>();
            for (Object k : (Iterable<?>) kids) list.add(node(k, depth + 1));
            m.put("kids", list);
        } else {
            m.put("left", node(field(n, "left"), depth + 1));
            m.put("right", node(field(n, "right"), depth + 1));
        }
        return m;
    }

    private static Object field(Object o, String name) {
        try {
            java.lang.reflect.Field f = o.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return f.get(o);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    private static void json(StringBuilder sb, Object o, int depth) {
        if (o == null || depth > 64) {
            sb.append("null");
            return;
        }
        boolean nonFinite = (o instanceof Double && !Double.isFinite((Double) o)) || (o instanceof Float && !Float.isFinite((Float) o));
        if ((o instanceof Number && !nonFinite) || o instanceof Boolean) {
            sb.append(o);
            return;
        }
        if (o instanceof java.util.Map) {
            sb.append('{');
            boolean first = true;
            for (java.util.Map.Entry<?, ?> e : ((java.util.Map<?, ?>) o).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                json(sb, String.valueOf(e.getKey()), depth + 1);
                sb.append(':');
                json(sb, e.getValue(), depth + 1);
            }
            sb.append('}');
            return;
        }
        if (o instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object x : (Iterable<?>) o) {
                if (!first) sb.append(',');
                first = false;
                json(sb, x, depth + 1);
            }
            sb.append(']');
            return;
        }
        if (o.getClass().isArray()) {
            sb.append('[');
            int n = java.lang.reflect.Array.getLength(o);
            for (int i = 0; i < n; i++) {
                if (i > 0) sb.append(',');
                json(sb, java.lang.reflect.Array.get(o, i), depth + 1);
            }
            sb.append(']');
            return;
        }
        sb.append('"');
        for (char c : String.valueOf(o).toCharArray()) {
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        sb.append('"');
    }
}
