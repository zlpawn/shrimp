package com.leo.dynamic;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;

// 替换为宿主工程的实体与 Mapper 包路径
import com.example.sample.entity.Order;
import com.example.sample.mapper.OrderMapper;

import java.util.Map;

/**
 * 示例 2: MyBatis-Plus 动态 Lambda 条件构造器更新。
 * 连 SQL 都不需要写，直接利用老工程已有的 Mapper 接口拼装任意动态条件。
 */
public class MybatisPlusDynamicTask {

    private static final Logger log = LoggerFactory.getLogger(MybatisPlusDynamicTask.class);

    // 自动从 Spring IoC 容器装配
    private OrderMapper orderMapper;

    @Transactional(rollbackFor = Exception.class)
    public Object run(Long userId, Integer newStatus) {
        log.info(">>> 步骤 1: 使用 MyBatis-Plus LambdaQueryWrapper 查询该用户待处理订单数量, userId={}", userId);

        Long count = orderMapper.selectCount(
                Wrappers.<Order>lambdaQuery()
                        .eq(Order::getUserId, userId)
                        .eq(Order::getStatus, 1)
        );
        log.info(">>> 用户目前存在待处理订单: {} 笔", count);

        if (count == 0) {
            Map<String, Object> res = new java.util.HashMap<>();
            res.put("updatedRows", 0);
            res.put("msg", "未查询到待处理订单");
            return res;
        }

        // 步骤 2: 使用 LambdaUpdateWrapper 批量动态更新
        log.info(">>> 步骤 2: 批量更新状态为 {}", newStatus);
        int rows = orderMapper.update(
                null,
                Wrappers.<Order>lambdaUpdate()
                        .set(Order::getStatus, newStatus)
                        .set(Order::getRemark, "LiveRunner 线上应急状态冲正")
                        .eq(Order::getUserId, userId)
                        .eq(Order::getStatus, 1)
        );
        log.info(">>> 更新成功行数: {}", rows);

        Map<String, Object> res = new java.util.HashMap<>();
        res.put("userId", userId);
        res.put("updatedRows", rows);
        return res;
    }
}
