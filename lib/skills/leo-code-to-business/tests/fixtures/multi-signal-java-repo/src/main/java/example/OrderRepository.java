package example;

import org.apache.ibatis.annotations.Update;

public interface OrderRepository {
    @Update("update orders set status = #{status} where id = #{id}")
    void updateStatus(Long id, OrderStatus status);

    OrderUpdateWrapper lambdaUpdate();

    void restoreStock(Long id);

    void findRefundFailures();
}
