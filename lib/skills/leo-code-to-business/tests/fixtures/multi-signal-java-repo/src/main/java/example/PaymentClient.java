package example;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

@FeignClient(name = "payment", url = "${payment.url}")
public interface PaymentClient {
    @PostMapping("/refund")
    void refund(@RequestParam Long id);
}
