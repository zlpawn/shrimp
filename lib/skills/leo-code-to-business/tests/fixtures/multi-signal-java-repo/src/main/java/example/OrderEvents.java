package example;

import org.springframework.context.event.EventListener;

public class OrderEvents {
    private final OrderRepository repository;

    public OrderEvents(OrderRepository repository) {
        this.repository = repository;
    }

    @EventListener
    public void restoreStock(OrderCancelled event) {
        repository.restoreStock(event.id());
    }
}
