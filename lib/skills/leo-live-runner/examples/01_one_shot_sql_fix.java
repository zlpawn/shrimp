package com.leo.dynamic;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * 示例 1: 一次性应急 SQL 数据订正（标准 SLF4J 日志 + @Transactional 自动回滚）。
 * 推荐调用接口: POST /internal/live-runner/execute
 */
public class OneShotSqlFixTask {

    private static final Logger log = LoggerFactory.getLogger(OneShotSqlFixTask.class);

    // 自动按类型/名称注入宿主 Spring 的 JdbcTemplate
    private JdbcTemplate jdbcTemplate;

    @Transactional(rollbackFor = Exception.class)
    public Object run(String expiredDate, Integer targetStatus) {
        log.info(">>> 步骤 1: 查询截至 {} 的所有待处理异常订单...", expiredDate);

        List<Map<String, Object>> orders = jdbcTemplate.queryForList(
                "SELECT id, order_no, status, user_id FROM t_order WHERE status = 1 AND create_time < ?",
                expiredDate
        );
        log.info(">>> 命中待修复订单数量: {} 条", orders.size());

        if (orders.isEmpty()) {
            return Map.of("updatedCount", 0, "status", "NO_DATA_TO_FIX");
        }

        // 步骤 2: 批量更新订单状态
        log.info(">>> 步骤 2: 正在将状态批量修改为: {}", targetStatus);
        int updatedRows = jdbcTemplate.update(
                "UPDATE t_order SET status = ?, update_time = NOW() WHERE status = 1 AND create_time < ?",
                targetStatus, expiredDate
        );
        log.info(">>> 数据库受影响行数: {}", updatedRows);

        return Map.of(
                "targetStatus", targetStatus,
                "updatedCount", updatedRows,
                "sampleOrder", orders.get(0)
        );
    }
}
