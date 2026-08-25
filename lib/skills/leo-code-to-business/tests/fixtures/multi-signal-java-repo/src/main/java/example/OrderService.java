package example;

import org.springframework.context.ApplicationEventPublisher;

public class OrderService {
    private final OrderRepository repository;
    private final PaymentClient paymentClient;
    private final ApplicationEventPublisher publisher;

    public OrderService(OrderRepository repository, PaymentClient paymentClient, ApplicationEventPublisher publisher) {
        this.repository = repository;
        this.paymentClient = paymentClient;
        this.publisher = publisher;
    }

    public void cancel(Long id) {
        repository.updateStatus(id, OrderStatus.CANCELLED);
        repository.lambdaUpdate().eq(Order::getId, id).set(Order::getStatus, OrderStatus.CANCELLED).update();
        paymentClient.refund(id);
        publisher.publishEvent(new OrderCancelled(id));
    }
}
