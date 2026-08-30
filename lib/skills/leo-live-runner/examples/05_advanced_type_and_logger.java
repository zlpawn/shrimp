package com.leo.dynamic;

import io.github.zlpawn.liverunner.core.LiveLogger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 示例 5: 生产级全类型自动映射与 LiveLogger 双写实时日志回显。
 *
 * 核心特性演示：
 * 1. LiveLogger: 无需在 JSON 传参，引擎自动注入；支持实时将执行进度回显到 HTTP 响应，并同步打入 SLF4J / ELK；
 * 2. 强类型入参: 自动完成 Enum、LocalDateTime、LocalDate、List<Long>、Set<String> 的反序列化与转换；
 * 3. 事务安全: @Transactional 保证抛出异常时自动回滚。
 *
 * 推荐调用端点: POST /internal/live-runner/execute
 */
public class AdvancedTypeAndLoggerTask {

    private static final Logger log = LoggerFactory.getLogger(AdvancedTypeAndLoggerTask.class);

    // 自动按名/类型注入 Spring 容器的 JdbcTemplate
    private JdbcTemplate jdbcTemplate;

    /**
     * 业务状态枚举（也可以直接使用宿主工程中已有的 Enum 类）
     */
    public enum TargetStatusEnum {
        PENDING,
        PROCESSING,
        COMPLETED,
        CANCELLED
    }

    /**
     * 动态执行入口：
     * HTTP 请求 params 示例:
     * {
     *   "targetStatus": "COMPLETED",               // 自动转 TargetStatusEnum 枚举（不区分大小写）
     *   "bizDate": "2026-08-30",                   // 自动转 LocalDate
     *   "expireTime": "2026-08-30 23:59:59",       // 自动转 LocalDateTime
     *   "orderIds": [1001, 1002, 1003],            // 自动转 List<Long>（也支持 "1001,1002,1003" 逗号字符串）
     *   "tags": "PROD_FIX,URGENT"                  // 自动转 Set<String>
     * }
     */
    @Transactional(rollbackFor = Exception.class)
    public Object run(TargetStatusEnum targetStatus,
                      LocalDate bizDate,
                      LocalDateTime expireTime,
                      List<Long> orderIds,
                      Set<String> tags,
                      LiveLogger liveLog) {

        // 1. 使用 LiveLogger 输出进度（HTTP 响应会直接回显，同时同步写入 SLF4J 日志文件）
        liveLog.println(">>> [Step 1] 开始执行高级参数订正任务...");
        liveLog.println(">>> 目标业务日期: " + bizDate + "，过期时间阈值: " + expireTime);
        liveLog.println(">>> 目标枚举状态: " + targetStatus.name() + "，包含标签: " + tags);
        liveLog.println(">>> 待处理订单集合数量: " + (orderIds != null ? orderIds.size() : 0));

        if (orderIds == null || orderIds.isEmpty()) {
            liveLog.println(">>> [Warn] 订单列表为空，跳过处理。");
            Map<String, Object> emptyRes = new HashMap<>();
            emptyRes.put("success", false);
            emptyRes.put("msg", "orderIds is empty");
            return emptyRes;
        }

        // 2. 模拟批量更新数据库
        int totalUpdated = 0;
        for (Long id : orderIds) {
            int rows = jdbcTemplate.update(
                    "UPDATE t_order SET status = ?, update_time = ? WHERE id = ?",
                    targetStatus.name(), expireTime, id
            );
            totalUpdated += rows;
            liveLog.println(">>> 成功更新订单 [ID=" + id + "]，受影响行数: " + rows);
        }

        liveLog.println(">>> [Step 2] 全部订单更新完毕，累计更新: " + totalUpdated + " 行。");

        // 3. 返回结构化业务结果
        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("targetStatus", targetStatus.name());
        result.put("totalUpdated", totalUpdated);
        result.put("bizDate", bizDate.toString());
        return result;
    }
}
