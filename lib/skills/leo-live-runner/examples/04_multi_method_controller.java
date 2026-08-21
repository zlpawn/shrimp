package com.leo.dynamic;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * 示例 4: 动态多方法 Controller 服务族。
 * 注册端点: POST /internal/live-runner/register (scriptKey="order-api")
 * 调用端点:
 *   - POST /internal/live-runner/invoke/order-api/query
 *   - POST /internal/live-runner/invoke/order-api/update
 *   - POST /internal/live-runner/invoke/order-api/cancel
 */
public class MultiMethodOrderApiController {

    private static final Logger log = LoggerFactory.getLogger(MultiMethodOrderApiController.class);

    private JdbcTemplate jdbcTemplate;

    /**
     * 子动作 1: 查询订单详情
     * 端点: POST /internal/live-runner/invoke/order-api/query
     */
    public Object query(String orderId) {
        log.info("Querying order: {}", orderId);
        return jdbcTemplate.queryForMap(
                "SELECT id, order_no, status, user_id, create_time FROM t_order WHERE id = ?",
                orderId
        );
    }

    /**
     * 子动作 2: 更新订单状态 (带事务)
     * 端点: POST /internal/live-runner/invoke/order-api/update
     */
    @Transactional(rollbackFor = Exception.class)
    public Object update(String orderId, String newStatus) {
        log.info("Updating order: {} to {}", orderId, newStatus);
        int rows = jdbcTemplate.update(
                "UPDATE t_order SET status = ?, update_time = NOW() WHERE id = ?",
                newStatus, orderId
        );
        log.info("Affected rows: {}", rows);
        return Map.of("orderId", orderId, "updatedRows", rows, "newStatus", newStatus);
    }

    /**
     * 子动作 3: 取消订单
     * 端点: POST /internal/live-runner/invoke/order-api/cancel
     */
    @Transactional(rollbackFor = Exception.class)
    public Object cancel(String orderId, String cancelReason) {
        log.info("Cancelling order: {}, reason: {}", orderId, cancelReason);
        int rows = jdbcTemplate.update(
                "UPDATE t_order SET status = 'CANCELLED', remark = ? WHERE id = ?",
                cancelReason, orderId
        );
        return Map.of("orderId", orderId, "status", "CANCELLED", "affectedRows", rows);
    }
}
