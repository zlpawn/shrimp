package com.leo.dynamic;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// 替换为宿主工程的业务 Service
import com.example.sample.service.OrderService;
import com.example.sample.service.PaymentService;

import java.util.Map;

/**
 * 示例 3: 直接注入并调用宿主工程已有的 Spring Service 门面。
 * 最佳实践：最大化复用老系统的业务校验、缓存清理、分布式锁与消息发布逻辑。
 */
public class ExistingServiceFacadeTask {

    private static final Logger log = LoggerFactory.getLogger(ExistingServiceFacadeTask.class);

    // 自动按名注入宿主工程现有 Service Bean
    private OrderService orderService;
    private PaymentService paymentService;

    public Object run(Long orderId, String refundReason) {
        log.info(">>> 步骤 1: 通过 OrderService 校验订单当前状态, orderId={}", orderId);
        String currentStatus = orderService.getOrderStatus(orderId);
        log.info(">>> 订单当前状态为: {}", currentStatus);

        if (!"PAID".equalsIgnoreCase(currentStatus)) {
            Map<String, Object> err = new java.util.HashMap<>();
            err.put("success", false);
            err.put("msg", "订单非已支付状态，当前状态为: " + currentStatus);
            return err;
        }

        log.info(">>> 步骤 2: 调用现有 PaymentService 执行退款与资金冲正, 原因: {}", refundReason);
        boolean refundSuccess = paymentService.processRefund(orderId, refundReason);
        log.info(">>> 退款执行结果: {}", refundSuccess);

        if (refundSuccess) {
            log.info(">>> 步骤 3: 同步更新订单服务状态为 REFUNDED");
            orderService.updateOrderStatus(orderId, "REFUNDED");
        }

        Map<String, Object> res = new java.util.HashMap<>();
        res.put("orderId", orderId);
        res.put("refundSuccess", refundSuccess);
        res.put("finalStatus", orderService.getOrderStatus(orderId));
        return res;
    }
}
