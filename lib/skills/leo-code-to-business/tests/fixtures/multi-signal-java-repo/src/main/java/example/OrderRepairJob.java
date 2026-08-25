package example;

import org.springframework.scheduling.annotation.Scheduled;

public class OrderRepairJob {
    private final OrderRepository repository;

    public OrderRepairJob(OrderRepository repository) {
        this.repository = repository;
    }

    @Scheduled(cron = "0 */10 * * * *")
    public void reconcileFailedRefunds() {
        repository.findRefundFailures();
    }
}
